/** Run after nest build with DATABASE_URL pointing to a disposable local *_test database. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { Logger, ValidationPipe, type INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { PrismaService as PrismaServiceType } from "../src/database/prisma.service";

const built = createRequire(resolve("package.json"));
const { PrismaService } = built("./dist/src/database/prisma.service.js");
const { JwtAuthGuard } = built("./dist/src/modules/admin/auth/rbac/auth.guard.js");
const { RolesGuard } = built("./dist/src/modules/admin/auth/rbac/roles.guard.js");
const { LEAD_PERMISSION } = built("./dist/src/modules/lead/domain/lead.constants.js");
const { LeadExpertCallService } = built("./dist/src/modules/lead/service/lead-expert-call.service.js");
const { ExpertLeadService } = built("./dist/src/modules/lead/service/expert-lead.service.js");
const { LeadRealtimeGateway } = built("./dist/src/modules/lead/realtime/lead-realtime.gateway.js");
const { SalesV2Controller } = built("./dist/src/modules/lead/api/sales-v2.controller.js");
const { SalesLeadController } = built("./dist/src/modules/lead/api/sales-lead.controller.js");
const { ExpertLeadController } = built("./dist/src/modules/lead/api/expert-lead.controller.js");
const { ExpertLeadCallController } = built("./dist/src/modules/lead/api/expert-lead-call.controller.js");
const { ManualLeadV2Service } = built("./dist/src/modules/lead/service/manual-lead-v2.service.js");
const { CalculatorQuestionnaireService } = built("./dist/src/modules/lead/service/calculator-questionnaire.service.js");
const { LeadAvailabilityService } = built("./dist/src/modules/lead/service/lead-availability.service.js");
const { SalesLeadService } = built("./dist/src/modules/lead/service/sales-lead.service.js");
const { LeadContractService } = built("./dist/src/modules/lead/service/lead-contract.service.js");
const { LeadGuestMeetingService } = built("./dist/src/modules/lead/service/lead-guest-meeting.service.js");
const { LeadStudentInvitationService } = built("./dist/src/modules/lead/service/lead-student-invitation.service.js");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test PostgreSQL database");
const prisma: PrismaServiceType = new PrismaService();
const jwt = new JwtService();
const secret = randomUUID();
const runId = randomUUID();
const originalSecret = process.env.JWT_SECRET;
const events: { room: string; name: string; payload: unknown }[] = [];
const realtime = new LeadRealtimeGateway(jwt, prisma);
realtime.server = { to: (room: string) => ({ emit: (name: string, payload: unknown) => events.push({ room, name, payload }) }) };
const calls = new LeadExpertCallService(prisma, realtime);
let app: INestApplication;
let salesId: number;
let sequence = 0;

async function user(role: string) {
  return prisma.user.create({
    data: {
      email: `${runId}-${++sequence}@example.test`,
      firstname: "Visibility",
      lastname: "Fixture",
      password: "unused-test-hash",
      timezone: "UTC",
      role: { connect: { code: role } },
    },
  });
}

async function fixture() {
  const expert = await user("EXPERT");
  const otherExpert = await user("EXPERT");
  await prisma.consultantProfile.create({ data: { id: 1000000 + expert.id, userId: expert.id, isActive: true } });
  for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) await prisma.expertSchedule.create({ data: { expertId: expert.id, dayOfWeek, startMinute: 0, endMinute: 1440 } });
  const lead = await prisma.lead.create({ data: { assignedSalesManagerId: salesId, status: "NEW" } });
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 3);
  start.setUTCHours(10, 0, 0, 0);
  return { expert, otherExpert, lead, booking: { expertUserId: expert.id, startTime: start.toISOString(), endTime: new Date(+start + 1800000).toISOString() } };
}

function http(id: number, method: "get" | "post" | "patch", path: string) {
  return request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set("Authorization", `Bearer ${jwt.sign({ sub: id }, { secret })}`);
}

before(async () => {
  Logger.overrideLogger(false);
  process.env.JWT_SECRET = secret;
  await prisma.$connect();
  for (const [code, permissions] of [
    ["SALES_MANAGER", [LEAD_PERMISSION.MANAGE_OWN]],
    ["EXPERT", [LEAD_PERMISSION.RESPOND_EXPERT_CALL]],
  ] as const) {
    for (const permission of permissions) await prisma.permission.upsert({ where: { code: permission }, create: { code: permission, name: permission }, update: {} });
    await prisma.role.upsert({
      where: { code },
      create: { code, name: code, permissions: { connect: permissions.map(code => ({ code })) } },
      update: { permissions: { connect: permissions.map(code => ({ code })) } },
    });
  }
  salesId = (await user("SALES_MANAGER")).id;
  const module = await Test.createTestingModule({
    controllers: [SalesV2Controller, SalesLeadController, ExpertLeadController, ExpertLeadCallController],
    providers: [
      { provide: LeadExpertCallService, useValue: calls },
      { provide: ExpertLeadService, useValue: new ExpertLeadService(prisma, realtime) },
      ...[
        ManualLeadV2Service,
        CalculatorQuestionnaireService,
        LeadAvailabilityService,
        SalesLeadService,
        LeadContractService,
        LeadGuestMeetingService,
        LeadStudentInvitationService,
      ].map(provide => ({ provide, useValue: {} })),
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(new JwtAuthGuard(new Reflector(), jwt, prisma))
    .overrideGuard(RolesGuard)
    .useValue(new RolesGuard(new Reflector()))
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  await app.init();
});

after(async () => {
  await app?.close();
  await prisma.$disconnect();
  realtime.onModuleDestroy();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

for (const flow of ["preview-save", "legacy"] as const)
  test(`HTTP: ${flow} online booking immediately appears in the assigned expert NEW tab`, async () => {
    const { expert, otherExpert, lead, booking } = await fixture();
    const list = (id: number, query = { tab: "NEW" }) => http(id, "get", "/expert/leads").query(query).expect(200);
    assert.equal((await list(expert.id)).body.meta.total, 0);
    let call;
    if (flow === "preview-save") {
      const preview = await http(salesId, "post", `/sales/v2/leads/${lead.id}/meeting-preview`)
        .send({ ...booking, format: "ONLINE" })
        .expect(201);
      assert(preview.body.guestUrl);
      assert.equal((await list(expert.id)).body.meta.total, 0, "Generating an invitation alone must not assign the lead");
      assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).assignedExpertUserId, null);
      call = (await http(salesId, "post", `/sales/v2/leads/${lead.id}/meetings`).send({ invitationId: preview.body.invitationId }).expect(201)).body;
      const retry = await http(salesId, "post", `/sales/v2/leads/${lead.id}/meetings`).send({ invitationId: preview.body.invitationId }).expect(201);
      assert.equal(retry.body.id, call.id);
    } else {
      call = (await http(salesId, "post", `/sales/leads/${lead.id}/expert-calls`).send(booking).expect(201)).body;
    }
    assert.equal(call.status, "REQUESTED");
    assert.equal(call.meetingId, null, "Lead visibility must not require a confirmed Meeting");
    const result = (await list(expert.id)).body;
    assert.equal(result.meta.total, 1);
    assert.equal(result.data[0].id, lead.id);
    assert.equal(result.data[0].assignedExpertUserId, expert.id);
    assert.equal(result.data[0].status, "CALL_SCHEDULED");
    assert.equal((await http(expert.id, "get", "/expert/leads").expect(200)).body.meta.total, 1, "Default tab must be NEW");
    assert.equal((await http(expert.id, "get", "/expert/leads/summary").expect(200)).body.NEW, 1);
    assert.equal((await list(otherExpert.id)).body.meta.total, 0);
    await http(otherExpert.id, "get", `/expert/leads/${lead.id}`).expect(404);
    await http(salesId, "get", "/expert/leads").expect(403);
    for (const name of ["expert-lead.updated", "expert-lead.summary.updated"]) {
      assert(events.some(event => event.room === `expert:user:${expert.id}` && event.name === name && (event.payload as { leadId: number }).leadId === lead.id));
    }
    await http(expert.id, "post", `/expert/leads/${lead.id}/start`).expect(201);
    assert.equal((await list(expert.id)).body.meta.total, 1, "Starting work must retain the NEW card");
    await http(expert.id, "patch", `/expert/lead-calls/${call.id}/respond`).send({ action: "confirm" }).expect(200);
    assert.equal((await list(expert.id)).body.meta.total, 1, "Confirming the call must retain the NEW card");
  });
