/** Compiled production module/guards + real disposable PostgreSQL; Wazzup only is stubbed. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { PrismaService as PrismaServiceType } from "../src/database/prisma.service";
import type { WazzupContact, WazzupIframeRequest } from "../src/modules/wazzup/wazzup.client";
import { localTestDatabaseUrl } from "./runner-utils.mjs";

localTestDatabaseUrl(process.env.DATABASE_URL);
const built = createRequire(resolve("package.json"));
const { PrismaService } = built("./dist/src/database/prisma.service.js");
const { WazzupModule } = built("./dist/src/modules/wazzup/wazzup.module.js");
const { WazzupClient } = built("./dist/src/modules/wazzup/wazzup.client.js");
const prisma: PrismaServiceType = new PrismaService();
const jwt = new JwtService();
const secret = randomUUID();
const previousSecret = process.env.JWT_SECRET;
const permission = "SALES_LEADS_MANAGE_OWN";
const calls: { payload: WazzupIframeRequest; contacts: WazzupContact[] }[] = [];
let beforeSession: (() => Promise<void>) | undefined;
let afterSession: (() => Promise<void>) | undefined;
let app: INestApplication;
let admin: number, salesA: number, salesB: number, expert: number, student: number;
let leadA: number, leadB: number, unaccepted: number, deleted: number, sourceId: number;
const tokens = new Map<number, string>();
const url = "https://123.wazzup24.com/chat/review?token=fixture-only";
const provider = {
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
  const module = await Test.createTestingModule({ imports: [WazzupModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(ConfigService)
    .useValue(new ConfigService({ WAZZUP_CHANNEL_ID: "fixture-channel" }))
    .overrideProvider(WazzupClient)
    .useValue(provider)
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  await app.listen(0, "127.0.0.1");
});
beforeEach(() => {
  calls.length = 0;
  beforeSession = undefined;
  afterSession = undefined;
});
after(async () => {
  await app?.close();
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
    calls.at(-1)!.payload.filter?.map(chat => chat.chatId),
    ["77001112233"],
  );
  await http(salesB).expect(200);
  assert.deepEqual(
    calls.at(-1)!.payload.filter?.map(chat => chat.chatId),
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
    assert.equal(calls.at(-1)!.contacts[0].responsibleUserId, String(salesB));
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
