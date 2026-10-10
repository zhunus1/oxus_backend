/** Run against a disposable local *_test database after nest build and migrations. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
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
const finance = new FinanceService(prisma);
const repo = Object.assign(new ContractRepository(), { prisma });
let seq = randomInt(100000000, 800000000);
let app: INestApplication;
let expert: number, otherExpert: number, studentActor: number;
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
  studentActor = (await user("STUDENT")).id;
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

test("draft and manual signature leave no account, contract, invitation or payment", async () => {
  const f = await prepare();
  const draft = await prisma.leadContractDraft.findUniqueOrThrow({ where: { leadId: f.lead.id } });
  assert.equal((draft.data as any).middlename, "Сериковна");
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: f.lead.id } });
  assert.equal(lead.status, "CONTRACT_PENDING");
  assert.equal(lead.contractId, null);
  await http(expert, "post", `${f.path}/signature`).send({ signedAt }).expect(201);
  assert.equal(await prisma.user.count({ where: { email: f.dto.email } }), 0);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).statusChangedAt.getTime(), lead.statusChangedAt.getTime());
  await http(expert, "patch", f.path)
    .send({ ...f.dto, price: 750000 })
    .expect(409);
});

test("parent identity is separate; original lead and questionnaire contacts are preserved", async () => {
  const f = await fixture({}, true);
  await http(expert, "post", f.path).send(f.dto).expect(400);
  const parent = { firstname: "Марат", lastname: "Омаров", middlename: "Серикович", phone: "+77001234567" };
  await http(expert, "post", f.path)
    .send({ ...f.dto, parent })
    .expect(201);
  const result = await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1500000 }).expect(201);
  const child = await prisma.user.findUniqueOrThrow({ where: { id: result.body.contract.studentId } });
  assert.equal(child.firstname, "Алия");
  assert.equal(child.phoneNumber, f.dto.phone);
  assert.equal(result.body.contract.clientFullName, "Омаров Марат Серикович");
  assert.equal(result.body.lead.displayName, "Original parent name");
});

test("missing signature, wrong receipt, future dates and foreign expert cannot create an account", async () => {
  const f = await prepare();
  await http(expert, "post", `${f.path}/confirm`).send({ paidAt, amount: 1500000 }).expect(400);
  await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1 }).expect(400);
  await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt: "2099-01-01T00:00:00Z", amount: 1500000 }).expect(400);
  await http(otherExpert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1500000 }).expect(404);
  await http(studentActor, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1500000 }).expect(403);
  assert.equal(await prisma.user.count({ where: { email: f.dto.email } }), 0);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: f.lead.id } })).contractId, null);
});

test("concurrent confirmation creates exactly one account, invitation and package", async () => {
  const f = await prepare();
  const body = { signedAt, paidAt, amount: 1500000 };
  const responses = await Promise.all([http(expert, "post", `${f.path}/confirm`).send(body), http(expert, "post", `${f.path}/confirm`).send(body)]);
  for (const result of responses) assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(responses[0].body.contract.id, responses[1].body.contract.id);
  const { contract, lead } = responses[0].body;
  assert(!("studentOtpHash" in contract));
  assert(!("expertOtpHash" in contract));
  assert.equal(lead.status, "CONVERTED");
  assert.equal(contract.status, "PAID");
  assert.equal(await prisma.user.count({ where: { email: f.dto.email } }), 1);
  assert.equal(await prisma.leadStudentInvitation.count({ where: { userId: contract.studentId } }), 1);
  const packages = await prisma.studentPackage.findMany({ where: { studentId: contract.studentId } });
  assert.equal(packages.length, 1);
  assert.equal(packages[0].totalSlots, 10);
  assert.equal(await prisma.contractInstallment.count({ where: { contractId: contract.id } }), 1);
  const preparedAgain = await http(expert, "post", f.path).send(f.dto).expect(201);
  assert.equal(preparedAgain.body.invitationRequired, true);
  assert.equal(preparedAgain.body.contract.id, contract.id);
  await http(expert, "post", `${f.path}/confirm`)
    .send({ ...body, amount: 750000 })
    .expect(409);
});

test("installments count actual receipts, preserve dates and mark PAID only after the last tranche", async () => {
  const before = await finance.getSummary();
  const f = await prepare({ paymentType: "INSTALLMENT", installmentCount: 3 });
  await http(expert, "post", `${f.path}/signature`).send({ signedAt }).expect(201);
  const result = await http(expert, "post", `${f.path}/confirm`).send({ paidAt, amount: 500000 }).expect(201);
  const c = result.body.contract;
  assert.equal(c.status, "SIGNED");
  assert.equal(c.paidAt, null);
  assert.deepEqual(
    c.installments.map((i: any) => i.dueDate.slice(0, 10)),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  assert.equal(
    ((await finance.getSummary()).byCurrency.find((row: any) => row.currency === "KZT")?.totalPaidAmount ?? 0) -
      (before.byCurrency.find((row: any) => row.currency === "KZT")?.totalPaidAmount ?? 0),
    500000,
  );
  const stageDate = result.body.lead.statusChangedAt;
  await http(expert, "post", `/contracts/${c.id}/installments/3/confirm`).send({ paidAt: "2026-03-31T10:00:00Z", amount: 500000 }).expect(400);
  await http(otherExpert, "post", `/contracts/${c.id}/installments/2/confirm`).send({ paidAt: "2026-02-28T10:00:00Z", amount: 500000 }).expect(403);
  for (const [number, date] of [
    [2, "2026-02-28"],
    [3, "2026-03-31"],
  ]) {
    const body = { paidAt: `${date}T10:00:00Z`, amount: 500000 };
    await http(expert, "post", `/contracts/${c.id}/installments/${number}/confirm`).send(body).expect(201);
    await http(expert, "post", `/contracts/${c.id}/installments/${number}/confirm`).send(body).expect(201);
  }
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "PAID");
  assert.equal(
    ((await finance.getSummary()).byCurrency.find((row: any) => row.currency === "KZT")?.totalPaidAmount ?? 0) -
      (before.byCurrency.find((row: any) => row.currency === "KZT")?.totalPaidAmount ?? 0),
    1500000,
  );
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: f.lead.id } })).statusChangedAt.toISOString(), stageDate);
});

test("Cambridge price and schedule validation", async () => {
  for (const body of [{ price: 100000 }, { paymentType: "INSTALLMENT" }, { paymentType: "FULL", installmentCount: 2 }, { installmentCount: 0 }, { currency: "USD" }]) {
    const f = await fixture(body);
    await http(expert, "post", f.path).send(f.dto).expect(400);
  }
  const f = await prepare({ price: 750000 });
  const result = await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 750000 }).expect(201);
  assert.equal(result.body.contract.price, 750000);
  const preview = await http(expert, "post", "/contracts/payment-schedule/preview")
    .send({ price: 750000, currency: "KZT", paymentType: "INSTALLMENT", installmentCount: 3, firstPaidAt: paidAt })
    .expect(201);
  assert.equal(preview.body.installments.length, 3);
});

test("all plan writers reject four or more installments without changing existing terms", async () => {
  const f = await prepare({ paymentType: "INSTALLMENT", installmentCount: 3 });
  const existing = await user("STUDENT");
  const owner = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: expert } });
  await prisma.studentPortrait.create({ data: { userId: existing.id, consultantProfileId: owner.id } });
  const direct = { studentId: existing.id, subscriptionTier: "EXPERT_MENTORSHIP", price: 1500000, currency: "KZT", paymentType: "INSTALLMENT", installmentCount: 3 };
  const created = await http(expert, "post", "/contracts").send(direct).expect(201);
  const draft = await prisma.leadContractDraft.findUniqueOrThrow({ where: { leadId: f.lead.id } });
  for (const installmentCount of [4, 7, 120, 121]) {
    await http(expert, "post", "/contracts/payment-schedule/preview")
      .send({ price: 1500000, currency: "KZT", paymentType: "INSTALLMENT", installmentCount, firstPaidAt: paidAt })
      .expect(400);
    await http(expert, "post", f.path)
      .send({ ...f.dto, installmentCount })
      .expect(400);
    await http(expert, "patch", f.path)
      .send({ ...f.dto, installmentCount })
      .expect(400);
    await http(expert, "post", "/contracts")
      .send({ ...direct, installmentCount })
      .expect(400);
    await http(expert, "patch", `/contracts/${created.body.id}/meta`).send({ installmentCount }).expect(400);
    // Direct repository calls must enforce the limit even with historical amount compatibility.
    await assert.rejects(repo.updateMeta(created.body.id, { paymentType: "INSTALLMENT", installmentCount }, expert), /count from 2 to 3/);
  }
  assert.deepEqual((await prisma.leadContractDraft.findUniqueOrThrow({ where: { leadId: f.lead.id } })).data, draft.data);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: created.body.id } })).installmentCount, 3);
});

test("existing signed four-tranche plans keep their schedule and accept the last receipt", async () => {
  const existing = await user("STUDENT");
  const owner = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: expert } });
  await prisma.studentPortrait.create({ data: { userId: existing.id, consultantProfileId: owner.id } });
  const c = await prisma.contract.create({
    data: {
      studentId: existing.id,
      contractNumber: randomUUID(),
      price: 1500000,
      currency: "KZT",
      subscriptionTier: "EXPERT_MENTORSHIP",
      status: "SIGNED",
      paymentType: "INSTALLMENT",
      installmentCount: 4,
      manualConfirmedAt: new Date(paidAt),
      studentSignedAt: new Date(signedAt),
      expertSignedAt: new Date(signedAt),
      signedByUserId: expert,
    },
  });
  const dates = ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"];
  for (const [index, date] of dates.entries())
    await prisma.contractInstallment.create({
      data: {
        contractId: c.id,
        number: index + 1,
        amount: 375000,
        dueDate: new Date(`${date}T00:00:00Z`),
        ...(index < 3 ? { paidAt: new Date(`${date}T10:00:00Z`), confirmedAt: new Date(`${date}T10:00:00Z`), confirmedByUserId: expert } : {}),
      },
    });
  const before = await prisma.contractInstallment.findMany({ where: { contractId: c.id }, orderBy: { number: "asc" } });
  const read = await http(expert, "get", `/contracts/student/${existing.id}`).expect(200);
  assert.equal(read.body.installmentCount, 4);
  const repeated = await http(expert, "post", `/contracts/${c.id}/confirm-manual`).send({ paidAt, signedAt, amount: 375000 }).expect(201);
  assert.equal(repeated.body.installmentCount, 4);
  assert.equal(repeated.body.installments.length, 4);
  const result = await http(expert, "post", `/contracts/${c.id}/installments/4/confirm`).send({ paidAt: "2026-04-30T10:00:00Z", amount: 375000 }).expect(201);
  assert.equal(result.body.status, "PAID");
  assert.equal(result.body.installmentCount, 4);
  assert.deepEqual(
    result.body.installments.map((i: any) => ({ id: i.id, number: i.number, amount: i.amount, dueDate: i.dueDate })),
    before.map(i => ({ id: i.id, number: i.number, amount: i.amount.toString(), dueDate: i.dueDate.toISOString() })),
  );
});

test("account reuse needs explicit approval at confirmation and preserves credentials", async () => {
  const existing = await user("STUDENT");
  const f = await prepare({ email: existing.email, phone: existing.phoneNumber });
  const body = { signedAt, paidAt, amount: 1500000 };
  const rejected = await http(expert, "post", `${f.path}/confirm`).send(body).expect(409);
  assert.equal(rejected.body.code, "EXISTING_STUDENT_CONFIRMATION_REQUIRED");
  const result = await http(expert, "post", `${f.path}/confirm`)
    .send({ ...body, existingStudentId: existing.id })
    .expect(201);
  assert.equal(result.body.contract.studentId, existing.id);
  assert.equal(result.body.invitationRequired, false);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).password, "test-only");
});

test("historical pending contracts complete manually without recreating users", async () => {
  const existing = await user("STUDENT");
  await prisma.studentPortrait.create({ data: { userId: existing.id } });
  const c = await prisma.contract.create({
    data: { studentId: existing.id, contractNumber: randomUUID(), price: 100000, currency: "KZT", subscriptionTier: "EXPERT_MENTORSHIP", status: "PENDING_STUDENT" },
  });
  const lead = await prisma.lead.create({ data: { contractId: c.id, assignedExpertUserId: expert, status: "CONTRACT_PENDING" } });
  await http(expert, "post", `/contracts/${c.id}/manual-signature`).send({ signedAt }).expect(201);
  await http(expert, "post", `/contracts/${c.id}/confirm-manual`).send({ paidAt, amount: 100000 }).expect(201);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "CONVERTED");
  assert.equal(await prisma.contract.count({ where: { studentId: existing.id } }), 1);
});

test("all four online signing routes are disabled even for old pending contracts", async () => {
  for (const action of ["otp", "sign"])
    for (const side of ["expert", "student"]) {
      const result = await http(side === "expert" ? expert : studentActor, "post", `/contracts/unused/${action}/${side}`)
        .send({})
        .expect(409);
      assert.equal(result.body.code, "MANUAL_SIGNATURE_REQUIRED");
    }
});

test("expert summary splits signing and signed, preserving the combined legacy tab", async () => {
  const summary = await http(expert, "get", "/expert/leads/summary").expect(200);
  assert(summary.body.SIGNING > 0);
  assert(summary.body.SIGNED > 0);
  assert.equal(summary.body.CONTRACTS, summary.body.SIGNING + summary.body.SIGNED);
  for (const [tab, status] of [
    ["SIGNING", "CONTRACT_PENDING"],
    ["SIGNED", "CONVERTED"],
  ]) {
    const list = await http(expert, "get", `/expert/leads?tab=${tab}`).expect(200);
    assert(list.body.data.every((lead: any) => lead.status === status));
  }
});

test("historical unsigned contracts retain their amount and currency when setting manual installments", async () => {
  const existing = await user("STUDENT");
  const owner = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: expert } });
  await prisma.studentPortrait.create({ data: { userId: existing.id, consultantProfileId: owner.id } });
  const c = await prisma.contract.create({
    data: { studentId: existing.id, contractNumber: randomUUID(), price: 499, currency: "USD", subscriptionTier: "EXPERT_MENTORSHIP", status: "PENDING_STUDENT" },
  });
  await http(expert, "patch", `/contracts/${c.id}/meta`).send({ paymentType: "INSTALLMENT", installmentCount: 2 }).expect(200);
  const result = await http(expert, "post", `/contracts/${c.id}/confirm-manual`).send({ signedAt, paidAt, amount: 249.5 }).expect(201);
  assert.equal(result.body.price, 499);
  assert.equal(result.body.currency, "USD");
  assert.equal(result.body.status, "SIGNED");
  assert.equal(await repo.usesManualPayments(existing.id), true);
  assert.equal(await repo.markPaidForStudent(existing.id), 0, "Legacy gateway must not mark the plan fully paid");
});
