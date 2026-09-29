/** Run against a disposable local *_test database after nest build and migrations. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { before, after, mock, test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { Logger, ValidationPipe, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { useContainer } from "class-validator";
import type { PrismaService as PrismaServiceType } from "../src/database/prisma.service";

const built = createRequire(resolve("package.json"));
const klass = (path: string, name: string) => built(`./dist/src/${path}.js`)[name];
const PrismaService = klass("database/prisma.service", "PrismaService");
const LeadContractService = klass("modules/lead/service/lead-contract.service", "LeadContractService");
const ExpertLeadService = klass("modules/lead/service/expert-lead.service", "ExpertLeadService");
const ExpertLeadController = klass("modules/lead/api/expert-lead.controller", "ExpertLeadController");
const LeadGuestMeetingService = klass("modules/lead/service/lead-guest-meeting.service", "LeadGuestMeetingService");
const LeadStudentInvitationService = klass("modules/lead/service/lead-student-invitation.service", "LeadStudentInvitationService");
const ContractService = klass("modules/contract/service/contract.service", "ContractService");
const ContractRepository = klass("modules/contract/repository/contract.repository", "ContractRepository");
const ExpertContractController = klass("modules/contract/api/expert-contract.controller", "ExpertContractController");
const ContractController = klass("modules/contract/api/contract.controller", "ContractController");
const ManualContractService = klass("modules/contract/service/manual-contract.service", "ManualContractService");
const ManualContractController = klass("modules/contract/api/manual-contract.controller", "ManualContractController");
const AdminController = klass("modules/admin/admin.controller", "AdminController");
const AdminService = klass("modules/admin/admin.service", "AdminService");
const AnalyticsController = klass("modules/admin/analytics.controller", "AnalyticsController");
const LeadRealtimeGateway = klass("modules/lead/realtime/lead-realtime.gateway", "LeadRealtimeGateway");
const ContractScanController = klass("modules/contract/api/contract-scan.controller", "ContractScanController");
const ContractScanService = klass("modules/contract/service/contract-scan.service", "ContractScanService");
const AnalyticsService = klass("modules/admin/analytics.service", "AnalyticsService");
const FinanceService = klass("modules/admin/finance.service", "FinanceService");
const JwtAuthGuard = klass("modules/admin/auth/rbac/auth.guard", "JwtAuthGuard");
const RolesGuard = klass("modules/admin/auth/rbac/roles.guard", "RolesGuard");
const ExistsValidator = klass("common/validators/exists.validator", "ExistsValidator");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
assert(["127.0.0.1", "localhost"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test database");
const prisma: PrismaServiceType = new PrismaService();
const jwt = new JwtService();
const runId = randomUUID();
const secret = randomUUID();
const originalSecret = process.env.JWT_SECRET;
const realtime = { emitLeadUpdated() {}, emitExpertLeadUpdated() {} };
const invitations = { async enqueue() {} };
const contracts = new LeadContractService(prisma, realtime, invitations);
const manual = new ManualContractService(prisma, realtime);
const leads = new ExpertLeadService(prisma, realtime);
const scans = new ContractScanService(
  prisma,
  new ConfigService({ AWS_BUCKET_NAME: "phase2", AWS_MINIO_ENDPOINT: "http://127.0.0.1:1", AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" }),
);
const objects = new Map<string, Uint8Array>();
const finance = new FinanceService(prisma);
const analytics = new AnalyticsService(prisma);
const repo = Object.assign(new ContractRepository(), { prisma });
let seq = randomInt(1000000, 8000000);
let app: INestApplication;
let expert: number, otherExpert: number, admin: number;
const paidAt = "2026-01-31T10:00:00Z";
const signedAt = "2026-01-30T10:00:00Z";
function identity(overrides = {}) {
  return {
    firstname: "Алия",
    lastname: "Омарова",
    middlename: "Сериковна",
    email: `${runId}-${++seq}@example.test`,
    phone: `+7701${seq}`,
    subscriptionTier: "EXPERT_MENTORSHIP",
    price: 1500000,
    currency: "KZT",
    ...overrides,
  };
}
async function user(code: string) {
  const dto = identity();
  const user = await prisma.user.create({
    data: { firstname: dto.firstname, lastname: dto.lastname, email: dto.email, phoneNumber: dto.phone, password: "test-only", role: { connect: { code } } },
  });
  if (code === "EXPERT") await prisma.consultantProfile.create({ data: { userId: user.id, isActive: true } });
  return user;
}
async function fixture(overrides = {}, parent = false) {
  const lead = await prisma.lead.create({
    data: { assignedExpertUserId: expert, status: "RECALL", role: parent ? "parent" : "student", displayName: "Original parent name", email: `${runId}-parent@example.test` },
  });
  const dto = identity(overrides);
  return { lead, dto, path: `/expert/leads/${lead.id}/contract` };
}
function http(id: number, method: "get" | "post" | "patch", path: string) {
  return request(app.getHttpServer())
    [method](path)
    .set("Authorization", `Bearer ${jwt.sign({ sub: id }, { secret })}`);
}
async function prepare(overrides = {}) {
  const f = await fixture(overrides);
  await http(expert, "post", f.path).send(f.dto).expect(201);
  return f;
}
before(async () => {
  Logger.overrideLogger(false);
  process.env.JWT_SECRET = secret;
  await prisma.$connect();
  for (const code of ["EXPERT", "STUDENT", "ADMIN"]) await prisma.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const permission = await prisma.permission.upsert({
    where: { code: "EXPERT_LEAD_CALLS_RESPOND" },
    create: { code: "EXPERT_LEAD_CALLS_RESPOND", name: "Expert calls" },
    update: {},
  });
  await prisma.role.update({ where: { code: "EXPERT" }, data: { permissions: { connect: { id: permission.id } } } });
  expert = (await user("EXPERT")).id;
  otherExpert = (await user("EXPERT")).id;
  admin = (await user("ADMIN")).id;
  mock.method(S3Client.prototype, "send", async (command: any) => {
    if (command instanceof PutObjectCommand) objects.set(command.input.Key!, command.input.Body as Uint8Array);
    if (command instanceof GetObjectCommand) return { ContentType: "application/pdf", Body: { transformToByteArray: async () => objects.get(command.input.Key!) } };
    return {};
  });
  const module = await Test.createTestingModule({
    controllers: [ExpertLeadController, ManualContractController, ExpertContractController, ContractController, AdminController, AnalyticsController, ContractScanController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: LeadRealtimeGateway, useValue: realtime },
      { provide: AdminService, useValue: {} },
      { provide: FinanceService, useValue: finance },
      { provide: AnalyticsService, useValue: analytics },
      { provide: ContractScanService, useValue: scans },
      { provide: LeadContractService, useValue: contracts },
      { provide: ExpertLeadService, useValue: leads },
      { provide: LeadGuestMeetingService, useValue: {} },
      { provide: LeadStudentInvitationService, useValue: invitations },
      { provide: ManualContractService, useValue: manual },
      { provide: ContractService, useValue: new ContractService(repo, {}, { enqueue() {} }, {}, { logEvent: async () => {} }, realtime) },
      { provide: ExistsValidator, useValue: new ExistsValidator(prisma) },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(new JwtAuthGuard(new Reflector(), jwt, prisma))
    .overrideGuard(RolesGuard)
    .useValue(new RolesGuard(new Reflector()))
    .compile();
  useContainer(module, { fallbackOnErrors: true });
  app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  // The suite owns the listener; Supertest must not listen/close for each request.
  await app.listen(0, "127.0.0.1");
});
after(async () => {
  mock.restoreAll();
  await app?.close();
  await prisma.$disconnect();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

async function assignedStudent() {
  const student = await user("STUDENT");
  const profile = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: expert } });
  await prisma.studentPortrait.create({ data: { userId: student.id, consultantProfileId: profile.id } });
  return student;
}
async function legacyContract(currency: string, price: number, status: "SIGNED" | "PAID" = "PAID") {
  const student = await assignedStudent();
  return prisma.contract.create({
    data: { studentId: student.id, signedByUserId: expert, price, currency, status, subscriptionTier: "EXPERT_MENTORSHIP", contractNumber: `PHASE2-${randomUUID()}` },
  });
}

async function cohortStudent(year: number, overrides: any = {}, role = "STUDENT") {
  await prisma.role.upsert({ where: { code: role }, create: { code: role, name: role }, update: {} });
  const student = await user(role);
  await prisma.user.update({ where: { id: student.id }, data: { createdAt: new Date(`${year}-01-15T00:00:00Z`), ...overrides.user } });
  await prisma.studentPortrait.create({ data: { userId: student.id, currentStep: "DISCOVERY", educationLevel: "NONE", ...overrides.portrait } });
  return student;
}
const yearQuery = (year: number) => ({ dateFrom: `${year}-01-01T00:00:00Z`, dateTo: `${year}-12-31T23:59:59Z` });

test("R03 paid CRM student is not lost even with backdated payment and DISCOVERY/NONE", async () => {
  const f = await prepare();
  const r = await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1500000 }).expect(201);
  await prisma.user.update({ where: { id: r.body.contract.studentId }, data: { createdAt: new Date("2026-02-01T00:00:00Z") } });
  const q = { dateFrom: "2026-02-01T00:00:00Z", dateTo: "2026-02-01T00:00:00Z" };
  const summary = await http(admin, "get", "/admin/analytics/summary").query(q).expect(200);
  assert.equal(summary.body.totalStudents, 1);
  assert.equal(summary.body.paymentsCompletedCount, 1);
  assert.equal(summary.body.lostLeads, 0);
  assert.equal(summary.body.averageDaysToPayment, null);
});

test("R03 shared inclusive registration cohort, education/country filters and empty range", async () => {
  for (const date of ["2001-01-09T23:59:59.999Z", "2001-01-10T00:00:00Z", "2001-01-20T00:00:00Z", "2001-01-20T00:00:00.001Z"])
    await cohortStudent(2001, { user: { createdAt: new Date(date) } });
  await cohortStudent(2001, { portrait: { educationLevel: "HIGH_SCHOOL" } });
  const q = { dateFrom: "2001-01-10T00:00:00Z", dateTo: "2001-01-20T00:00:00Z" };
  const summary = await analytics.getSummary(q);
  assert.equal(summary.totalStudents, 3);
  assert.equal(summary.lostLeads, 2);
  assert.equal((await analytics.getFunnel(q)).find((r: any) => r.stage === "DISCOVERY").count, 3);
  const educated = await analytics.getSummary({ ...q, educationLevel: "HIGH_SCHOOL" });
  assert.equal(educated.totalStudents, 1);
  assert.equal(educated.lostLeads, 0);
  assert.equal((await analytics.getSummary({ ...q, educationLevel: "NONE" })).lostLeads, 2);
  for (const empty of [{ ...q, country: "NO_SUCH_COUNTRY" }, { dateTo: "1900-01-01T00:00:00Z" }, { dateFrom: q.dateTo, dateTo: q.dateFrom }]) {
    const r = await analytics.getSummary(empty);
    assert.equal(r.totalStudents, 0);
    assert.equal(r.lostLeads, 0);
  }
});

test("R03 legacy without events, converted/payment evidence and rejected pre-account lead", async () => {
  const stalled = await cohortStudent(2002);
  for (const kind of ["paid", "receipt", "gateway", "converted", "event", "progressed", "rejected"]) {
    const s = await cohortStudent(2002, { portrait: { currentStep: kind === "progressed" ? "UNI_SELECTION" : kind === "rejected" ? "GAP_YEAR" : "DISCOVERY" } });
    if (kind === "event") await prisma.userJourneyEvent.create({ data: { userId: s.id, eventType: "LEAD_CONVERTED" } });
    if (kind === "gateway") await prisma.transaction.create({ data: { userId: s.id, amount: 499, currency: "USD", subscriptionTier: "AI_ROADMAP", status: "SUCCESS" } });
    if (["paid", "receipt", "converted"].includes(kind)) {
      const c = await prisma.contract.create({
        data: { studentId: s.id, contractNumber: randomUUID(), price: 750000, currency: "KZT", subscriptionTier: "AI_ROADMAP", status: kind === "paid" ? "PAID" : "SIGNED" },
      });
      if (kind === "receipt")
        await prisma.contractInstallment.create({ data: { contractId: c.id, number: 1, amount: 250000, dueDate: new Date(paidAt), paidAt: new Date(paidAt) } });
      if (kind === "converted") await prisma.lead.create({ data: { contractId: c.id, status: "CONVERTED" } });
    }
  }
  await prisma.lead.create({ data: { status: "REJECTED", createdAt: new Date("2002-01-15") } });
  const r = await analytics.getSummary(yearQuery(2002));
  assert.equal(r.totalStudents, 8);
  assert.equal(r.lostLeads, 1);
  assert.equal(r.paymentsCompletedCount, 0);
  assert.equal(await prisma.userJourneyEvent.count({ where: { userId: stalled.id } }), 0);
});

test("R03 seven-day boundary is inclusive and does not replace registration filters", async () => {
  const clock = mock.method(Date, "now", () => new Date("2003-01-22T00:00:00Z").getTime());
  try {
    await cohortStudent(2003);
    await cohortStudent(2003, { user: { createdAt: new Date("2003-01-15T00:00:00.001Z") } });
    const r = await analytics.getSummary(yearQuery(2003));
    assert.equal(r.totalStudents, 2);
    assert.equal(r.lostLeads, 1);
  } finally {
    clock.mock.restore();
  }
});

for (const role of ["STUDENT", "SCHOOLBOY"])
  test(`R04 ${role} reuse and manual payment are visible in summary/events/journey`, async () => {
    const s = await cohortStudent(role === "STUDENT" ? 2004 : 2005, {}, role);
    const f = await prepare({ email: s.email, phone: s.phoneNumber });
    const r = await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1500000, existingStudentId: s.id }).expect(201);
    assert.equal(r.body.contract.studentId, s.id);
    const summary = await analytics.getSummary(yearQuery(role === "STUDENT" ? 2004 : 2005));
    assert.equal(summary.totalStudents, 1);
    assert.equal(summary.paymentsCompletedCount, 1);
    assert.equal(summary.lostLeads, 0);
    const events = await http(admin, "get", "/admin/analytics/events").query({ eventType: "PAYMENT_COMPLETED", limit: 100, dateFrom: paidAt, dateTo: paidAt }).expect(200);
    assert.ok(events.body.data.some((e: any) => e.studentId === s.id));
    const journey = await http(admin, "get", `/admin/analytics/student/${s.id}/journey`).expect(200);
    assert.ok(journey.body.events.some((e: any) => e.eventType === "PAYMENT_COMPLETED" && e.occurredAt === new Date(paidAt).toISOString()));
  });

test("R04 unsupported, deleted accounts and deleted student-like roles remain excluded", async () => {
  const unsupported = await cohortStudent(2006, {}, "AGENT");
  const deleted = await cohortStudent(2006, { user: { deletedAt: new Date() } });
  for (const s of [unsupported, deleted]) {
    await prisma.userJourneyEvent.create({ data: { userId: s.id, eventType: "PAYMENT_COMPLETED" } });
    await http(admin, "get", `/admin/analytics/student/${s.id}/journey`).expect(404);
  }
  const school = await cohortStudent(2006, {}, "SCHOOLBOY");
  await prisma.role.update({ where: { code: "SCHOOLBOY" }, data: { deletedAt: new Date() } });
  try {
    assert.equal((await analytics.getSummary(yearQuery(2006))).totalStudents, 0);
    await http(admin, "get", `/admin/analytics/student/${school.id}/journey`).expect(404);
    const events = await analytics.listEvents({ limit: 100 });
    assert.ok(events.data.every((e: any) => ![unsupported.id, deleted.id, school.id].includes(e.studentId)));
  } finally {
    await prisma.role.update({ where: { code: "SCHOOLBOY" }, data: { deletedAt: null } });
  }
});

test("R07 contracts HTTP pagination is bounded, validated, deterministic and keeps status/ownership", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    const c = await legacyContract("KZT", 1500000);
    await prisma.contract.update({ where: { id: c.id }, data: { createdAt: new Date("2030-01-01") } });
    ids.push(c.id);
  }
  ids.sort().reverse();
  const first = await http(expert, "get", "/contracts").query({ status: "PAID" }).expect(200);
  assert.equal(first.body.data.length, 20);
  assert.equal(first.body.limit, 20);
  assert.deepEqual(
    first.body.data.map((c: any) => c.id),
    ids.slice(0, 20),
  );
  const next = await http(expert, "get", "/contracts").query({ page: 2, status: "PAID" }).expect(200);
  assert.deepEqual(
    next.body.data.slice(0, 5).map((c: any) => c.id),
    ids.slice(20),
  );
  const other = await http(otherExpert, "get", "/contracts").expect(200);
  assert.equal(other.body.total, 0);
  for (const query of [{ page: 0 }, { page: 1.5 }, { limit: 101 }, { limit: 0 }, { status: "INVALID" }]) await http(expert, "get", "/contracts").query(query).expect(400);
  assert.equal((await http(expert, "get", "/contracts").query({ page: 999 }).expect(200)).body.data.length, 0);
  await assert.rejects(repo.findAllByStatus(undefined, expert, { limit: 101 }), (e: any) => e.getStatus() === 400);
});

test("R07 earnings totals cover all pages, retain currency and historical signer attribution", async () => {
  const owner = await user("EXPERT");
  const students = [await assignedStudent(), await assignedStudent(), await assignedStudent()];
  for (const [i, s] of students.entries())
    await prisma.contract.create({
      data: {
        studentId: s.id,
        contractNumber: randomUUID(),
        signedByUserId: owner.id,
        price: (i + 1) * 100,
        currency: i === 2 ? "EUR" : "USD",
        subscriptionTier: "AI_ROADMAP",
        status: i === 1 ? "SIGNED" : "PAID",
        createdAt: new Date("2000-01-01"),
      },
    });
  const pages: any[] = [];
  for (const page of [1, 2, 3, 4]) pages.push((await http(admin, "get", `/admin/finance/experts/${owner.id}/earnings`).query({ page, limit: 1 }).expect(200)).body);
  for (const p of pages) {
    assert.deepEqual(p.totals, pages[0].totals);
    assert.equal(p.total, 3);
    assert.equal(p.totalPages, 3);
  }
  assert.equal(pages[3].contracts.length, 0);
  assert.equal(pages[0].totals.paidAmount, null);
  assert.deepEqual(pages[0].totals.byCurrency, [
    { currency: "EUR", paidAmount: 300, signedUnpaidAmount: 0 },
    { currency: "USD", paidAmount: 100, signedUnpaidAmount: 200 },
  ]);
  assert.equal(new Set(pages.flatMap(p => p.contracts.map((c: any) => c.id))).size, 3);
  for (const query of [{ page: 0 }, { limit: 101 }]) await http(admin, "get", `/admin/finance/experts/${owner.id}/earnings`).query(query).expect(400);
  await assert.rejects(finance.getExpertEarnings(owner.id, { limit: 101 }), (e: any) => e.getStatus() === 400);
});

test("R04 SCHOOLBOY legacy gateway settlement stays visible in analytics", async () => {
  const s = await cohortStudent(2007, {}, "SCHOOLBOY");
  const profile = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: expert } });
  await prisma.studentPortrait.update({ where: { userId: s.id }, data: { consultantProfileId: profile.id } });
  await prisma.contract.create({ data: { studentId: s.id, contractNumber: randomUUID(), price: 499, currency: "USD", subscriptionTier: "EXPERT_MENTORSHIP", status: "SIGNED" } });
  const payment = await prisma.transaction.create({ data: { userId: s.id, amount: 499, currency: "USD", subscriptionTier: "EXPERT_MENTORSHIP", status: "PENDING" } });
  const TransactionRepository = klass("modules/billing/repository/payment.repository", "TransactionRepository");
  await new TransactionRepository(prisma).settleFreedomPayment({ orderId: payment.id, paymentId: String(++seq), amount: "499", currency: "USD", merchantId: "synthetic" });
  const summary = await analytics.getSummary(yearQuery(2007));
  assert.equal(summary.paymentsCompletedCount, 1);
  assert.equal(summary.lostLeads, 0);
  assert.ok((await analytics.getStudentJourney(s.id)).events.some((e: any) => e.eventType === "PAYMENT_COMPLETED"));
});

test("R07 40k contracts / 60k installments have bounded pages and SQL totals", async () => {
  const owner = await user("EXPERT");
  const profile = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: owner.id } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "STUDENT" } });
  const prefix = `phase4-volume-${randomUUID()}-`;
  // Disposable synthetic final-schema data only. Bulk SQL bypasses workflow to model volume.
  await prisma.$executeRaw`
    WITH students AS (
      INSERT INTO "User" (firstname,lastname,email,password,"roleId","createdAt","updatedAt")
      SELECT 'Synthetic', g::text, ${prefix} || g || '@example.test', 'synthetic-only', ${role.id}, '2000-01-01', '2000-01-01'
      FROM generate_series(1,40000) g RETURNING id,lastname
    ) INSERT INTO "Contract" (id,"contractNumber","studentId","signedByUserId","subscriptionTier",price,currency,status,"createdAt","updatedAt","paymentType","installmentCount","manualConfirmedAt")
      SELECT ${prefix} || lastname, ${prefix} || lastname, id, ${owner.id}, 'EXPERT_MENTORSHIP',
        CASE WHEN lastname::int <= 20000 THEN 1500000 ELSE 499 END,
        CASE WHEN lastname::int <= 20000 THEN 'KZT' WHEN lastname::int % 2 = 0 THEN 'USD' ELSE 'EUR' END,
        CASE WHEN lastname::int % 2 = 0 THEN 'PAID'::"ContractStatus" ELSE 'SIGNED'::"ContractStatus" END,
        '2000-01-01', '2000-01-01', CASE WHEN lastname::int <= 20000 THEN 'INSTALLMENT'::"ContractPaymentType" END,
        CASE WHEN lastname::int <= 20000 THEN 3 END, CASE WHEN lastname::int <= 20000 THEN '2000-02-01'::timestamp END FROM students`;
  await prisma.$executeRaw`INSERT INTO "StudentPortrait" ("userId","consultantProfileId",subscription,"updatedAt")
    SELECT "studentId", ${profile.id}, 'EXPERT_MENTORSHIP', '2000-01-01' FROM "Contract" WHERE "signedByUserId"=${owner.id}`;
  await prisma.$executeRaw`INSERT INTO "ContractInstallment" (id,"contractId",number,amount,"dueDate","paidAt")
    SELECT c.id || '-' || g, c.id, g, 500000, '2000-02-01'::timestamp + (g-1)*interval '1 month',
      CASE WHEN c.status='PAID' OR g=1 THEN '2000-02-01'::timestamp + (g-1)*interval '1 month' END
    FROM "Contract" c CROSS JOIN generate_series(1,3) g WHERE c."signedByUserId"=${owner.id} AND c.currency='KZT'`;
  assert.equal(await prisma.contractInstallment.count({ where: { contract: { signedByUserId: owner.id } } }), 60000);
  // A fresh bulk load must have planner statistics before performance assertions.
  await prisma.$executeRawUnsafe('ANALYZE "User", "StudentPortrait", "Contract", "ContractInstallment"');
  const small = await repo.findAllByStatus(undefined, owner.id);
  const large = await repo.findAllByStatus(undefined, owner.id, { limit: 100 });
  assert.equal(small.total, 40000);
  assert.equal(small.data.length, 20);
  assert.equal(large.data.length, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(small)) < 40000);
  assert.ok(Buffer.byteLength(JSON.stringify(large)) < 160000);
  const earnings = await finance.getExpertEarnings(owner.id);
  const second = await finance.getExpertEarnings(owner.id, { page: 2, limit: 100 });
  assert.equal(earnings.total, 40000);
  assert.equal(earnings.contracts.length, 20);
  assert.equal(second.contracts.length, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(earnings)) < 25000);
  assert.deepEqual(earnings.totals, second.totals);
  assert.deepEqual(earnings.totals.byCurrency, [
    { currency: "EUR", paidAmount: 0, signedUnpaidAmount: 4990000 },
    { currency: "KZT", paidAmount: 20000000000, signedUnpaidAmount: 10000000000 },
    { currency: "USD", paidAmount: 4990000, signedUnpaidAmount: 0 },
  ]);
});

test("R03 a payment committed during summary cannot appear in both lost and converted counts", async () => {
  const student = await cohortStudent(2008);
  let inserted = false;
  const observed = prisma.$extends({
    query: {
      user: {
        async count({ args, query }) {
          const result = await query(args);
          if (args.where?.AND && !inserted) {
            inserted = true;
            await prisma.userJourneyEvent.create({ data: { userId: student.id, eventType: "PAYMENT_COMPLETED", occurredAt: new Date(paidAt) } });
          }
          return result;
        },
      },
    },
  });
  const summary = await new AnalyticsService(observed).getSummary(yearQuery(2008));
  assert.equal(inserted, true);
  assert.equal(summary.lostLeads, 1);
  assert.equal(summary.paymentsCompletedCount, 0);
  const after = await analytics.getSummary(yearQuery(2008));
  assert.equal(after.lostLeads, 0);
  assert.equal(after.paymentsCompletedCount, 1);
});
