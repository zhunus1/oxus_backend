/** Real HTTP validation, throttling and PostgreSQL ingestion. Run after nest build on a disposable *_test database. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import type { PrismaService as PrismaServiceType } from "../src/database/prisma.service";

const built = createRequire(resolve("package.json"));
const klass = (path: string, name: string) => built(`./dist/src/${path}.js`)[name];
const PrismaService = klass("database/prisma.service", "PrismaService");
const LeadIngestionRepository = klass("modules/lead/repository/lead-ingestion.repository", "LeadIngestionRepository");
const LeadIngestionService = klass("modules/lead/service/lead-ingestion.service", "LeadIngestionService");
const PublicLeadController = klass("modules/lead/api/public-lead.controller", "PublicLeadController");
const ExpressAdapter = klass("modules/lead/service/express.adapter", "ExpressAdapter");
const LandingCalculatorAdapter = klass("modules/lead/service/landing-calculator.adapter", "LandingCalculatorAdapter");
const LegacyContactFormAdapter = klass("modules/lead/service/legacy-contact-form.adapter", "LegacyContactFormAdapter");
const OfficeManualAdapter = klass("modules/lead/service/office-manual.adapter", "OfficeManualAdapter");
const LeadRealtimeGateway = klass("modules/lead/realtime/lead-realtime.gateway", "LeadRealtimeGateway");
const JwtAuthGuard = klass("modules/admin/auth/rbac/auth.guard", "JwtAuthGuard");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test PostgreSQL database");
const prisma: PrismaServiceType = new PrismaService();
const events: number[] = [];
const path = "/api/v1/public/lead-sources/express/submissions";
let app: INestApplication;
let countryIds: number[];
let testIp = 0;
const payload = () => ({
  submissionId: randomUUID(),
  submittedAt: "2026-10-03T09:00:00.000Z",
  locale: "kk",
  firstName: "  Алихан  ",
  lastName: "  Әлиев  ",
  middleName: "  Ерланұлы  ",
  phone: "+7 (777) 482-19-33",
  schoolName: "  Школа № 125  ",
  grade: 10,
  countryIds,
  studyFields: ["IT", "ENGINEERING"],
});
const post = (body: object) => request(app.getHttpServer()).post(path).set("X-Forwarded-For", `192.0.2.${testIp}`).send(body);

// Keep each test's rate-limit budget independent, using the production proxy configuration.
beforeEach(() => {
  testIp++;
});

before(async () => {
  await prisma.$connect();
  assert.equal((await prisma.leadSource.findUniqueOrThrow({ where: { code: "express" } })).isActive, true, "Apply the Express source migration first");
  countryIds = await Promise.all(
    ["XT", "XU"].map(async isoCode => (await prisma.country.upsert({ where: { isoCode }, create: { isoCode, nameRu: "Express test country" }, update: {} })).id),
  );
  const module = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ name: "public-lead-submission", ttl: 60_000, limit: 30 }])],
    controllers: [PublicLeadController],
    providers: [
      LeadIngestionService,
      LeadIngestionRepository,
      ExpressAdapter,
      LandingCalculatorAdapter,
      OfficeManualAdapter,
      LegacyContactFormAdapter,
      { provide: PrismaService, useValue: prisma },
      { provide: LeadRealtimeGateway, useValue: { emitLeadCreated: (lead: { id: number }) => events.push(lead.id) } },
      { provide: APP_GUARD, useValue: new JwtAuthGuard(new Reflector(), new JwtService(), prisma) },
    ],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  await app.listen(0, "127.0.0.1");
});

after(async () => {
  await app?.close();
  await prisma.$disconnect();
});

test("public Express submission saves an unassigned student lead, complete questionnaire and one event", async () => {
  const body = payload();
  const response = await post({ ...body, role: "parent", originSourceId: 1, assignedSalesManagerId: 1, status: "CONVERTED" }).expect(201);
  assert.equal(response.body.created, true);
  assert.deepEqual(Object.keys(response.body).sort(), ["created", "leadId"]);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.body.leadId }, include: { originSource: true, submissions: true, activities: true } });
  assert.equal(lead.originSource.code, "express");
  assert.equal(lead.status, "NEW");
  assert.equal(lead.role, "student");
  assert.equal(lead.preferredLanguage, "kk");
  assert.equal(lead.displayName, "Әлиев Алихан Ерланұлы");
  assert.equal(lead.firstName, "Алихан");
  assert.equal(lead.lastName, "Әлиев");
  assert.equal(lead.phoneNumber, "+77774821933");
  assert.equal(lead.email, null);
  assert.equal(lead.assignedSalesManagerId, null);
  assert.equal(lead.createdByUserId, null);
  assert.equal(lead.submissions.length, 1);
  assert.deepEqual(lead.submissions[0].rawPayload, body);
  assert.equal(lead.submissions[0].schemaVersion, "express-v1");
  assert.equal(lead.submissions[0].externalSubmissionId, body.submissionId);
  assert.equal(lead.submissions[0].submittedAt?.toISOString(), body.submittedAt);
  assert.deepEqual(lead.submissions[0].normalizedPayload, {
    displayName: "Әлиев Алихан Ерланұлы",
    firstName: "Алихан",
    lastName: "Әлиев",
    middleName: "Ерланұлы",
    phoneNumber: "+77774821933",
    role: "student",
    preferredLanguage: "kk",
    schoolName: "Школа № 125",
    grade: 10,
    countryIds,
    studyFields: ["IT", "ENGINEERING"],
  });
  assert.equal(lead.submissions[0].metrics, null);
  assert.equal(lead.activities.length, 1);
  assert.deepEqual(lead.activities[0].metadata, { source: "express" });
  assert.equal(events.filter(id => id === lead.id).length, 1);

  const retry = await post(body).expect(201);
  assert.deepEqual(retry.body, { leadId: lead.id, created: false });
  assert.equal(await prisma.leadSubmission.count({ where: { leadId: lead.id } }), 1);
  assert.equal(events.filter(id => id === lead.id).length, 1);
});

test("concurrent Express retries create exactly one lead and one event", async () => {
  const body = { ...payload(), score: 935, percent: 12, universities: 50 };
  const responses = await Promise.all(Array.from({ length: 5 }, () => post(body).expect(201)));
  assert.equal(responses.filter(response => response.body.created).length, 1);
  const leadId = responses[0].body.leadId;
  assert(responses.every(response => response.body.leadId === leadId));
  assert.equal(await prisma.leadSubmission.count({ where: { source: { code: "express" }, externalSubmissionId: body.submissionId } }), 1);
  assert.equal(await prisma.leadActivity.count({ where: { leadId } }), 1);
  assert.equal(events.filter(id => id === leadId).length, 1);
  const submission = await prisma.leadSubmission.findFirstOrThrow({ where: { leadId } });
  assert.deepEqual(submission.metrics, { score: 935, percent: 12, universities: 50 });
  assert.deepEqual(submission.rawPayload, body);
});

test("Express stores frontend metrics without recalculation and retries cannot overwrite them", async () => {
  const body = { ...payload(), score: 935, percent: 12, universities: 50 };
  const created = await post(body).expect(201);
  const retry = await post({ ...body, score: 100, percent: 10, universities: 2 }).expect(201);
  assert.deepEqual(retry.body, { leadId: created.body.leadId, created: false });
  const submissions = await prisma.leadSubmission.findMany({ where: { leadId: created.body.leadId } });
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].metrics, { score: 935, percent: 12, universities: 50 });
  assert.deepEqual(submissions[0].rawPayload, body);
  assert.equal(events.filter(id => id === created.body.leadId).length, 1);
  const zero = await post({ ...payload(), score: 0, percent: 0, universities: 0 }).expect(201);
  assert.deepEqual((await prisma.leadSubmission.findFirstOrThrow({ where: { leadId: zero.body.leadId } })).metrics, { score: 0, percent: 0, universities: 0 });
});

test("Express rejects incomplete, null and out-of-range metrics without creating leads", async () => {
  const before = [await prisma.lead.count(), await prisma.leadSubmission.count()];
  for (const metrics of [
    { score: 935 },
    { percent: 0 },
    { universities: 0 },
    { score: 0, percent: 0 },
    { score: 0, universities: 0 },
    { percent: 0, universities: 0 },
    { score: null, percent: null, universities: null },
    { score: -1, percent: 0, universities: 0 },
    { score: 1001, percent: 93, universities: 50 },
    { score: 935, percent: 101, universities: 50 },
    { score: 935, percent: 93, universities: 10001 },
  ])
    await post({ ...payload(), ...metrics }).expect(400);
  assert.deepEqual([await prisma.lead.count(), await prisma.leadSubmission.count()], before);
});

for (const field of ["score", "percent", "universities"]) {
  test(`Express rejects coerced ${field} values without persisting or notifying`, async () => {
    const before = [await prisma.lead.count(), await prisma.leadSubmission.count(), events.length];
    for (const value of [true, false, "", " ", "1", null, [], [1], {}]) {
      await post({ ...payload(), score: 1, percent: 1, universities: 1, [field]: value }).expect(400);
    }
    assert.deepEqual([await prisma.lead.count(), await prisma.leadSubmission.count(), events.length], before);
  });
}

test("Express accepts omitted optional fields and validates phones, grades, identities, countries and study fields", async () => {
  const body = payload();
  const accepted = await post({ ...body, middleName: undefined, submittedAt: undefined }).expect(201);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: accepted.body.leadId }, include: { submissions: true } });
  assert.equal(lead.displayName, "Әлиев Алихан");
  const before = await prisma.lead.count();
  for (const change of [
    { submissionId: undefined },
    { schoolName: "   " },
    { firstName: "   " },
    { phone: "@telegram" },
    { grade: 8 },
    { grade: "10" },
    { countryIds: [] },
    { countryIds: [countryIds[0], countryIds[0]] },
    { countryIds: [2_147_483_647] },
    { studyFields: ["UNKNOWN"] },
  ])
    await post({ ...payload(), ...change }).expect(400);
  assert.equal(await prisma.lead.count(), before);
});

test("disabled Express source rejects submissions without creating leads", async () => {
  await prisma.leadSource.update({ where: { code: "express" }, data: { isActive: false } });
  const before = await prisma.lead.count();
  try {
    await post(payload()).expect(404);
    assert.equal(await prisma.lead.count(), before);
  } finally {
    await prisma.leadSource.update({ where: { code: "express" }, data: { isActive: true } });
  }
});

test("landing calculator endpoint retains its existing payload and response", async () => {
  const response = await request(app.getHttpServer())
    .post("/api/v1/public/lead-sources/landing-calculator/submissions")
    .send({
      submissionId: randomUUID(),
      submittedAt: "2026-10-03T09:00:00.000Z",
      role: "parent",
      locale: "ru",
      name: "Parent Name",
      phone: "+77774821933",
      score: "935",
      percent: "93",
      universities: "50",
      answers: [{ question: "Город?", answer: "Алматы" }],
    })
    .expect(201);
  assert.equal(response.body.created, true);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.body.leadId }, include: { originSource: true } });
  assert.equal(lead.originSource.code, "landing-calculator");
  assert.equal(lead.role, "parent");
  assert.deepEqual((await prisma.leadSubmission.findFirstOrThrow({ where: { leadId: lead.id } })).metrics, { score: 935, percent: 93, universities: 50 });
});

test("Express throttles repeated submissions without creating extra leads", async () => {
  const body = payload();
  for (let i = 0; i < 30; i++) await post(body).expect(201);
  await post(body).expect(429);
  assert.equal(await prisma.leadSubmission.count({ where: { source: { code: "express" }, externalSubmissionId: body.submissionId } }), 1);
});
