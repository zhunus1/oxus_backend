/** Compiled production module/guards + real disposable PostgreSQL; Wazzup only is stubbed. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { ServiceUnavailableException, ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { useContainer } from "class-validator";
import type { PrismaService as PrismaServiceType } from "../src/database/prisma.service";
import type { WazzupContact, WazzupIframeRequest } from "../src/modules/wazzup/wazzup.client";
import { localTestDatabaseUrl } from "./runner-utils.mjs";

localTestDatabaseUrl(process.env.DATABASE_URL);
const built = createRequire(resolve("package.json"));
const { PrismaService } = built("./dist/src/database/prisma.service.js");
const { WazzupModule } = built("./dist/src/modules/wazzup/wazzup.module.js");
const { WazzupClient } = built("./dist/src/modules/wazzup/wazzup.client.js");
const { WazzupAccessService } = built("./dist/src/modules/wazzup/wazzup-access.service.js");
const { AdminController } = built("./dist/src/modules/admin/admin.controller.js");
const { AdminService } = built("./dist/src/modules/admin/admin.service.js");
const { FinanceService } = built("./dist/src/modules/admin/finance.service.js");
const { RoleRepository } = built("./dist/src/modules/admin/role/repository/role.repository.js");
const { ExistsValidator } = built("./dist/src/common/validators/exists.validator.js");
const prisma: PrismaServiceType = new PrismaService();
const jwt = new JwtService();
const secret = randomUUID();
const previousSecret = process.env.JWT_SECRET;
const permission = "SALES_LEADS_MANAGE_OWN";
const calls: { payload: WazzupIframeRequest; contacts: WazzupContact[] }[] = [];
let beforeSession: (() => Promise<void>) | undefined;
let afterSession: (() => Promise<void>) | undefined;
let app: INestApplication;
let mutationAccess: InstanceType<typeof WazzupAccessService>;
let admin: number, salesA: number, salesB: number, expert: number, student: number;
let leadA: number, leadB: number, unaccepted: number, deleted: number, sourceId: number;
const tokens = new Map<number, string>();
const url = "https://123.wazzup24.com/chat/review?token=fixture-only";
const revocations: string[] = [];
let revokeFailure = false;
let enabled = true;
const provider = {
  isEnabled() {
    return enabled;
  },
  assertConfigured() {
    if (!enabled) throw new ServiceUnavailableException({ code: "WAZZUP_NOT_CONFIGURED" });
  },
  async revokeUser(id: string) {
    revocations.push(id);
    if (revokeFailure) throw new Error("fixture provider failure");
  },
  async channels() {
    return [];
  },
  async iframe(payload: WazzupIframeRequest, contacts: WazzupContact[], revalidate?: () => Promise<void>) {
    await revalidate?.();
    await beforeSession?.();
    await revalidate?.();
    calls.push({ payload, contacts });
    await afterSession?.();
    return { url };
  },
};

const http = (actor: number, path = "iframe") =>
  request(app.getHttpServer())
    .post(`/api/v1/integrations/wazzup/${path}`)
    .set("Authorization", `Bearer ${tokens.get(actor)}`);
async function user(code: string) {
  const row = await prisma.user.create({
    data: { firstname: "Wazzup", lastname: "Fixture", email: `${randomUUID()}@example.test`, password: "unused-test-hash", role: { connect: { code } } },
  });
  // Deliberately forged privileged claim must not replace the current DB role.
  tokens.set(row.id, jwt.sign({ sub: row.id, roleCode: "ADMIN" }, { secret, expiresIn: 600 }));
  return row.id;
}
async function lead(owner: number, phoneNumber: string | null, acceptedAt: Date | null = new Date()) {
  return prisma.lead.create({ data: { originSourceId: sourceId, assignedSalesManagerId: owner, acceptedAt, phoneNumber, displayName: "Review client" } });
}

before(async () => {
  process.env.JWT_SECRET = secret;
  await prisma.$connect();
  await prisma.permission.upsert({ where: { code: permission }, create: { code: permission, name: permission }, update: {} });
  for (const code of ["ADMIN", "SALES_MANAGER", "EXPERT", "STUDENT"]) {
    const access = code === "SALES_MANAGER" ? { permissions: { connect: { code: permission } } } : {};
    await prisma.role.upsert({ where: { code }, create: { code, name: code, ...access }, update: access });
  }
  [admin, salesA, salesB, expert, student] = await Promise.all([user("ADMIN"), user("SALES_MANAGER"), user("SALES_MANAGER"), user("EXPERT"), user("STUDENT")]);
  sourceId = (await prisma.leadSource.create({ data: { code: `wazzup-${randomUUID()}`, name: "Wazzup review fixture" } })).id;
  leadA = (await lead(salesA, "8 (700) 111-22-33")).id;
  leadB = (await lead(salesB, "+77004445566")).id;
  unaccepted = (await lead(salesA, "+77006667788", null)).id;
  deleted = (await lead(salesA, "+77009990011")).id;
  await prisma.lead.update({ where: { id: deleted }, data: { deletedAt: new Date() } });
  mutationAccess = new WazzupAccessService(prisma, provider, new ConfigService());
  const module = await Test.createTestingModule({
    imports: [WazzupModule, JwtModule],
    controllers: [AdminController],
    providers: [
      { provide: ExistsValidator, useValue: new ExistsValidator(prisma) },
      { provide: FinanceService, useValue: {} },
      { provide: AdminService, useFactory: () => new AdminService(prisma, {}, {}, { revokeUser() {} }, mutationAccess) },
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(ConfigService)
    .useValue(new ConfigService({ WAZZUP_CHANNEL_ID: "fixture-channel" }))
    .overrideProvider(WazzupClient)
    .useValue(provider)
    .compile();
  app = module.createNestApplication();
  useContainer(module, { fallbackOnErrors: true });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  await app.listen(0, "127.0.0.1");
});
beforeEach(() => {
  calls.length = 0;
  revocations.length = 0;
  revokeFailure = false;
  enabled = true;
  beforeSession = undefined;
  afterSession = undefined;
});
after(async () => {
  await app?.close();
  await mutationAccess?.onModuleDestroy();
  await prisma.$disconnect();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test("authentication and role boundaries reject privileged JWT claims from other roles", async () => {
  await request(app.getHttpServer()).post("/api/v1/integrations/wazzup/iframe").expect(401);
  for (const actor of [expert, student]) for (const path of ["iframe", `leads/${leadA}/iframe`]) await http(actor, path).expect(403);
  assert.equal(calls.length, 0);
});

test("Sales A/B are isolated in both directions; ADMIN opens both without changing contact owners", async () => {
  await http(salesA, `leads/${leadA}/iframe`).expect(200);
  await http(salesB, `leads/${leadB}/iframe`).expect(200);
  await http(salesA, `leads/${leadB}/iframe`).expect(404);
  await http(salesB, `leads/${leadA}/iframe`).expect(404);
  for (const id of [leadA, leadB]) {
    await http(admin, `leads/${id}/iframe`).expect(200);
    assert.deepEqual(calls.at(-1)!.contacts, []);
  }
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: leadA } })).assignedSalesManagerId, salesA);
});

test("assigned but unaccepted and deleted leads are excluded from Sales card and general window", async () => {
  for (const id of [unaccepted, deleted]) await http(salesA, `leads/${id}/iframe`).expect(404);
  await http(salesA).expect(200);
  assert.deepEqual(
    calls.at(-1)!.contacts.map(contact => contact.contactData[0].chatId),
    ["77001112233"],
  );
  await http(salesB).expect(200);
  assert.deepEqual(
    calls.at(-1)!.contacts.map(contact => contact.contactData[0].chatId),
    ["77004445566"],
  );
  await http(admin, `leads/${unaccepted}/iframe`).expect(200);
  await http(admin, `leads/${deleted}/iframe`).expect(404);
});

test("ADMIN alone can list channels and receive a global provider window", async () => {
  for (const actor of [salesA, salesB, expert, student])
    await request(app.getHttpServer())
      .get("/api/v1/integrations/wazzup/channels")
      .set("Authorization", `Bearer ${tokens.get(actor)}`)
      .expect(403);
  await request(app.getHttpServer())
    .get("/api/v1/integrations/wazzup/channels")
    .set("Authorization", `Bearer ${tokens.get(admin)}`)
    .expect(200);
  await http(admin).expect(200);
  assert.equal(calls.at(-1)!.payload.scope, "global");
});

test("reassignment immediately prevents the former owner from receiving new links", async () => {
  try {
    await prisma.lead.update({ where: { id: leadA }, data: { assignedSalesManagerId: salesB } });
    await http(salesA, `leads/${leadA}/iframe`).expect(404);
    await http(salesA).expect(409);
    await http(salesB, `leads/${leadA}/iframe`).expect(200);
    assert.equal(calls.at(-1)!.contacts[0].responsibleUserId, `oxus-${salesB}-1`);
  } finally {
    await prisma.lead.update({ where: { id: leadA }, data: { assignedSalesManagerId: salesA } });
  }
});

test("permission removal and soft deletion invalidate the same previously valid JWT", async () => {
  await http(salesA, `leads/${leadA}/iframe`).expect(200);
  try {
    await prisma.permission.update({ where: { code: permission }, data: { deletedAt: new Date() } });
    await http(salesA, `leads/${leadA}/iframe`).expect(403);
    await http(salesA).expect(403);
    await http(admin).expect(200);
  } finally {
    await prisma.permission.update({ where: { code: permission }, data: { deletedAt: null } });
  }
  try {
    await prisma.role.update({ where: { code: "SALES_MANAGER" }, data: { permissions: { disconnect: { code: permission } } } });
    await http(salesA, `leads/${leadA}/iframe`).expect(403);
  } finally {
    await prisma.role.update({ where: { code: "SALES_MANAGER" }, data: { permissions: { connect: { code: permission } } } });
  }
});

test("null, empty, malformed and invalid country-prefix phones fail before external calls", async () => {
  for (const phone of [null, "", "invalid", "+01234567890", "00000000000"]) {
    const row = await lead(salesA, phone);
    await http(salesA, `leads/${row.id}/iframe`).expect(400);
  }
  assert.equal(calls.length, 0);
});

test("a replacement phone is synchronized under the same lead contact ID", async () => {
  await http(salesA, `leads/${leadA}/iframe`).expect(200);
  const first = calls.at(-1)!.contacts[0];
  try {
    await prisma.lead.update({ where: { id: leadA }, data: { phoneNumber: "+7 700 555 66 77" } });
    await http(salesA, `leads/${leadA}/iframe`).expect(200);
    assert.equal(calls.at(-1)!.contacts[0].id, first.id);
    assert.equal(calls.at(-1)!.contacts[0].contactData[0].chatId, "77005556677");
  } finally {
    await prisma.lead.update({ where: { id: leadA }, data: { phoneNumber: "8 (700) 111-22-33" } });
  }
});

test("reassignment during sync is detected before a session is issued", async () => {
  beforeSession = async () => {
    await prisma.lead.update({ where: { id: leadA }, data: { assignedSalesManagerId: salesB } });
  };
  try {
    const result = await http(salesA, `leads/${leadA}/iframe`).expect(409);
    assert.equal(result.body.code, "WAZZUP_ACCESS_CHANGED");
    assert.equal(calls.length, 0);
  } finally {
    await prisma.lead.update({ where: { id: leadA }, data: { assignedSalesManagerId: salesA } });
  }
});

test("permission removal while a link is being issued suppresses that link in the response", async () => {
  afterSession = async () => {
    await prisma.permission.update({ where: { code: permission }, data: { deletedAt: new Date() } });
  };
  try {
    const result = await http(salesA, `leads/${leadA}/iframe`).expect(403);
    assert.equal(result.body.url, undefined);
    assert.equal(calls.length, 1); // Provider issued a link; revocation is NOT proven by this test.
  } finally {
    await prisma.permission.update({ where: { code: permission }, data: { deletedAt: null } });
  }
});

test("concurrent repeated opens retain stable contact IDs and never modify CRM lead rows", async () => {
  const before = await prisma.lead.findUniqueOrThrow({ where: { id: leadA } });
  await Promise.all(Array.from({ length: 5 }, () => http(salesA, `leads/${leadA}/iframe`).expect(200)));
  assert.equal(new Set(calls.map(call => call.contacts[0].id)).size, 1);
  assert.deepEqual(await prisma.lead.findUniqueOrThrow({ where: { id: leadA } }), before);
});

async function lifecycleFixture() {
  const actor = await user("SALES_MANAGER");
  const own = await lead(actor, "+77003334455");
  await http(actor, `leads/${own.id}/iframe`).expect(200);
  assert.deepEqual(revocations, [String(actor)]);
  revocations.length = 0;
  return { actor, leadId: own.id };
}
const adminRequest = (path: string) =>
  request(app.getHttpServer())
    .patch(`/api/v1/admin/${path}`)
    .set("Authorization", `Bearer ${tokens.get(admin)}`);

test("CRM block revokes the old provider ID; unblock issues a different ID and leaves CRM identity/contracts intact", async () => {
  const { actor, leadId } = await lifecycleFixture();
  assert.equal(calls.at(-1)!.payload.user.id, `oxus-${actor}-1`);
  const blocked = await adminRequest(`users/${actor}/block`).expect(200);
  assert.equal(blocked.body.id, actor);
  assert.equal("wazzupAccess" in blocked.body, false);
  assert.deepEqual(revocations, [`oxus-${actor}-1`]);
  assert.deepEqual(await prisma.wazzupAccess.findUnique({ where: { userId: actor } }), { userId: actor, generation: 2, revocationPending: false });
  await http(actor).expect(401);
  await adminRequest(`users/${actor}/unblock`).expect(200);
  const opened = await http(actor, `leads/${leadId}/iframe`).expect(200);
  assert.deepEqual(Object.keys(opened.body), ["url"]);
  assert.equal(calls.at(-1)!.payload.user.id, `oxus-${actor}-2`);
  assert.equal(calls.at(-1)!.contacts[0].responsibleUserId, `oxus-${actor}-2`);
  assert.equal(calls.at(-1)!.payload.scope, "global");
  assert.equal("filter" in calls.at(-1)!.payload, false);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).assignedSalesManagerId, actor);
});

test("provider failures persist a pending revoke, deny restored grants, and survive a new coordinator instance", async () => {
  const { actor, leadId } = await lifecycleFixture();
  revokeFailure = true;
  await adminRequest(`users/${actor}/block`).expect(200);
  await adminRequest(`users/${actor}/block`).expect(200);
  assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).generation, 2);
  await adminRequest(`users/${actor}/unblock`).expect(200);
  const count = calls.length;
  const denied = await http(actor, `leads/${leadId}/iframe`).expect(409);
  assert.equal(denied.body.code, "WAZZUP_REVOKE_PENDING");
  assert.equal(calls.length, count);
  assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).revocationPending, true);
  revokeFailure = false;
  const restarted = new WazzupAccessService(prisma, provider, new ConfigService());
  try {
    assert.equal(await restarted.withGrant(actor, async (id: string) => id), `oxus-${actor}-2`);
  } finally {
    await restarted.onModuleDestroy();
  }
  assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).revocationPending, false);
  await http(actor, `leads/${leadId}/iframe`).expect(200);
  assert.equal(calls.at(-1)!.payload.user.id, `oxus-${actor}-2`);
});

test("independent coordinators serialize DELETE after in-flight issuance and withhold its URL", async () => {
  const { actor, leadId } = await lifecycleFixture();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  beforeSession = async () => {
    entered();
    await waiting;
  };
  const opening = http(actor, `leads/${leadId}/iframe`).then(response => response);
  await started;
  const blocking = adminRequest(`users/${actor}/block`).then(response => response);
  try {
    const deadline = Date.now() + 5000;
    while (!(await prisma.user.findUniqueOrThrow({ where: { id: actor } })).deletedAt && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).revocationPending, true);
    assert.deepEqual(revocations, []);
  } finally {
    release();
  }
  const denied = await opening;
  assert.ok([403, 409].includes(denied.status));
  assert.equal("url" in denied.body, false);
  assert.equal((await blocking).status, 200);
  assert.deepEqual(revocations, [`oxus-${actor}-1`]);
});

test("OFF preserves pending revocation without provider calls; a later explicit open reconciles before granting", async () => {
  const { actor, leadId } = await lifecycleFixture();
  enabled = false;
  await adminRequest(`users/${actor}/block`).expect(200);
  assert.deepEqual(revocations, []);
  assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).revocationPending, true);
  await adminRequest(`users/${actor}/unblock`).expect(200);
  await http(actor, `leads/${leadId}/iframe`).expect(503);
  enabled = true;
  await http(actor, `leads/${leadId}/iframe`).expect(200);
  assert.deepEqual(revocations, [`oxus-${actor}-1`]);
  assert.equal(calls.at(-1)!.payload.user.id, `oxus-${actor}-2`);
});

test("changing a user's role retires Wazzup access; editing a name does not rotate it", async () => {
  const { actor } = await lifecycleFixture();
  await adminRequest(`users/${actor}`).send({ firstname: "Renamed" }).expect(200);
  assert.deepEqual(revocations, []);
  const expertRole = await prisma.role.findUniqueOrThrow({ where: { code: "EXPERT" } });
  await adminRequest(`users/${actor}`).send({ roleId: expertRole.id }).expect(200);
  assert.deepEqual(revocations, [`oxus-${actor}-1`]);
  await http(actor).expect(403);
  assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).generation, 2);
});

test("removing a role's Wazzup permission retires member sessions atomically and retrying does not lose pending IDs", async () => {
  const { actor } = await lifecycleFixture();
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "SALES_MANAGER" }, include: { permissions: true } });
  const repository = new RoleRepository(prisma, app.get(WazzupAccessService));
  try {
    revokeFailure = true;
    await repository.update(role.id, { permissionIds: [] });
    await http(actor).expect(403);
    assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).generation, 2);
    assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).revocationPending, true);
    revokeFailure = false;
    await repository.update(role.id, { permissionIds: [] });
    assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).generation, 2);
    assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).revocationPending, false);
  } finally {
    await repository.update(role.id, { permissionIds: role.permissions.map(p => p.id) });
  }
});

test("soft deleting a role retires access of its members", async () => {
  const { actor } = await lifecycleFixture();
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "SALES_MANAGER" } });
  try {
    await new RoleRepository(prisma, app.get(WazzupAccessService)).softDeleteMany([role.id]);
    await http(actor).expect(403);
    assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).revocationPending, false);
    assert.ok(revocations.includes(`oxus-${actor}-1`));
  } finally {
    await prisma.role.update({ where: { id: role.id }, data: { deletedAt: null } });
  }
});

test("a stale same-role request still retires access when a concurrent writer changed the actual role", async () => {
  const { actor } = await lifecycleFixture();
  const salesRole = await prisma.role.findUniqueOrThrow({ where: { code: "SALES_MANAGER" } });
  const expertRole = await prisma.role.findUniqueOrThrow({ where: { code: "EXPERT" } });
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const barrier = new Promise<void>(resolve => {
    release = resolve;
  });
  const concurrent = prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: actor }, data: { roleId: expertRole.id } });
    entered();
    await barrier;
  });
  await started;
  const update = adminRequest(`users/${actor}`)
    .send({ roleId: salesRole.id })
    .then(response => response);
  try {
    const deadline = Date.now() + 3000;
    let waiting = false;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%User%') AS waiting`;
      waiting = rows[0].waiting;
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true, "request must reach the contended user row before the competing transaction commits");
  } finally {
    release();
  }
  await concurrent;
  assert.equal((await update).status, 200);
  assert.deepEqual(revocations, [`oxus-${actor}-1`]);
  assert.equal((await prisma.wazzupAccess.findUniqueOrThrow({ where: { userId: actor } })).generation, 2);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).roleId, salesRole.id);
});
