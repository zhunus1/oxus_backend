/** Run against a disposable local *_test database after nest build and migrations. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
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
const PaymentController = klass("modules/billing/api/payment.controller", "PaymentController");
const PaymentService = klass("modules/billing/service/payment.service", "PaymentService");
const TransactionRepository = klass("modules/billing/repository/payment.repository", "TransactionRepository");
const FreedomPayService = klass("modules/billing/service/freedompay.service", "FreedomPayService");
const ContractScanService = klass("modules/contract/service/contract-scan.service", "ContractScanService");
const ContractScanController = klass("modules/contract/api/contract-scan.controller", "ContractScanController");
const ExpertDashboardRepository = klass("modules/expert-dashboard/repository/expert-dashboard.repository", "ExpertDashboardRepository");

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
let seq = randomInt(100000000, 800000000);
let app: INestApplication;
let expert: number, otherExpert: number, studentActor: number, admin: number;
const providerSecret = "phase1-receive-secret";
const providerConfig = new ConfigService({
  FREEDOM_RECEIVE_SECRET_KEY: providerSecret,
  FREEDOM_PAYMENT_SECRET_KEY: "different-payout-secret",
  FREEDOM_MERCHANT_ID: "100500",
  FREEDOM_RESULT_URL: "https://example.test/api/v1/payment/freedompay-webhook",
  FREEDOM_TESTING_MODE: "0",
});
const contractService = new ContractService(repo, {}, { enqueue() {} }, {}, { logEvent: async () => {} }, realtime);
const paymentRepo = new TransactionRepository(prisma);
const billing = new PaymentService(paymentRepo, new FreedomPayService(providerConfig), contractService);
const scans = new ContractScanService(
  prisma,
  new ConfigService({ AWS_BUCKET_NAME: "phase1", AWS_MINIO_ENDPOINT: "http://127.0.0.1:1", AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" }),
);
const objects = new Map<string, Uint8Array>();
const scanFile = Buffer.from("%PDF-1.7 phase1 scan");

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
  admin = (await user("ADMIN")).id;
  mock.method(S3Client.prototype, "send", async (command: any) => {
    if (command instanceof PutObjectCommand) objects.set(command.input.Key!, command.input.Body as Uint8Array);
    if (command instanceof GetObjectCommand) return { ContentType: "application/pdf", Body: { transformToByteArray: async () => objects.get(command.input.Key!) } };
    return {};
  });
  const module = await Test.createTestingModule({
    controllers: [ExpertLeadController, ManualContractController, ExpertContractController, ContractController, PaymentController, ContractScanController],
    providers: [
      { provide: LeadContractService, useValue: contracts },
      { provide: ExpertLeadService, useValue: leads },
      { provide: LeadGuestMeetingService, useValue: {} },
      { provide: LeadStudentInvitationService, useValue: invitations },
      { provide: ManualContractService, useValue: manual },
      { provide: ContractService, useValue: contractService },
      { provide: PaymentService, useValue: billing },
      { provide: ContractScanService, useValue: scans },
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

async function assignedStudent(owner = expert) {
  const student = await user("STUDENT");
  const profile = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: owner } });
  await prisma.studentPortrait.create({ data: { userId: student.id, consultantProfileId: profile.id } });
  return student;
}
function contractDto(studentId: number, overrides = {}) {
  return { studentId, price: 1500000, currency: "KZT", subscriptionTier: "EXPERT_MENTORSHIP", contractNumber: `PHASE1-${randomUUID()}`, ...overrides };
}
async function legacyPayment() {
  const student = await assignedStudent();
  const contract = await prisma.contract.create({ data: { ...contractDto(student.id), status: "SIGNED", signedByUserId: expert } as any });
  const transaction = await prisma.transaction.create({ data: { userId: student.id, amount: 499, currency: "USD", status: "PENDING", subscriptionTier: "EXPERT_MENTORSHIP" } });
  return { student, contract, transaction };
}
// Independent implementation of the provider's documented flat-message signature.
function signedCallback(orderId: string, overrides: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = {
    pg_order_id: orderId,
    pg_payment_id: String(++seq),
    pg_amount: "499.00",
    pg_currency: "USD",
    pg_can_reject: "0",
    pg_captured: "1",
    pg_description: "phase1",
    pg_need_email_notification: "0",
    pg_need_phone_notification: "0",
    pg_net_amount: "499",
    pg_payment_method: "bankcard",
    pg_ps_amount: "499",
    pg_ps_currency: "USD",
    pg_ps_full_amount: "499",
    pg_reference: "audit",
    pg_result: "1",
    Pg_result_url_method: "POST",
    pg_salt: "phase1",
    pg_testing_mode: "0",
    pg_user_ip: "127.0.0.1",
    ...overrides,
  };
  const values = Object.keys(body)
    .filter(k => k !== "pg_sig")
    .sort()
    .map(k => body[k]);
  body.pg_sig = createHash("md5")
    .update(["freedompay-webhook", ...values, providerSecret].join(";"))
    .digest("hex");
  return body;
}
const callback = (body: Record<string, unknown>) => request(app.getHttpServer()).post("/payment/freedompay-webhook").type("form").send(body);
async function unchangedPayment(f: Awaited<ReturnType<typeof legacyPayment>>) {
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: f.transaction.id } })).status, "PENDING");
  assert.equal(await prisma.studentPackage.count({ where: { studentId: f.student.id } }), 0);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: f.contract.id } })).status, "SIGNED");
  assert.equal((await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: f.student.id } })).subscription, "FREE");
  assert.equal(await prisma.userJourneyEvent.count({ where: { userId: f.student.id, eventType: "PAYMENT_COMPLETED" } }), 0);
}

test("F01: invalid signature, failed result and mismatched payment cannot mutate the database", async () => {
  for (const overrides of [{ pg_sig: "invalid" }, { pg_result: "0" }, { pg_amount: "1.00" }, { pg_currency: "EUR" }]) {
    const f = await legacyPayment();
    const body = signedCallback(f.transaction.id, overrides);
    if (overrides.pg_sig) body.pg_sig = overrides.pg_sig;
    await callback(body);
    await unchangedPayment(f);
  }
});

test("F02: duplicate and concurrent callbacks apply benefits only once; late failure cannot downgrade SUCCESS", async () => {
  const f = await legacyPayment();
  const body = signedCallback(f.transaction.id);
  const results = await Promise.all([callback(body), callback(body)]);
  for (const result of results) assert(result.status < 300, JSON.stringify(result.body));
  const committed = await prisma.contract.findUniqueOrThrow({ where: { id: f.contract.id } });
  await callback(body);
  assert.equal(+(await prisma.contract.findUniqueOrThrow({ where: { id: f.contract.id } })).updatedAt, +committed.updatedAt);
  assert.equal(await prisma.userJourneyEvent.count({ where: { userId: f.student.id, eventType: "PAYMENT_COMPLETED" } }), 1);
  assert.equal((await prisma.studentPackage.findFirstOrThrow({ where: { studentId: f.student.id } })).totalSlots, 10);
  await callback(signedCallback(f.transaction.id, { pg_payment_id: body.pg_payment_id, pg_result: "0", pg_failure_code: "999" }));
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: f.transaction.id } })).status, "SUCCESS");
});

test("F03: foreign expert cannot create/read/list/update a non-CRM student's contract", async () => {
  const student = await assignedStudent();
  await http(otherExpert, "post", "/contracts").send(contractDto(student.id)).expect(403);
  const c = await http(expert, "post", "/contracts").send(contractDto(student.id)).expect(201);
  await http(otherExpert, "get", `/contracts/student/${student.id}`).expect(403);
  await http(otherExpert, "patch", `/contracts/${c.body.id}/meta`).send({ price: 750000 }).expect(403);
  const list = await http(otherExpert, "get", "/contracts").expect(200);
  assert(!list.body.data.some((row: any) => row.id === c.body.id));
});

test("F04: two concurrent generic POSTs cannot create two contracts for one student", async () => {
  const student = await assignedStudent();
  const results = await Promise.all([http(expert, "post", "/contracts").send(contractDto(student.id)), http(expert, "post", "/contracts").send(contractDto(student.id))]);
  assert.equal(await prisma.contract.count({ where: { studentId: student.id } }), 1);
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert(
    results.every(r => [201, 400, 409].includes(r.status)),
    results.map(r => JSON.stringify(r.body)).join("\n"),
  );
});

test("F05: transfer moves read/payment/scan access to the current owner and preserves deal attribution", async () => {
  const f = await prepare({ paymentType: "INSTALLMENT", installmentCount: 3 });
  const result = await http(expert, "post", `${f.path}/confirm`).send({ paidAt, signedAt, amount: 500000 }).expect(201);
  const id = result.body.contract.id;
  const studentId = result.body.contract.studentId;
  const portrait = await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: studentId } });
  const next = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: otherExpert } });
  const transfer = Object.assign(new ExpertDashboardRepository(), { prisma });
  assert.equal(await transfer.transferPortraitConsultant(portrait.id, portrait.consultantProfileId, next.id), 1);
  await http(otherExpert, "get", `/contracts/student/${studentId}`).expect(200);
  await http(expert, "get", `/contracts/student/${studentId}`).expect(403);
  await http(otherExpert, "post", `/contracts/${id}/installments/2/confirm`).send({ paidAt: "2026-02-28T10:00:00Z", amount: 500000 }).expect(201);
  await http(expert, "post", `/contracts/${id}/installments/3/confirm`).send({ paidAt: "2026-03-31T10:00:00Z", amount: 500000 }).expect(403);
  await http(otherExpert, "post", `/contracts/${id}/scan`).attach("file", scanFile, { filename: "scan.pdf", contentType: "application/pdf" }).expect(201);
  await http(otherExpert, "get", `/contracts/${id}/scan`).expect(200);
  await http(expert, "get", `/contracts/${id}/scan`).expect(403);
  await http(expert, "post", `/contracts/${id}/scan`).attach("file", scanFile, { filename: "scan.pdf", contentType: "application/pdf" }).expect(403);
  await http(expert, "get", `/expert/leads/${f.lead.id}`).expect(403);
  await http(expert, "post", f.path).send(f.dto).expect(403);
  await http(expert, "post", `${f.path}/confirm`).send({ paidAt, signedAt, amount: 500000 }).expect(403);
  assert(!(await http(expert, "get", "/contracts").expect(200)).body.data.some((row: any) => row.id === id));
  assert((await http(otherExpert, "get", "/contracts").expect(200)).body.data.some((row: any) => row.id === id));
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: f.lead.id } })).assignedExpertUserId, expert);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id } })).signedByUserId, expert);
});

test("F06: revoking permission blocks both confirmation paths and direct domain calls", async () => {
  const student = await assignedStudent();
  const c = await prisma.contract.create({ data: { ...contractDto(student.id), status: "PENDING_EXPERT" } as any });
  const lead = await prisma.lead.create({ data: { assignedExpertUserId: expert, status: "CONTRACT_PENDING", contractId: c.id } });
  const permission = await prisma.permission.findUniqueOrThrow({ where: { code: "EXPERT_LEAD_CALLS_RESPOND" } });
  await prisma.role.update({ where: { code: "EXPERT" }, data: { permissions: { disconnect: { id: permission.id } } } });
  try {
    const body = { signedAt, paidAt, amount: 1500000 };
    await http(expert, "post", `/expert/leads/${lead.id}/contract/confirm`).send(body).expect(403);
    await http(expert, "post", `/contracts/${c.id}/confirm-manual`).send(body).expect(403);
    await assert.rejects(
      () => manual.confirm(c.id, expert, body),
      (error: any) => error.status === 403,
    );
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "CONTRACT_PENDING");
  } finally {
    await prisma.role.update({ where: { code: "EXPERT" }, data: { permissions: { connect: { id: permission.id } } } });
  }
});

for (const [label, overrides] of Object.entries({
  "wrong merchant": { pg_merchant_id: "200500" },
  "test receipt in production context": { pg_testing_mode: "1" },
  "missing mode": { pg_testing_mode: "" },
  "uncaptured bank card": { pg_captured: "0" },
  "unfinished payment": { pg_result: "2" },
  "failure description on success": { pg_failure_description: "declined" },
  "unknown payment method": { pg_payment_method: "unknown" },
}))
  test(`F01: ${label} is rejected without mutation`, async () => {
    const f = await legacyPayment();
    const response = await callback(signedCallback(f.transaction.id, overrides));
    assert(response.status >= 400 && response.status < 500, response.text);
    await unchangedPayment(f);
  });

test("F01: valid captured payment preserves raw decimals and signed extension fields, returns signed XML", async () => {
  const f = await legacyPayment();
  const body = signedCallback(f.transaction.id, { pg_merchant_id: "100500", merchant_note: "001 extension" });
  const response = await callback(body).expect(200);
  assert.match(response.headers["content-type"], /application\/xml/);
  assert.match(response.text, /<pg_status>ok<\/pg_status>/);
  const salt = /<pg_salt>(.*?)<\/pg_salt>/.exec(response.text)![1];
  const sig = /<pg_sig>(.*?)<\/pg_sig>/.exec(response.text)![1];
  assert.equal(sig, createHash("md5").update(["freedompay-webhook", "Payment accepted", salt, "ok", providerSecret].join(";")).digest("hex"));
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: f.transaction.id } })).status, "SUCCESS");
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: f.contract.id } })).status, "PAID");
  assert.equal(await prisma.userJourneyEvent.count({ where: { userId: f.student.id, eventType: "PAYMENT_COMPLETED" } }), 1);
});

test("F01: modifying an unknown signed field or duplicating an amount invalidates the message", async () => {
  const f = await legacyPayment();
  const body = signedCallback(f.transaction.id, { merchant_note: "original" });
  await callback({ ...body, merchant_note: "changed" }).expect(403);
  const encoded = new URLSearchParams(body as Record<string, string>).toString();
  const response = await request(app.getHttpServer()).post("/payment/freedompay-webhook").type("form").send(`${encoded}&pg_amount=1`);
  assert(response.status >= 400 && response.status < 500);
  await unchangedPayment(f);
});

test("F01: unknown order and missing verifier configuration fail closed", async () => {
  await callback(signedCallback(randomUUID())).expect(404);
  const unconfigured = new FreedomPayService(new ConfigService({}));
  await assert.rejects(
    () => unconfigured.handleWebhook(signedCallback(randomUUID())),
    (error: any) => error.status === 503,
  );
});

function failTransactionOperation(model: string, method: string) {
  const original = prisma.$transaction.bind(prisma);
  prisma.$transaction = ((fn: any, options: any) =>
    original(async tx => {
      const proxy = new Proxy(tx, {
        get(target, key) {
          if (key !== model) return Reflect.get(target, key);
          return new Proxy(target[model], {
            get(delegate, op) {
              if (op === method)
                return async () => {
                  throw new Error("PHASE1_FORCED_FAILURE");
                };
              return Reflect.get(delegate, op);
            },
          });
        },
      });
      return fn(proxy);
    }, options)) as any;
  return {
    restore: () => {
      prisma.$transaction = original;
    },
  };
}

test("F02: benefit failure rolls back payment, contract and profile; provider retry succeeds exactly once", async () => {
  const f = await legacyPayment();
  const body = signedCallback(f.transaction.id);
  const failure = failTransactionOperation("studentPackage", "upsert");
  try {
    await callback(body).expect(500);
  } finally {
    failure.restore();
  }
  await unchangedPayment(f);
  await callback(body).expect(200);
  await callback(body).expect(200);
  assert.equal((await prisma.studentPackage.findFirstOrThrow({ where: { studentId: f.student.id } })).totalSlots, 10);
});

test("F02: one provider reference cannot settle two orders, including concurrent deliveries", async () => {
  const a = await legacyPayment(),
    b = await legacyPayment();
  const first = signedCallback(a.transaction.id);
  const second = signedCallback(b.transaction.id, { pg_payment_id: first.pg_payment_id });
  const results = await Promise.all([callback(first), callback(second)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(await prisma.transaction.count({ where: { id: { in: [a.transaction.id, b.transaction.id] }, status: "SUCCESS" } }), 1);
  assert.equal(await prisma.studentPackage.count({ where: { studentId: { in: [a.student.id, b.student.id] } } }), 1);
});

test("F02: historical SUCCESS is never re-granted; valid in-flight manual receipts do not grant benefits", async () => {
  const old = await legacyPayment();
  const oldBody = signedCallback(old.transaction.id);
  await prisma.transaction.update({ where: { id: old.transaction.id }, data: { status: "SUCCESS" } });
  await callback(oldBody).expect(200);
  await callback(oldBody).expect(200);
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: old.transaction.id } })).providerRef, oldBody.pg_payment_id);
  assert.equal(await prisma.studentPackage.count({ where: { studentId: old.student.id } }), 0);
  const replay = await legacyPayment();
  await callback(signedCallback(replay.transaction.id, { pg_payment_id: oldBody.pg_payment_id })).expect(409);
  await unchangedPayment(replay);
  const f = await prepare({ paymentType: "INSTALLMENT", installmentCount: 3 });
  const result = await http(expert, "post", `${f.path}/confirm`).send({ paidAt, signedAt, amount: 500000 }).expect(201);
  const transaction = await prisma.transaction.create({
    data: { userId: result.body.contract.studentId, amount: 499, currency: "USD", status: "PENDING", subscriptionTier: "EXPERT_MENTORSHIP" },
  });
  const body = signedCallback(transaction.id);
  await callback(body).expect(200);
  await callback(body).expect(200);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: result.body.contract.id } })).status, "SIGNED");
  assert.equal(await prisma.contractInstallment.count({ where: { contractId: result.body.contract.id, paidAt: { not: null } } }), 1);
  assert.equal((await prisma.studentPackage.findFirstOrThrow({ where: { studentId: transaction.userId } })).totalSlots, 10);
});

test("F03: CRM and non-CRM owners can operate; foreign experts cannot sign, confirm or upload scans", async () => {
  for (const crm of [false, true]) {
    const student = await assignedStudent();
    const c = await http(expert, "post", "/contracts").send(contractDto(student.id)).expect(201);
    if (crm) await prisma.lead.create({ data: { assignedExpertUserId: expert, status: "CONTRACT_PENDING", contractId: c.body.id } });
    await http(expert, "get", `/contracts/student/${student.id}`).expect(200);
    await http(expert, "patch", `/contracts/${c.body.id}/meta`).send({ price: 750000 }).expect(200);
    for (const operation of ["manual-signature", "confirm-manual"]) {
      await http(otherExpert, "post", `/contracts/${c.body.id}/${operation}`).send({ signedAt, paidAt, amount: 750000 }).expect(403);
    }
    await http(expert, "post", `/contracts/${c.body.id}/manual-signature`).send({ signedAt }).expect(201);
    await http(expert, "post", `/contracts/${c.body.id}/confirm-manual`).send({ paidAt, amount: 750000 }).expect(201);
    await http(otherExpert, "post", `/contracts/${c.body.id}/scan`).attach("file", scanFile, { filename: "scan.pdf", contentType: "application/pdf" }).expect(403);
    await http(expert, "post", `/contracts/${c.body.id}/scan`).attach("file", scanFile, { filename: "scan.pdf", contentType: "application/pdf" }).expect(201);
    await http(student.id, "get", `/contracts/${c.body.id}/scan`).expect(200);
    await http(otherExpert, "get", `/contracts/${c.body.id}/scan`).expect(403);
  }
});

test("F03: no-owner, deleted student, non-student role and deleted CRM lead are denied", async () => {
  const unassigned = await user("STUDENT");
  await http(expert, "post", "/contracts").send(contractDto(unassigned.id)).expect(403);
  await http(expert, "post", "/contracts").send(contractDto(admin)).expect(403);
  const student = await assignedStudent();
  const c = await http(expert, "post", "/contracts").send(contractDto(student.id)).expect(201);
  await prisma.user.update({ where: { id: student.id }, data: { deletedAt: new Date() } });
  await http(expert, "get", `/contracts/student/${student.id}`).expect(403);
  await http(expert, "post", `/contracts/${c.body.id}/confirm-manual`).send({ signedAt, paidAt, amount: 1500000 }).expect(403);
  const other = await assignedStudent();
  const d = await http(expert, "post", "/contracts").send(contractDto(other.id)).expect(201);
  await prisma.lead.create({ data: { assignedExpertUserId: expert, contractId: d.body.id, status: "CONTRACT_PENDING", deletedAt: new Date() } });
  await http(expert, "get", `/contracts/student/${other.id}`).expect(403);
  await http(admin, "post", `/contracts/${d.body.id}/confirm-manual`).send({ signedAt, paidAt, amount: 1500000 }).expect(403);
  const list = await http(expert, "get", "/contracts").expect(200);
  assert(!list.body.data.some((row: any) => [c.body.id, d.body.id].includes(row.id)));
});

test("F04: automatic numbering skips a historical count+1 collision and concurrent numbers remain unique", async () => {
  const sentinel = await assignedStudent();
  const occupied = `OXUS-${new Date().getFullYear()}-${String((await prisma.contract.count()) + 2).padStart(4, "0")}`;
  await prisma.contract.create({ data: contractDto(sentinel.id, { contractNumber: occupied }) as any });
  const a = await assignedStudent(),
    b = await assignedStudent();
  const aDto = contractDto(a.id),
    bDto = contractDto(b.id);
  delete (aDto as any).contractNumber;
  delete (bDto as any).contractNumber;
  const results = await Promise.all([http(expert, "post", "/contracts").send(aDto), http(expert, "post", "/contracts").send(bDto)]);
  for (const result of results) assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(new Set([occupied, ...results.map(r => r.body.contractNumber)]).size, 3);
});

test("F04: generic creation and CRM confirmation share the same student invariant", async () => {
  const student = await assignedStudent();
  const f = await prepare({ firstname: student.firstname, lastname: student.lastname, email: student.email, phone: student.phoneNumber, existingStudentId: student.id });
  const results = await Promise.all([
    http(expert, "post", "/contracts").send(contractDto(student.id)),
    http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1500000, existingStudentId: student.id }),
  ]);
  assert.equal(await prisma.contract.count({ where: { studentId: student.id } }), 1);
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert(
    results.every(r => [201, 400, 409].includes(r.status)),
    results.map(r => JSON.stringify(r.body)).join("\n"),
  );
});

test("F06: ADMIN retains manual confirmation access, disabled actor and spoofed ADMIN flag are denied", async () => {
  const student = await assignedStudent();
  const c = await http(expert, "post", "/contracts").send(contractDto(student.id)).expect(201);
  const body = { signedAt, paidAt, amount: 1500000 };
  await assert.rejects(
    () => manual.confirm(c.body.id, studentActor, body, true),
    (error: any) => error.status === 403,
  );
  const disabled = await user("EXPERT");
  await prisma.user.update({ where: { id: disabled.id }, data: { deletedAt: new Date() } });
  await http(disabled.id, "post", `/contracts/${c.body.id}/confirm-manual`).send(body).expect(401);
  await assert.rejects(
    () => manual.confirm(c.body.id, disabled.id, body),
    (error: any) => error.status === 403,
  );
  await http(admin, "post", `/contracts/${c.body.id}/confirm-manual`).send(body).expect(201);
});

for (const revoked of ["permission", "role", "profile"] as const)
  test(`F06: inactive ${revoked} is rejected by both HTTP paths and the domain boundary`, async () => {
    const student = await assignedStudent();
    const c = await http(expert, "post", "/contracts").send(contractDto(student.id)).expect(201);
    const lead = await prisma.lead.create({ data: { assignedExpertUserId: expert, status: "CONTRACT_PENDING", contractId: c.body.id } });
    const setActive = async (active: boolean) => {
      if (revoked === "profile") await prisma.consultantProfile.update({ where: { userId: expert }, data: { isActive: active } });
      else if (revoked === "role") await prisma.role.update({ where: { code: "EXPERT" }, data: { deletedAt: active ? null : new Date() } });
      else await prisma.permission.update({ where: { code: "EXPERT_LEAD_CALLS_RESPOND" }, data: { deletedAt: active ? null : new Date() } });
    };
    await setActive(false);
    try {
      const body = { signedAt, paidAt, amount: 1500000 };
      await http(expert, "post", `/expert/leads/${lead.id}/contract/confirm`).send(body).expect(403);
      await http(expert, "post", `/contracts/${c.body.id}/confirm-manual`).send(body).expect(403);
      for (const confirm of [() => contracts.confirm(expert, lead.id, body), () => manual.confirm(c.body.id, expert, body)])
        await assert.rejects(confirm, (error: any) => error.status === 403);
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.body.id } })).manualConfirmedAt, null);
    } finally {
      await setActive(true);
    }
  });

test("manual-flow: a late failure rolls back User, contract, schedule, benefits and invitation", async () => {
  const f = await prepare();
  const failure = failTransactionOperation("auditLog", "create");
  try {
    await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1500000 }).expect(500);
  } finally {
    failure.restore();
  }
  assert.equal(await prisma.user.count({ where: { email: f.dto.email } }), 0);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: f.lead.id } });
  assert.equal(lead.status, "CONTRACT_PENDING");
  assert.equal(lead.contractId, null);
  await http(expert, "post", `${f.path}/confirm`).send({ signedAt, paidAt, amount: 1500000 }).expect(201);
});

const internalOtpKeys = ["studentOtpHash", "studentOtpExpiry", "expertOtpHash", "expertOtpExpiry"] as const;
const otpMarkers = {
  studentOtpHash: "synthetic-student-otp-hash",
  studentOtpExpiry: new Date("2099-01-01T00:00:00Z"),
  expertOtpHash: "synthetic-expert-otp-hash",
  expertOtpExpiry: new Date("2099-01-02T00:00:00Z"),
};
function assertSafeJson(value: unknown) {
  const json = JSON.parse(JSON.stringify(value));
  const walk = (item: any) => {
    if (!item || typeof item !== "object") return;
    for (const key of internalOtpKeys) assert.ok(!Object.hasOwn(item, key), `Internal Contract field leaked: ${key}`);
    Object.values(item).forEach(walk);
  };
  walk(json);
  return json;
}
async function contractWithOtp() {
  const student = await assignedStudent();
  const contract = await prisma.contract.create({
    data: { ...contractDto(student.id), status: "PENDING_STUDENT", signedByUserId: expert, ...otpMarkers } as any,
  });
  return { student, contract };
}

test("C03 student HTTP read omits all internal OTP keys with populated credentials", async () => {
  const { student, contract } = await contractWithOtp();
  const result = assertSafeJson((await http(student.id, "get", "/contracts/my").expect(200)).body);
  assert.equal(result.id, contract.id);
  assert.equal(result.price, 1500000);
  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  for (const key of internalOtpKeys) assert.deepEqual(stored[key], otpMarkers[key]);
});

test("C03 expert and ADMIN HTTP reads and lists omit all internal OTP keys", async () => {
  const { student, contract } = await contractWithOtp();
  for (const actor of [expert, admin]) {
    assert.equal(assertSafeJson((await http(actor, "get", `/contracts/student/${student.id}`).expect(200)).body).id, contract.id);
    const list = assertSafeJson((await http(actor, "get", "/contracts?limit=100").expect(200)).body);
    assert.ok(list.data.some((c: any) => c.id === contract.id));
  }
});

test("C03 direct repository/service reads and admin CRM/finance projections are safe JSON", async () => {
  const { student, contract } = await contractWithOtp();
  for (const value of [
    await repo.findById(contract.id),
    await repo.findByStudentId(student.id),
    await contractService.getMyContract(student.id),
    await contractService.getContractByStudentId(student.id, expert),
  ])
    assert.equal(assertSafeJson(value).id, contract.id);
  assert.ok(assertSafeJson(await repo.findPendingStudent()).some((c: any) => c.id === contract.id));
  for (const value of [await repo.findAllByStatus(undefined, admin, { limit: 100 }), await contractService.getAllContracts(undefined, expert, { limit: 100 })])
    assert.ok(assertSafeJson(value).data.some((c: any) => c.id === contract.id));
  const finance = new (klass("modules/admin/finance.service", "FinanceService"))(prisma);
  const adminService = new (klass("modules/admin/admin.service", "AdminService"))(prisma, {}, finance, realtime);
  assert.ok(assertSafeJson(await adminService.getCrmStudentById(student.id)).detail.contracts.some((c: any) => c.id === contract.id));
  assert.equal(assertSafeJson(await finance.listContracts({ studentId: student.id, sortBy: "createdAt", sortOrder: "desc" })).data[0].id, contract.id);
  assert.ok(assertSafeJson(await finance.getExpertEarnings(expert, { limit: 100 })).contracts.some((c: any) => c.id === contract.id));
  // Only the dedicated internal verification projection retains the signing credentials.
  assert.equal((await repo.findStudentSigningCredentials(contract.id)).studentOtpHash, otpMarkers.studentOtpHash);
});

test("C03 generic create/meta and manual signature responses omit null and populated OTP keys", async () => {
  const student = await assignedStudent();
  const created = assertSafeJson((await http(expert, "post", "/contracts").send(contractDto(student.id)).expect(201)).body);
  assert.equal(created.studentId, student.id);
  await prisma.contract.update({ where: { id: created.id }, data: otpMarkers });
  const updated = assertSafeJson((await http(expert, "patch", `/contracts/${created.id}/meta`).send({ serviceStartDate: "2026-01-01T00:00:00Z" }).expect(200)).body);
  assert.equal(updated.id, created.id);
  for (let call = 0; call < 2; call++)
    assert.equal(assertSafeJson((await http(expert, "post", `/contracts/${created.id}/manual-signature`).send({ signedAt }).expect(201)).body).id, created.id);
  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
  for (const key of internalOtpKeys) assert.deepEqual(stored[key], otpMarkers[key]);
});

test("C03 nested lead contracts and manual confirmation/payment retries omit internal OTP keys", async () => {
  const f = await prepare({ paymentType: "INSTALLMENT", installmentCount: 3 });
  const receipt = { paidAt, signedAt, amount: 500000 };
  const initial = assertSafeJson((await http(expert, "post", `${f.path}/confirm`).send(receipt).expect(201)).body);
  const id = initial.contract.id;
  await prisma.contract.update({ where: { id }, data: otpMarkers });
  assert.equal(assertSafeJson((await http(expert, "get", `/expert/leads/${f.lead.id}`).expect(200)).body).contract.id, id);
  assert.equal(assertSafeJson((await http(expert, "post", f.path).send(f.dto).expect(201)).body).contract.id, id);
  assert.equal(assertSafeJson((await http(expert, "post", `${f.path}/confirm`).send(receipt).expect(201)).body).contract.id, id);
  assert.equal(assertSafeJson((await http(admin, "post", `/contracts/${id}/confirm-manual`).send(receipt).expect(201)).body).id, id);
  for (let call = 0; call < 2; call++) {
    const next = assertSafeJson((await http(expert, "post", `/contracts/${id}/installments/2/confirm`).send({ paidAt: "2026-02-28T10:00:00Z", amount: 500000 }).expect(201)).body);
    assert.equal(next.id, id);
    assert.equal(next.installments.filter((i: any) => i.paidAt).length, 2);
  }
  assert.equal(assertSafeJson(await manual.confirm(id, admin, receipt, true)).id, id);
});

test("C03 internal legacy OTP verification still reads credentials and signs without exposing them", async () => {
  const { student, contract } = await contractWithOtp();
  const dto = {
    otp: "123456",
    clientFullName: "Synthetic parent",
    studentName: "Synthetic student",
    clientIin: "000000000000",
    clientAddress: "Synthetic",
    clientPhone: "+77000000000",
  };
  let verified = false;
  const service = new ContractService(
    repo,
    {
      async verify(code: string, hash: string) {
        assert.equal(code, dto.otp);
        assert.equal(hash, otpMarkers.studentOtpHash);
        verified = true;
        return true;
      },
    },
    { enqueue() {} },
    { async activateContractBenefits() {} },
    { async logEvent() {} },
    realtime,
  );
  assert.equal(assertSafeJson(await service.signByStudent(contract.id, student.id, dto)).status, "SIGNED");
  assert.equal(verified, true);
  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(stored.studentOtpHash, null);
  assert.equal(stored.expertOtpHash, otpMarkers.expertOtpHash);
});
