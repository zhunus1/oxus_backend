/** Real manual-lead HTTP validation, permissions and metric persistence. Run after nest build on a migrated local *_test database. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { PrismaService as PrismaServiceType } from "../src/database/prisma.service";

const built = createRequire(resolve("package.json"));
const klass = (path: string, name: string) => built(`./dist/src/${path}.js`)[name];
const PrismaService = klass("database/prisma.service", "PrismaService");
const LeadIngestionRepository = klass("modules/lead/repository/lead-ingestion.repository", "LeadIngestionRepository");
const ManualLeadV2Service = klass("modules/lead/service/manual-lead-v2.service", "ManualLeadV2Service");
const CalculatorQuestionnaireService = klass("modules/lead/service/calculator-questionnaire.service", "CalculatorQuestionnaireService");
const SalesV2Controller = klass("modules/lead/api/sales-v2.controller", "SalesV2Controller");
const LeadRealtimeGateway = klass("modules/lead/realtime/lead-realtime.gateway", "LeadRealtimeGateway");
const JwtAuthGuard = klass("modules/admin/auth/rbac/auth.guard", "JwtAuthGuard");
const RolesGuard = klass("modules/admin/auth/rbac/roles.guard", "RolesGuard");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test PostgreSQL database");
const prisma: PrismaServiceType = new PrismaService();
const jwt = new JwtService();
const secret = randomUUID();
const originalSecret = process.env.JWT_SECRET;
const prefix = "/api/v1/sales/v2";
const metrics = { score: 935, percent: 12, universities: 50 };
const answers = [{ questionId: "city", optionId: "almaty" }];
let app: INestApplication;
let managerId: number;
let otherManagerId: number;
let outsiderId: number;
const createdEvents: number[] = [];
const updatedEvents: number[] = [];
const payload = () => ({ name: "Manual Student", phone: "+77000000001", email: `${randomUUID()}@example.test`, role: "student", locale: "ru", quizVersion: "2026-08-22", answers });
const authorization = (id: number) => `Bearer ${jwt.sign({ sub: id }, { secret, expiresIn: 60 })}`;
const create = (body: object) => request(app.getHttpServer()).post(`${prefix}/leads`).set("Authorization", authorization(managerId)).send(body);
const save = (leadId: number, body: object, userId = managerId) =>
  request(app.getHttpServer()).patch(`${prefix}/leads/${leadId}/questionnaire`).set("Authorization", authorization(userId)).send(body);

before(async () => {
  process.env.JWT_SECRET = secret;
  await prisma.$connect();
  const user = (role: string) =>
    prisma.user.create({ data: { firstname: "Metrics", lastname: "Fixture", email: `${randomUUID()}@example.test`, password: "unused", role: { connect: { code: role } } } });
  await prisma.role.upsert({ where: { code: "STUDENT" }, create: { code: "STUDENT", name: "Student" }, update: {} });
  managerId = (await user("SALES_MANAGER")).id;
  otherManagerId = (await user("SALES_MANAGER")).id;
  outsiderId = (await user("STUDENT")).id;
  const module = await Test.createTestingModule({
    controllers: [SalesV2Controller],
    providers: [
      ManualLeadV2Service,
      CalculatorQuestionnaireService,
      LeadIngestionRepository,
      { provide: PrismaService, useValue: prisma },
      {
        provide: LeadRealtimeGateway,
        useValue: {
          emitLeadCreated: (lead: { id: number }) => createdEvents.push(lead.id),
          emitLeadUpdated: (_userId: number, lead: { id: number }) => updatedEvents.push(lead.id),
        },
      },
    ],
  })
    .useMocker(() => ({}))
    .overrideGuard(JwtAuthGuard)
    .useValue(new JwtAuthGuard(new Reflector(), jwt, prisma))
    .overrideGuard(RolesGuard)
    .useValue(new RolesGuard(new Reflector()))
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  await app.listen(0, "127.0.0.1");
});
after(async () => {
  await app?.close();
  await prisma.$disconnect();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

test("manual creation saves exact frontend results and keeps original contacts, source and notifications", async () => {
  const body = { ...payload(), ...metrics };
  const response = await create(body).expect(201);
  const leadId = response.body.lead.id;
  assert.equal(response.body.created, true);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { originSource: true, submissions: true } });
  assert.equal(lead.originSource.code, "office-manual");
  assert.equal(lead.assignedSalesManagerId, null);
  assert.equal(lead.createdByUserId, managerId);
  assert.equal(lead.status, "NEW");
  const submission = lead.submissions[0];
  assert.deepEqual(submission.rawPayload, body);
  assert.deepEqual(submission.metrics, { ...metrics, provisional: true });
  assert.deepEqual((submission.normalizedPayload as any).questionnaire.metrics, submission.metrics);
  assert.equal(createdEvents.filter(id => id === leadId).length, 1);
});

test("old requests and omitted questionnaires retain server-calculated results", async () => {
  for (const [input, expected] of [
    [payload(), { score: 20, percent: 2, universities: 2, provisional: true }],
    [
      { ...payload(), answers: undefined },
      { score: 0, percent: 0, universities: 0, provisional: true },
    ],
  ] as const) {
    const response = await create(input).expect(201);
    assert.deepEqual(response.body.lead.submissions[0].metrics, expected);
  }
  const zero = await create({ ...payload(), score: 0, percent: 0, universities: 0 }).expect(201);
  assert.deepEqual(zero.body.lead.submissions[0].metrics, { score: 0, percent: 0, universities: 0, provisional: true });
});

test("saving answers appends frontend metrics without changing the old snapshot; legacy saves still calculate", async () => {
  const response = await create(payload()).expect(201);
  const leadId = response.body.lead.id;
  await prisma.lead.update({ where: { id: leadId }, data: { assignedSalesManagerId: managerId } });
  const original = await prisma.leadSubmission.findFirstOrThrow({ where: { leadId } });
  const saved = await save(leadId, { role: "student", locale: "kk", answers, ...metrics }).expect(200);
  assert.deepEqual(saved.body.metrics, { ...metrics, provisional: true });
  assert.deepEqual(saved.body.normalizedPayload.questionnaire.metrics, saved.body.metrics);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).preferredLanguage, "kk");
  assert.deepEqual(await prisma.leadSubmission.findUniqueOrThrow({ where: { id: original.id } }), original);
  assert.equal(updatedEvents.filter(id => id === leadId).length, 1);
  const legacy = await save(leadId, { role: "student", locale: "ru", answers }).expect(200);
  assert.deepEqual(legacy.body.metrics, { score: 20, percent: 2, universities: 2, provisional: true });
  await save(leadId, { role: "student", locale: "ru", answers, ...metrics }, otherManagerId).expect(404);
  await prisma.lead.update({ where: { id: leadId }, data: { status: "CONTRACT_PENDING" } });
  await save(leadId, { role: "student", locale: "ru", answers, ...metrics }).expect(409);
});

test("partial, null and invalid metrics or invalid answers are rejected on both writes without persistence", async () => {
  const response = await create(payload()).expect(201);
  const leadId = response.body.lead.id;
  await prisma.lead.update({ where: { id: leadId }, data: { assignedSalesManagerId: managerId } });
  const before = [await prisma.lead.count(), await prisma.leadSubmission.count()];
  const invalid = [
    { score: 935 },
    { percent: 0 },
    { universities: 0 },
    { score: 0, universities: 0 },
    { score: 935, percent: 93 },
    { percent: 93, universities: 50 },
    { ...metrics, score: null },
    { score: null, percent: null, universities: null },
    { ...metrics, score: -1 },
    { ...metrics, score: 1001 },
    { ...metrics, percent: 101 },
    { ...metrics, universities: 10001 },
    { ...metrics, score: 1.5 },
    { ...metrics, answers: [{ questionId: "city", optionId: "unknown" }] },
    { ...metrics, answers: [answers[0], answers[0]] },
    { ...metrics, quizVersion: "future" },
  ];
  for (const change of invalid) {
    await create({ ...payload(), ...change }).expect(400);
    await save(leadId, { role: "student", locale: "ru", answers, ...change }).expect(400);
  }
  assert.deepEqual([await prisma.lead.count(), await prisma.leadSubmission.count()], before);
});

test("manual creation and saving reject coerced metrics without writes, language changes or notifications", async () => {
  const response = await create(payload()).expect(201);
  const leadId = response.body.lead.id;
  await prisma.lead.update({ where: { id: leadId }, data: { assignedSalesManagerId: managerId } });
  const before = [await prisma.lead.count(), await prisma.leadSubmission.count(), await prisma.leadActivity.count(), createdEvents.length, updatedEvents.length];
  for (const field of ["score", "percent", "universities"]) {
    for (const value of [true, false, "", " ", "1", null, [], [1], {}]) {
      const invalid = { ...metrics, [field]: value };
      await create({ ...payload(), ...invalid }).expect(400);
      await save(leadId, { role: "student", locale: "kk", answers, ...invalid }).expect(400);
    }
  }
  assert.deepEqual([await prisma.lead.count(), await prisma.leadSubmission.count(), await prisma.leadActivity.count(), createdEvents.length, updatedEvents.length], before);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).preferredLanguage, "ru");
});

test("preview still calculates on the server and writes still require Sales authorization", async () => {
  const response = await request(app.getHttpServer())
    .post(`${prefix}/questionnaires/calculator/preview`)
    .set("Authorization", authorization(managerId))
    .send({ role: "student", locale: "ru", answers, ...metrics })
    .expect(201);
  assert.deepEqual(response.body.metrics, { score: 20, percent: 2, universities: 2, provisional: true });
  await request(app.getHttpServer())
    .post(`${prefix}/leads`)
    .send({ ...payload(), ...metrics })
    .expect(401);
  await request(app.getHttpServer())
    .post(`${prefix}/leads`)
    .set("Authorization", authorization(outsiderId))
    .send({ ...payload(), ...metrics })
    .expect(403);
});
