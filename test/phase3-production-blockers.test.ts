/** Run against a disposable local *_test database after nest build and migrations. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { before, after, test } from "node:test";
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
  const module = await Test.createTestingModule({
    controllers: [ExpertLeadController, ManualContractController, ExpertContractController, ContractController],
    providers: [
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
  await app?.close();
  await prisma.$disconnect();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

async function assignedStudent() {
  const student = await user("STUDENT");
  const profile = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: expert } });
  await prisma.studentPortrait.create({ data: { userId: student.id, consultantProfileId: profile.id } });
  return { student, profile };
}
async function historical(status: "SIGNED" | "PAID" = "SIGNED", benefits = false) {
  const { student, profile } = await assignedStudent();
  const contract = await prisma.contract.create({
    data: {
      studentId: student.id,
      contractNumber: randomUUID(),
      price: 1500000,
      currency: "KZT",
      subscriptionTier: "EXPERT_MENTORSHIP",
      status,
      studentSignedAt: new Date(signedAt),
      signedByUserId: expert,
    },
  });
  if (benefits) {
    await prisma.studentPortrait.update({ where: { userId: student.id }, data: { subscription: "EXPERT_MENTORSHIP" } });
    await prisma.studentPackage.create({ data: { studentId: student.id, expertId: profile.id, totalSlots: 10, usedSlots: 10 } });
  }
  return { contract, student, profile };
}
const receipt = { signedAt, paidAt, amount: 1500000 };
async function snapshot(studentId: number) {
  return {
    contracts: await prisma.contract.findMany({ where: { studentId }, include: { installments: true } }),
    portrait: await prisma.studentPortrait.findUnique({ where: { userId: studentId } }),
    packages: await prisma.studentPackage.findMany({ where: { studentId } }),
    journey: await prisma.userJourneyEvent.findMany({ where: { userId: studentId } }),
    audit: await prisma.auditLog.findMany({ where: { entityType: "User", entityId: studentId } }),
  };
}
for (const price of [1500000, 750000])
  test(`R08 HTTP FREE at ${price} is rejected for expert and ADMIN`, async () => {
    for (const actor of [expert, admin]) {
      const { student } = await assignedStudent();
      await http(actor, "post", "/contracts").send({ studentId: student.id, price, currency: "KZT", subscriptionTier: "FREE" }).expect(400);
      assert.equal(await prisma.contract.count({ where: { studentId: student.id } }), 0);
    }
  });
test("R08 direct repository calls and concurrent retries cannot create FREE", async () => {
  const { student } = await assignedStudent();
  const attempts = await Promise.allSettled(
    [expert, admin, expert].map(actor => repo.create({ studentId: student.id, price: 1500000, currency: "KZT", subscriptionTier: "FREE" }, actor)),
  );
  for (const result of attempts) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.equal(result.reason.getStatus(), 400);
  }
  assert.equal(await prisma.contract.count({ where: { studentId: student.id } }), 0);
});
for (const [tier, price, slots] of [
  ["EXPERT_MENTORSHIP", 1500000, 10],
  ["AI_ROADMAP", 750000, 3],
] as const)
  test(`R08 valid ${tier} at ${price}: creation, metadata protection and concurrent confirmation`, async () => {
    const { student } = await assignedStudent();
    const result = await http(expert, "post", "/contracts").send({ studentId: student.id, price, currency: "KZT", subscriptionTier: tier }).expect(201);
    const c = result.body.contract ?? result.body;
    await http(expert, "patch", `/contracts/${c.id}/meta`).send({ subscriptionTier: "FREE" }).expect(200);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).subscriptionTier, tier);
    await http(expert, "patch", `/contracts/${c.id}/meta`).send({ price: 0 }).expect(400);
    const results = await Promise.all([expert, expert].map(actor => http(actor, "post", `/contracts/${c.id}/confirm-manual`).send({ ...receipt, amount: price })));
    for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(results[0].body.status, "PAID");
    assert.equal((await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: student.id } })).subscription, tier);
    assert.equal((await prisma.studentPackage.findFirstOrThrow({ where: { studentId: student.id } })).totalSlots, slots);
    assert.equal(await prisma.contractInstallment.count({ where: { contractId: c.id } }), 1);
  });
test("R08 stored FREE terms cannot be confirmed or updated via direct calls", async () => {
  const { contract, student } = await historical();
  await prisma.contract.update({ where: { id: contract.id }, data: { status: "PENDING_EXPERT", studentSignedAt: null, subscriptionTier: "FREE" } });
  const before = await snapshot(student.id);
  await assert.rejects(repo.updateMeta(contract.id, { price: 750000 }, admin), e => (e as any).getStatus() === 400);
  await assert.rejects(manual.confirm(contract.id, admin, receipt), e => (e as any).getStatus() === 400);
  assert.deepEqual(await snapshot(student.id), before);
});
test("R08 CRM validates direct prepare and stored draft again before account creation", async () => {
  const f = await fixture({ subscriptionTier: "FREE" });
  await assert.rejects(contracts.prepare(expert, f.lead.id, f.dto), e => (e as any).getStatus() === 400);
  const valid = await prepare();
  const draft = await prisma.leadContractDraft.findUniqueOrThrow({ where: { leadId: valid.lead.id } });
  await prisma.leadContractDraft.update({ where: { leadId: valid.lead.id }, data: { data: { ...(draft.data as any), subscriptionTier: "FREE" } } });
  await assert.rejects(contracts.confirm(expert, valid.lead.id, receipt), e => (e as any).getStatus() === 400);
  assert.equal(await prisma.user.count({ where: { email: valid.dto.email } }), 0);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: valid.lead.id } })).contractId, null);
});
test("R02 historical SIGNED with existing fully consumed benefits confirms without regrant", async () => {
  const { contract, student } = await historical("SIGNED", true);
  const before = await prisma.studentPackage.findMany({ where: { studentId: student.id } });
  await http(expert, "post", `/contracts/${contract.id}/confirm-manual`).send(receipt).expect(201);
  await http(expert, "post", `/contracts/${contract.id}/confirm-manual`).send(receipt).expect(201);
  assert.deepEqual(await prisma.studentPackage.findMany({ where: { studentId: student.id } }), before);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status, "PAID");
});
test("R02 missing historical benefits: expert, ADMIN and concurrent retries fail closed without mutations", async () => {
  const { contract, student } = await historical();
  const before = await snapshot(student.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    const results = await Promise.all([expert, admin].map(actor => http(actor, "post", `/contracts/${contract.id}/confirm-manual`).send(receipt)));
    for (const r of results) {
      assert.equal(r.status, 409);
      assert.equal(r.body.code, "HISTORICAL_BENEFITS_REVIEW_REQUIRED");
    }
  }
  assert.deepEqual(await snapshot(student.id), before);
});
for (const anomaly of ["tier", "capacity", "usage", "owner", "multiple-contracts"])
  test(`R02 ambiguous historical ${anomaly} requires review`, async () => {
    const { contract, student, profile } = await historical("SIGNED", true);
    if (anomaly === "tier") await prisma.studentPortrait.update({ where: { userId: student.id }, data: { subscription: "FREE" } });
    if (anomaly === "capacity" || anomaly === "usage")
      await prisma.studentPackage.update({
        where: { studentId_expertId: { studentId: student.id, expertId: profile.id } },
        data: anomaly === "capacity" ? { totalSlots: 3, usedSlots: 0 } : { usedSlots: 11 },
      });
    if (anomaly === "owner") {
      const other = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: otherExpert } });
      await prisma.studentPortrait.update({ where: { userId: student.id }, data: { consultantProfileId: other.id } });
    }
    if (anomaly === "multiple-contracts")
      await prisma.contract.create({ data: { studentId: student.id, contractNumber: randomUUID(), price: 750000, currency: "KZT", subscriptionTier: "AI_ROADMAP" } });
    const before = await snapshot(student.id);
    const r = await http(admin, "post", `/contracts/${contract.id}/confirm-manual`).send(receipt).expect(409);
    assert.equal(r.body.code, "HISTORICAL_BENEFITS_REVIEW_REQUIRED");
    assert.deepEqual(await snapshot(student.id), before);
  });
test("R02 historical PAID keeps its existing conflict policy", async () => {
  const { contract, student } = await historical("PAID");
  const before = await snapshot(student.id);
  const r = await http(admin, "post", `/contracts/${contract.id}/confirm-manual`).send(receipt).expect(409);
  assert.match(r.body.message, /already fully paid/);
  assert.deepEqual(await snapshot(student.id), before);
});
test("R02 new manual SIGNED installments and first-receipt retry remain valid after transfer", async () => {
  const f = await prepare({ paymentType: "INSTALLMENT", installmentCount: 2 });
  const body = { ...receipt, amount: 750000 };
  const r = await http(expert, "post", `${f.path}/confirm`).send(body).expect(201);
  const c = r.body.contract;
  assert.equal(c.status, "SIGNED");
  assert.ok(c.manualConfirmedAt);
  const next = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: otherExpert } });
  await prisma.studentPortrait.update({ where: { userId: c.studentId }, data: { consultantProfileId: next.id } });
  await http(otherExpert, "post", `/contracts/${c.id}/confirm-manual`).send(body).expect(201);
  await http(otherExpert, "post", `/contracts/${c.id}/installments/2/confirm`).send({ amount: 750000, paidAt: "2026-02-28T10:00:00Z" }).expect(201);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "PAID");
  assert.equal((await prisma.studentPackage.findFirstOrThrow({ where: { studentId: c.studentId } })).totalSlots, 10);
});

test("R02 read-only audit classifies synthetic final-schema candidates without treating payments as grant proof", async () => {
  const known = await historical("SIGNED", true);
  const missing = await historical();
  const paid = await historical("PAID");
  await prisma.transaction.create({
    data: {
      userId: missing.student.id,
      amount: 750000,
      currency: "KZT",
      status: "SUCCESS",
      subscriptionTier: "AI_ROADMAP",
      providerRef: `synthetic-${randomUUID()}`,
    },
  });
  const before = await snapshot(missing.student.id);
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    for (const file of ["final-release-historical.sql", "phase3-historical-benefits.sql"]) {
      const results = await client.query(await readFile(resolve("deployment/audits", file), "utf8"));
      const queries = (Array.isArray(results) ? results : [results]).filter(r => r.command === "SELECT");
      console.log("PHASE3_AUDIT", JSON.stringify({ file, queries: queries.map(r => ({ audit: r.rows[0]?.audit ?? null, rows: r.rowCount })) }));
      if (file === "phase3-historical-benefits.sql") {
        const candidates = queries[0].rows;
        assert.ok(!candidates.some(r => r.contractId === known.contract.id || r.contractId === paid.contract.id));
        const candidate = candidates.find(r => r.contractId === missing.contract.id);
        assert.ok(candidate);
        assert.equal(candidate.classification, "C_AMBIGUOUS_REVIEW_REQUIRED");
        assert.ok(candidate.reviewReasons.includes("CURRENT_OWNER_PACKAGE_MISSING_OR_TRANSFERRED"));
        assert.equal(candidate.gatewayEvidence.length, 1);
        assert.equal(candidate.packages.length, 0);
        assert.ok(!("email" in candidate));
      } else {
        assert.equal(queries.length, 26);
        for (const audit of ["M07", "P03", "P05"])
          assert.ok(
            queries.some(r =>
              r.rows.some(
                row =>
                  row.audit === audit &&
                  (row.id === missing.contract.id || row.contractId === missing.contract.id || row.studentId === missing.student.id || row.userId === missing.student.id),
              ),
            ),
          );
      }
    }
  } finally {
    await client.end();
  }
  assert.deepEqual(await snapshot(missing.student.id), before);
});
