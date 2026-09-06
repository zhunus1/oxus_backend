/** Real Nest guards, validation and PostgreSQL regressions for the shared consultation API.
 * Run after nest build against a disposable local *_test database.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { before, after, test } from "node:test";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { Logger, ValidationPipe, type INestApplication } from "@nestjs/common";
import { useContainer } from "class-validator";
import request from "supertest";
import type { PrismaService as PrismaServiceType } from "../src/database/prisma.service";

// Compiled classes retain the same emitted decorator metadata as production.
const built = createRequire(resolve("package.json"));
const { PrismaService } = built("./dist/src/database/prisma.service.js");
const { ConsultationRepository } = built("./dist/src/modules/consultation/repository/consultation.repository.js");
const { ConsultationService } = built("./dist/src/modules/consultation/service/consultation.service.js");
const { ConsultationController } = built("./dist/src/modules/consultation/api/consultation.controller.js");
const { JwtAuthGuard } = built("./dist/src/modules/admin/auth/rbac/auth.guard.js");
const { RolesGuard } = built("./dist/src/modules/admin/auth/rbac/roles.guard.js");
const { ExistsValidator } = built("./dist/src/common/validators/exists.validator.js");
const { LeadExpertCallService } = built("./dist/src/modules/lead/service/lead-expert-call.service.js");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test PostgreSQL database");
const prisma: PrismaServiceType = new PrismaService();
const repo = new ConsultationRepository(prisma);
const service = new ConsultationService(repo, { add: async () => {}, getJob: async () => null }, { logEvent: async () => {} }, {});
const calls = new LeadExpertCallService(prisma, { emitLeadUpdated() {}, emitExpertLeadUpdated() {}, emitExpertCallRequested() {}, emitNotification() {} });
const jwt = new JwtService();
const runId = randomUUID();
const secret = randomUUID();
let app: INestApplication;
let admin: number, sales: number;
let seq = 0;
const originalSecret = process.env.JWT_SECRET;

async function user(role: string) {
  return prisma.user.create({
    data: { email: `${runId}-${++seq}@example.test`, firstname: "HTTP", lastname: "Fixture", password: "private-test-hash", timezone: "UTC", role: { connect: { code: role } } },
  });
}
async function fixture() {
  const expert = await user("EXPERT");
  const student = await user("STUDENT");
  // Deliberately distinguish the profile ID from every user ID for DTO validation.
  const profile = await prisma.consultantProfile.create({ data: { id: 1000000 + expert.id, userId: expert.id, isActive: true } });
  await prisma.studentPortrait.create({ data: { userId: student.id, consultantProfileId: profile.id } });
  for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) await prisma.expertSchedule.create({ data: { expertId: expert.id, dayOfWeek, startMinute: 0, endMinute: 1440 } });
  const lead = await prisma.lead.create({ data: { assignedSalesManagerId: sales, assignedExpertUserId: expert.id, status: "NEW" } });
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 3);
  start.setUTCHours(10, 0, 0, 0);
  const dto = { clientId: student.id, consultantId: profile.id, startTime: start.toISOString(), endTime: new Date(+start + 1800000).toISOString() };
  return { expert, student, profile, lead, dto };
}
function auth(id: number) {
  return `Bearer ${jwt.sign({ sub: id, roleCode: "ADMIN" }, { secret })}`;
}
function http(id: number, method: "get" | "post" | "patch", path = "") {
  return request(app.getHttpServer())[method](`/consultations${path}`).set("Authorization", auth(id));
}
function shifted(dto: Awaited<ReturnType<typeof fixture>>["dto"], minutes: number) {
  return { ...dto, startTime: new Date(Date.parse(dto.startTime) + minutes * 60000).toISOString(), endTime: new Date(Date.parse(dto.endTime) + minutes * 60000).toISOString() };
}
before(async () => {
  Logger.overrideLogger(false);
  process.env.JWT_SECRET = secret;
  await prisma.$connect();
  for (const code of ["ADMIN", "STUDENT", "SCHOOLBOY", "EXPERT", "SALES_MANAGER"]) await prisma.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  admin = (await user("ADMIN")).id;
  sales = (await user("SALES_MANAGER")).id;
  const module = await Test.createTestingModule({
    controllers: [ConsultationController],
    providers: [
      { provide: ConsultationService, useValue: service },
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
  await app.init();
});
after(async () => {
  await app?.close();
  await prisma.$disconnect();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

test("HTTP: unauthenticated and Sales requests cannot read, create or cancel ordinary consultations", async () => {
  const f = await fixture();
  const created = await http(admin, "post").send(f.dto).expect(201);
  await request(app.getHttpServer()).get(`/consultations/${created.body.id}`).expect(401);
  await http(sales, "get").expect(403);
  await http(sales, "get", `/${created.body.id}`).expect(403);
  await http(sales, "post").send(shifted(f.dto, 60)).expect(403);
  await http(sales, "patch", `/${created.body.id}`).send({ status: "CANCELLED" }).expect(403);
  assert.equal((await prisma.consultation.findUniqueOrThrow({ where: { id: created.body.id } })).status, "REQUESTED");
});

test("HTTP: participant scope survives query filters and responses exclude password hashes", async () => {
  const f = await fixture(),
    other = await fixture();
  const created = await http(f.student.id, "post").send(f.dto).expect(201);
  for (const id of [f.student.id, f.expert.id, admin]) {
    const detail = await http(id, "get", `/${created.body.id}`).expect(200);
    assert.equal(detail.body.client.email, f.student.email);
    assert(!("password" in detail.body.client));
    assert(!JSON.stringify(detail.body).includes("private-test-hash"));
  }
  for (const id of [other.student.id, other.expert.id]) {
    await http(id, "get", `/${created.body.id}`).expect(404);
    await http(id, "patch", `/${created.body.id}`).send({ status: "CANCELLED" }).expect(404);
    const filtered = await http(id, "get").query({ clientId: f.student.id, consultantId: f.profile.id }).expect(200);
    assert.deepEqual(filtered.body, []);
  }
  const list = await http(f.expert.id, "get").expect(200);
  assert.equal(list.body.length, 1);
  assert(!("password" in list.body[0].client));
  const updated = await http(f.expert.id, "patch", `/${created.body.id}`).send({ status: "CONFIRMED" }).expect(200);
  assert(!("password" in updated.body.client));
  assert.equal(updated.body.meeting.status, "SCHEDULED");
});

test("HTTP: creating a consultation validates profile IDs, participant assignment and student status", async () => {
  const f = await fixture(),
    other = await fixture();
  assert.notEqual(f.profile.id, f.expert.id);
  await http(f.student.id, "post")
    .send({ ...f.dto, consultantId: f.expert.id })
    .expect(400);
  await http(f.student.id, "post")
    .send({ ...f.dto, consultantId: other.profile.id })
    .expect(403);
  await http(other.expert.id, "post").send(f.dto).expect(403);
  await http(f.student.id, "post")
    .send({ ...f.dto, status: "CONFIRMED" })
    .expect(403);
  const created = await http(f.expert.id, "post").send(f.dto).expect(201);
  await http(f.student.id, "patch", `/${created.body.id}`).send({ status: "DONE" }).expect(403);
  await http(f.student.id, "patch", `/${created.body.id}`).send({ status: "CANCELLED" }).expect(200);
});

for (const status of ["REQUESTED", "CONFIRMED"] as const)
  test(`HTTP: ${status} CRM calls block ordinary create, move and reactivation`, async () => {
    const f = await fixture();
    await prisma.leadExpertCall.create({
      data: { leadId: f.lead.id, salesManagerId: sales, expertUserId: f.expert.id, startTime: f.dto.startTime, endTime: f.dto.endTime, status },
    });
    await http(admin, "post").send(f.dto).expect(409);
    const adjacent = await http(admin, "post").send(shifted(f.dto, 30)).expect(201);
    await http(admin, "patch", `/${adjacent.body.id}`).send({ startTime: f.dto.startTime, endTime: f.dto.endTime }).expect(409);
    const cancelled = await http(admin, "post")
      .send({ ...f.dto, status: "CANCELLED" })
      .expect(201);
    assert.equal(cancelled.body.meeting.status, "CANCELLED");
    await http(admin, "patch", `/${cancelled.body.id}`).send({ status: "REQUESTED" }).expect(409);
    assert.equal((await prisma.consultation.findUniqueOrThrow({ where: { id: adjacent.body.id } })).startTime.toISOString(), shifted(f.dto, 30).startTime);
  });

test("HTTP: time edits exclude self, reject invalid intervals and synchronize the linked meeting", async () => {
  const f = await fixture();
  await http(admin, "post")
    .send({ ...f.dto, endTime: f.dto.startTime })
    .expect(400);
  const created = await http(admin, "post").send(f.dto).expect(201);
  await http(admin, "patch", `/${created.body.id}`).send({ endTime: f.dto.startTime }).expect(400);
  const changed = await http(admin, "patch", `/${created.body.id}`)
    .send({ endTime: shifted(f.dto, 10).endTime, status: "CONFIRMED" })
    .expect(200);
  assert.equal(changed.body.meeting.endTime, shifted(f.dto, 10).endTime);
  await http(f.student.id, "patch", `/${created.body.id}`)
    .send({ endTime: shifted(f.dto, 20).endTime })
    .expect(409);
  await http(f.student.id, "patch", `/${created.body.id}`).send({ status: "REQUESTED" }).expect(409);
  const cancelled = await http(admin, "patch", `/${created.body.id}`).send({ status: "CANCELLED" }).expect(200);
  assert.equal(cancelled.body.meeting.status, "CANCELLED");
  await http(admin, "post").send(f.dto).expect(201);
  // Legacy records without a linked meeting must remain editable.
  const noMeeting = await prisma.consultation.create({
    data: { clientId: f.student.id, consultantProfileId: f.profile.id, startTime: shifted(f.dto, 90).startTime, endTime: shifted(f.dto, 90).endTime },
  });
  await http(admin, "patch", `/${noMeeting.id}`).send({ status: "DONE" }).expect(200);
});

for (const action of ["create", "move"] as const)
  test(`PostgreSQL: simultaneous ordinary ${action} and CRM booking produce exactly one reservation`, async () => {
    // Exercise both transaction scheduling orders repeatedly with independent experts.
    for (let attempt = 0; attempt < 4; attempt++) {
      const f = await fixture();
      const existing = action === "move" ? await repo.create(shifted(f.dto, 90), { id: admin, roleCode: "ADMIN" }) : null;
      const ordinary = () =>
        (action === "create" ? http(admin, "post").send(f.dto) : http(admin, "patch", `/${existing.id}`).send({ startTime: f.dto.startTime, endTime: f.dto.endTime })).then(
          response => response,
        );
      const crm = () => calls.create(sales, f.lead.id, { expertUserId: f.expert.id, startTime: f.dto.startTime, endTime: f.dto.endTime });
      const outcomes = await Promise.allSettled(attempt % 2 ? [crm(), ordinary()] : [ordinary(), crm()]);
      const codes = outcomes.map(result =>
        result.status === "rejected" ? result.reason.getStatus() : result.value.status === undefined || typeof result.value.status === "string" ? 201 : result.value.status,
      );
      assert.equal(codes.filter(code => code === 200 || code === 201).length, 1, JSON.stringify(codes));
      assert.equal(codes.filter(code => code === 409).length, 1, JSON.stringify(codes));
      const overlap = { startTime: { lt: new Date(f.dto.endTime) }, endTime: { gt: new Date(f.dto.startTime) } };
      const normalCount = await prisma.consultation.count({ where: { consultantProfileId: f.profile.id, status: { not: "CANCELLED" }, ...overlap } });
      const crmCount = await prisma.leadExpertCall.count({ where: { expertUserId: f.expert.id, status: { in: ["REQUESTED", "CONFIRMED"] }, ...overlap } });
      assert.equal(normalCount + crmCount, 1);
    }
  });

test("PostgreSQL: concurrent expert responses cannot overwrite an already processed request", async () => {
  const f = await fixture();
  const created = await repo.create(f.dto, { id: admin, roleCode: "ADMIN" });
  const results = await Promise.allSettled([
    service.respondToMeetingRequest(f.expert.id, created.id, "confirm"),
    service.respondToMeetingRequest(f.expert.id, created.id, "decline"),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected");
  assert(rejected?.status === "rejected" && [400, 409].includes(rejected.reason.getStatus()));
});
