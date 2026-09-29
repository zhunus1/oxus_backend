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
const scanFile = Buffer.from("%PDF-1.7 phase2 scan");
const finance = new FinanceService(prisma);
const analytics = new AnalyticsService(prisma);
const repo = Object.assign(new ContractRepository(), { prisma });
let seq = randomInt(100000000, 800000000);
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
    phone: `+77${seq}`,
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

test("F07: mixed currency summary and earnings never return an unlabelled combined amount", async () => {
  await legacyContract("USD", 100);
  await legacyContract("EUR", 200);
  await legacyContract("USD", 50, "SIGNED");
  const f = await prepare({ paymentType: "INSTALLMENT", installmentCount: 3 });
  await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 500000 }).expect(201);
  const summary = (await http(admin, "get", "/admin/finance/summary").expect(200)).body;
  assert.equal(summary.totalPaidAmount, null);
  assert.equal(summary.totalSignedAmount, null);
  const earning = (await http(admin, "get", `/admin/finance/experts/${expert}/earnings`).expect(200)).body;
  assert.equal(earning.totals.paidAmount, null);
  assert.deepEqual(
    earning.totals.byCurrency.map((r: any) => [r.currency, r.paidAmount, r.signedUnpaidAmount]),
    [
      ["EUR", 200, 0],
      ["KZT", 500000, 1000000],
      ["USD", 100, 50],
    ],
  );
  const expertSummary = summary.earningsByExpert.find((row: any) => row.id === expert);
  assert.equal(expertSummary.totalPaidAmount, null);
  assert.equal(expertSummary.contractCount, 4);
  assert.equal(expertSummary.paidContractCount, 2);
  assert.deepEqual(
    expertSummary.byCurrency.map((row: any) => [row.currency, row.totalSignedAmount, row.totalPaidAmount, row.signedUnpaidAmount]),
    [
      ["EUR", 200, 200, 0],
      ["KZT", 1500000, 500000, 1000000],
      ["USD", 150, 100, 50],
    ],
  );
});

test("F08: manual confirmation records signature, first payment and conversion exactly once", async () => {
  const f = await prepare();
  const body = { signedAt, paidAt, amount: 1500000 };
  const result = await http(expert, "post", `${f.path}/confirm`).send(body).expect(201);
  const studentId = result.body.contract.studentId;
  const events = await prisma.userJourneyEvent.findMany({ where: { userId: studentId } });
  assert.deepEqual(events.map(e => e.eventType).sort(), ["CONTRACT_SIGNED", "LEAD_CONVERTED", "PAYMENT_COMPLETED"]);
  const pay = events.find(e => e.eventType === "PAYMENT_COMPLETED") as any;
  assert.equal(pay.occurredAt.toISOString(), new Date(paidAt).toISOString());
  const journey = await analytics.getStudentJourney(studentId);
  assert(journey.stageDurations.every((r: any) => r.durationMs === null || r.durationMs >= 0));
});

test("F09: summary and list use identical search/source filters", async () => {
  const source = await prisma.leadSource.upsert({ where: { code: "office-manual" }, create: { code: "office-manual", name: "Office" }, update: {} });
  await prisma.lead.create({ data: { assignedExpertUserId: expert, status: "CONTRACT_PENDING", displayName: `filter-${runId}`, originSourceId: source.id } });
  const query = { search: `missing-${runId}`, source: "office-manual", tab: "SIGNING", page: 1, limit: 20 };
  const list = await http(expert, "get", "/expert/leads").query(query).expect(200);
  const summary = await http(expert, "get", "/expert/leads/summary").query(query).expect(200);
  assert.equal(summary.body.SIGNING, list.body.meta.total);
});

test("F10: ADMIN may update unsigned CRM terms without taking historical ownership", async () => {
  const c = await legacyContract("KZT", 1500000);
  await prisma.contract.update({ where: { id: c.id }, data: { status: "PENDING_EXPERT" } });
  await prisma.lead.create({ data: { assignedExpertUserId: expert, status: "CONTRACT_PENDING", contractId: c.id } });
  await http(admin, "patch", `/contracts/${c.id}/meta`).send({ price: 750000 }).expect(200);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).signedByUserId, expert);
  await http(otherExpert, "patch", `/contracts/${c.id}/meta`).send({ price: 1500000 }).expect(403);
});

test("F07: single currency totals stay numeric; rows, legacy and manual receipts agree without double counting", async () => {
  const owner = await user("EXPERT");
  const student = await user("STUDENT");
  const c = await prisma.contract.create({
    data: {
      studentId: student.id,
      signedByUserId: owner.id,
      price: 100.03,
      currency: "EUR",
      status: "SIGNED",
      subscriptionTier: "AI_ROADMAP",
      contractNumber: randomUUID(),
      manualConfirmedAt: new Date(),
      paymentType: "INSTALLMENT",
      installmentCount: 3,
    },
  });
  await prisma.contractInstallment.createMany({
    data: [
      { contractId: c.id, number: 1, amount: "33.35", dueDate: new Date(paidAt), paidAt: new Date(paidAt) },
      { contractId: c.id, number: 2, amount: "33.34", dueDate: new Date(paidAt), paidAt: new Date(paidAt) },
      { contractId: c.id, number: 3, amount: "33.34", dueDate: new Date(paidAt) },
    ],
  });
  let earnings = await finance.getExpertEarnings(owner.id);
  assert.equal(earnings.totals.currency, "EUR");
  assert.equal(earnings.totals.paidAmount, 66.69);
  assert.equal(earnings.totals.signedUnpaidAmount, 33.34);
  const list = await http(admin, "get", "/admin/finance/contracts").query({ expertId: owner.id }).expect(200);
  assert.equal(list.body.data[0].currency, "EUR");
  assert.equal(list.body.data[0].paidAmount, 66.69);
  assert.equal(list.body.data[0].remainingAmount, 33.34);
  await prisma.contractInstallment.update({ where: { contractId_number: { contractId: c.id, number: 3 } }, data: { paidAt: new Date(paidAt) } });
  await prisma.contract.update({ where: { id: c.id }, data: { status: "PAID" } });
  earnings = await finance.getExpertEarnings(owner.id);
  assert.equal(earnings.totals.paidAmount, 100.03);
  const summary = await finance.getSummary();
  const row = summary.earningsByExpert.find((r: any) => r.id === owner.id);
  assert.equal(row.totalPaidAmount, 100.03);
  assert.equal(row.totalSignedAmount, 100.03);
  assert.equal(row.paidContractCount, 1);
  const empty = await finance.getExpertEarnings(otherExpert);
  assert.equal(empty.totals.paidAmount, 0);
  assert.deepEqual(empty.totals.byCurrency, []);
});

for (const count of [1, 3])
  test(`F08: ${count === 1 ? "FULL" : "INSTALLMENT"} concurrent confirmation and retries create one set of backdated milestones`, async () => {
    const f = await prepare({ paymentType: count === 1 ? "FULL" : "INSTALLMENT", installmentCount: count });
    const body = { signedAt, paidAt, amount: 1500000 / count };
    const results = await Promise.all([http(expert, "post", `${f.path}/confirm`).send(body), http(expert, "post", `${f.path}/confirm`).send(body)]);
    for (const result of results) assert.equal(result.status, 201, JSON.stringify(result.body));
    const c = results[0].body.contract;
    await http(expert, "post", `${f.path}/confirm`).send(body).expect(201);
    let events = await prisma.userJourneyEvent.findMany({ where: { userId: c.studentId } });
    assert.equal(events.length, 3);
    const payment = events.find(e => e.eventType === "PAYMENT_COMPLETED")!;
    const student = await prisma.user.findUniqueOrThrow({ where: { id: c.studentId } });
    assert.equal(+payment.occurredAt!, +new Date(paidAt));
    assert(payment.createdAt >= student.createdAt && payment.createdAt > payment.occurredAt!);
    const journey = (await http(admin, "get", `/admin/analytics/student/${c.studentId}/journey`).expect(200)).body;
    assert.equal(journey.stageDurations.find((r: any) => r.stage === "VISA_SUPPORT").durationMs, 86400000);
    const filtered = await http(admin, "get", "/admin/analytics/events")
      .query({ eventType: "PAYMENT_COMPLETED", dateFrom: "2026-01-31T00:00:00Z", dateTo: "2026-02-01T00:00:00Z", limit: 100 })
      .expect(200);
    assert(filtered.body.data.some((e: any) => e.studentId === c.studentId && e.occurredAt === new Date(paidAt).toISOString()));
    if (count > 1) {
      const before = await analytics.getSummary({});
      const receipt = { paidAt: "2026-02-28T10:00:00Z", amount: 500000 };
      const second = await Promise.all([
        http(expert, "post", `/contracts/${c.id}/installments/2/confirm`).send(receipt),
        http(expert, "post", `/contracts/${c.id}/installments/2/confirm`).send(receipt),
      ]);
      for (const result of second) assert.equal(result.status, 201);
      await http(expert, "post", `/contracts/${c.id}/installments/2/confirm`).send(receipt).expect(201);
      const after = await analytics.getSummary({});
      assert.equal(after.paymentsCompletedCount, before.paymentsCompletedCount);
      assert.equal(after.conversionToPaymentPercent, before.conversionToPaymentPercent);
      events = await prisma.userJourneyEvent.findMany({ where: { userId: c.studentId } });
      assert.equal(events.filter(e => e.eventType === "PAYMENT_COMPLETED").length, 1);
      assert.equal(events.filter(e => e.eventType === "CONTRACT_INSTALLMENT_PAID").length, 1);
      assert.equal(+events.find(e => e.eventType === "CONTRACT_INSTALLMENT_PAID")!.occurredAt!, +new Date(receipt.paidAt));
    }
  });

test("F08: event insertion failure rolls back the account, conversion and receipt; retry records all events", async () => {
  const f = await prepare();
  const before = await prisma.userJourneyEvent.count();
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION phase2_reject_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType" = 'PAYMENT_COMPLETED' THEN RAISE EXCEPTION 'phase2 forced journey failure'; END IF; RETURN NEW; END; $$`,
  );
  await prisma.$executeRawUnsafe(`CREATE TRIGGER phase2_reject_payment_event BEFORE INSERT ON "UserJourneyEvent" FOR EACH ROW EXECUTE FUNCTION phase2_reject_payment_event()`);
  try {
    await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1500000 }).expect(500);
    assert.equal(await prisma.user.count({ where: { email: f.dto.email } }), 0);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: f.lead.id } });
    assert.equal(lead.contractId, null);
    assert.equal(lead.status, "CONTRACT_PENDING");
    assert.equal(await prisma.userJourneyEvent.count(), before);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER phase2_reject_payment_event ON "UserJourneyEvent"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION phase2_reject_payment_event()`);
  }
  const result = await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1500000 }).expect(201);
  assert.equal(await prisma.userJourneyEvent.count({ where: { userId: result.body.contract.studentId } }), 3);
});

test("F08: reversed historical chronology gives null durations; legacy events and repeated purchases count a student once", async () => {
  const student = await user("STUDENT");
  await prisma.userJourneyEvent.createMany({
    data: [
      { userId: student.id, eventType: "CONTRACT_SIGNED", createdAt: new Date("2026-02-02T00:00:00Z") },
      { userId: student.id, eventType: "PAYMENT_COMPLETED", createdAt: new Date("2026-02-01T00:00:00Z") },
    ],
  });
  const journey = await analytics.getStudentJourney(student.id);
  assert.equal(journey.stageDurations.find((row: any) => row.stage === "VISA_SUPPORT").durationMs, null);
  assert.equal(+journey.events[0].occurredAt, +journey.events[0].createdAt);
  const before = await analytics.getSummary({});
  await prisma.userJourneyEvent.create({ data: { userId: student.id, eventType: "PAYMENT_COMPLETED" } });
  const after = await analytics.getSummary({});
  assert.equal(after.paymentsCompletedCount, before.paymentsCompletedCount);
  assert.equal(after.averageDaysToPayment, before.averageDaysToPayment);
  assert(after.conversionToPaymentPercent <= 100);
});

test("F09: every tab shares search/source, owner and soft-delete filtering with summary", async () => {
  const owner = await user("EXPERT");
  const sources = await prisma.leadSource.findMany({ where: { code: { in: ["office-manual", "landing-calculator"] } } });
  assert.equal(sources.length, 2);
  for (const status of ["NEW", "CALL_SCHEDULED", "OFFICE_INVITED", "RECALL", "CONTRACT_PENDING", "CONVERTED", "REJECTED"] as const) {
    for (const source of sources) {
      for (const marker of ["needle", "other"]) {
        const data = {
          assignedExpertUserId: owner.id,
          status,
          originSourceId: source.id,
          displayName: marker,
          email: `${marker}-${runId}@example.test`,
          phoneNumber: "+77001234567",
        };
        await prisma.lead.create({ data });
        await prisma.lead.create({ data: { ...data, deletedAt: new Date() } });
        await prisma.lead.create({ data: { ...data, assignedExpertUserId: otherExpert } });
      }
    }
  }
  const sizes = { NEW: 2, FOLLOW_UP: 1, SIGNING: 1, SIGNED: 1, CONTRACTS: 2, ARCHIVE: 2 };
  for (const search of [undefined, " needle ", "OTHER", "1234567", "+7 (700) 123-45-67", "absent"]) {
    for (const source of [undefined, ...sources.map(row => row.code), "unknown-source"]) {
      const filters = { ...(search ? { search } : {}), ...(source ? { source } : {}) };
      const counters = (await http(owner.id, "get", "/expert/leads/summary").query(filters).expect(200)).body;
      const multiplicity = (source === "unknown-source" ? 0 : source ? 1 : 2) * (search === "absent" ? 0 : [" needle ", "OTHER"].includes(search ?? "") ? 1 : 2);
      for (const [tab, statuses] of Object.entries(sizes)) {
        const list = (
          await http(owner.id, "get", "/expert/leads")
            .query({ ...filters, tab, page: 1, limit: 1 })
            .expect(200)
        ).body;
        assert.equal(counters[tab], statuses * multiplicity, JSON.stringify({ filters, tab }));
        assert.equal(counters[tab], list.meta.total);
      }
      assert.equal(counters.CONTRACTS, counters.SIGNING + counters.SIGNED);
    }
  }
});

for (const crm of [false, true])
  for (const actorRole of ["owner", "foreign", "ADMIN"] as const)
    test(`F10: ${crm ? "CRM" : "non-CRM"} authorization matrix for ${actorRole}`, async () => {
      const student = await assignedStudent();
      const c = (
        await http(expert, "post", "/contracts")
          .send({ studentId: student.id, subscriptionTier: "EXPERT_MENTORSHIP", price: 1500000, currency: "KZT", paymentType: "INSTALLMENT", installmentCount: 3 })
          .expect(201)
      ).body;
      const lead = crm ? await prisma.lead.create({ data: { assignedExpertUserId: expert, status: "CONTRACT_PENDING", contractId: c.id } }) : null;
      const actor = actorRole === "owner" ? expert : actorRole === "ADMIN" ? admin : otherExpert;
      const allowed = actorRole !== "foreign";
      await http(actor, "get", `/contracts/student/${student.id}`).expect(allowed ? 200 : 403);
      await http(actor, "patch", `/contracts/${c.id}/meta`)
        .send({ installmentCount: 3 })
        .expect(allowed ? 200 : 403);
      await http(actor, "post", `/contracts/${c.id}/manual-signature`)
        .send({ signedAt })
        .expect(allowed ? 201 : 403);
      const receipt = { signedAt, paidAt, amount: 500000 };
      await http(actor, "post", `/contracts/${c.id}/confirm-manual`)
        .send(receipt)
        .expect(allowed ? 201 : 403);
      if (!allowed) await http(expert, "post", `/contracts/${c.id}/confirm-manual`).send(receipt).expect(201);
      await http(actor, "post", `/contracts/${c.id}/installments/2/confirm`)
        .send({ paidAt: "2026-02-28T10:00:00Z", amount: 500000 })
        .expect(allowed ? 201 : 403);
      const upload = (id: number) => http(id, "post", `/contracts/${c.id}/scan`).attach("file", scanFile, { filename: "scan.pdf", contentType: "application/pdf" });
      await upload(actor).expect(allowed ? 201 : 403);
      if (!allowed) await upload(expert).expect(201);
      await http(actor, "get", `/contracts/${c.id}/scan`).expect(allowed ? 200 : 403);
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).signedByUserId, expert);
      const assigned = await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: student.id }, include: { assignedExpert: true } });
      assert.equal(assigned.assignedExpert!.userId, expert);
      if (lead) assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).assignedExpertUserId, expert);
    });

test("F10: ADMIN retains business restrictions and never assigns itself to an unassigned student", async () => {
  const student = await user("STUDENT");
  const dto = { studentId: student.id, subscriptionTier: "EXPERT_MENTORSHIP", price: 1500000, currency: "KZT", paymentType: "INSTALLMENT", installmentCount: 3 };
  const c = (await http(admin, "post", "/contracts").send(dto).expect(201)).body;
  await http(admin, "post", "/contracts").send(dto).expect(409);
  await http(admin, "post", `/contracts/${c.id}/confirm-manual`).send({ signedAt, paidAt, amount: 500000 }).expect(201);
  await http(admin, "patch", `/contracts/${c.id}/meta`).send({ price: 750000 }).expect(400);
  await http(admin, "post", `/contracts/${c.id}/manual-signature`).send({ signedAt }).expect(409);
  await http(admin, "post", `/contracts/${c.id}/installments/3/confirm`).send({ paidAt: "2026-03-31T10:00:00Z", amount: 500000 }).expect(400);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).signedByUserId, null);
  assert.equal((await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: student.id } })).consultantProfileId, null);
  await prisma.user.update({ where: { id: student.id }, data: { deletedAt: new Date() } });
  await http(admin, "get", `/contracts/student/${student.id}`).expect(403);
  await http(admin, "post", `/contracts/${c.id}/installments/2/confirm`).send({ paidAt: "2026-02-28T10:00:00Z", amount: 500000 }).expect(403);
});

test("F10: deleted CRM lead and disabled ADMIN cannot bypass contract rules", async () => {
  const c = await legacyContract("KZT", 1500000);
  await prisma.contract.update({ where: { id: c.id }, data: { status: "PENDING_EXPERT" } });
  await prisma.lead.create({ data: { assignedExpertUserId: expert, contractId: c.id, status: "CONTRACT_PENDING", deletedAt: new Date() } });
  await http(admin, "patch", `/contracts/${c.id}/meta`).send({ price: 750000 }).expect(403);
  await http(admin, "post", `/contracts/${c.id}/confirm-manual`).send({ signedAt, paidAt, amount: 1500000 }).expect(403);
  const disabled = await user("ADMIN");
  await prisma.user.update({ where: { id: disabled.id }, data: { deletedAt: new Date() } });
  await http(disabled.id, "get", `/contracts/student/${c.studentId}`).expect(401);
  await assert.rejects(
    () => manual.confirm(c.id, disabled.id, { signedAt, paidAt, amount: 1500000 }, true),
    (error: any) => error.status === 403,
  );
});
