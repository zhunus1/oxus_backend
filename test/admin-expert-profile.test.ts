/** Run after build/migrations against a disposable local *_test database. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { Logger, ValidationPipe, type INestApplication } from "@nestjs/common";
import { useContainer } from "class-validator";
import request from "supertest";
import type { PrismaService as PrismaServiceType } from "../src/database/prisma.service";

const built = createRequire(resolve("package.json"));
const klass = (path: string, name: string) => built(`./dist/src/${path}.js`)[name];
const PrismaService = klass("database/prisma.service", "PrismaService");
const AdminController = klass("modules/admin/admin.controller", "AdminController");
const AdminService = klass("modules/admin/admin.service", "AdminService");
const FinanceService = klass("modules/admin/finance.service", "FinanceService");
const UsersController = klass("modules/admin/users/api/users.controller", "UsersController");
const UsersService = klass("modules/admin/users/service/users.service", "UsersService");
const UsersRepository = klass("modules/admin/users/repository/users.repository", "UsersRepository");
const SalesLeadController = klass("modules/lead/api/sales-lead.controller", "SalesLeadController");
const SalesLeadService = klass("modules/lead/service/sales-lead.service", "SalesLeadService");
const LeadExpertCallService = klass("modules/lead/service/lead-expert-call.service", "LeadExpertCallService");
const LeadRealtimeGateway = klass("modules/lead/realtime/lead-realtime.gateway", "LeadRealtimeGateway");
const JwtAuthGuard = klass("modules/admin/auth/rbac/auth.guard", "JwtAuthGuard");
const RolesGuard = klass("modules/admin/auth/rbac/roles.guard", "RolesGuard");
const ExistsValidator = klass("common/validators/exists.validator", "ExistsValidator");
const UniqueValidator = klass("common/validators/unique.validator", "UniqueValidator");
const url = new URL(process.env.DATABASE_URL ?? "");
assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_test"), "Use a disposable local *_test database");
const prisma: PrismaServiceType = new PrismaService();
const jwt = new JwtService();
const secret = randomUUID();
const originalSecret = process.env.JWT_SECRET;
const runId = randomUUID();
const roles = new Map<string, number>();
const revoked: number[] = [];
const registrations: number[] = [];
const realtime = {
  revokeUser(id: number) {
    revoked.push(id);
  },
};
const journey = {
  async logEvent(id: number) {
    registrations.push(id);
  },
};
let seq = randomInt(1000000, 8000000);
let app: INestApplication;
let admin: number, sales: number;
let countryId: number;

function dto(code = "EXPERT") {
  const n = ++seq;
  return {
    firstname: "Profile",
    lastname: `Audit-${runId}`,
    email: `${runId}-${n}@example.test`,
    phoneNumber: `+7701${n}`,
    password: "Synthetic-only-123!",
    roleId: roles.get(code)!,
    countryId,
    citizenshipCountryId: countryId,
  };
}
async function legacyUser(code = "EXPERT") {
  const data = dto(code);
  return prisma.user.create({ data });
}
function http(actor: number, method: "get" | "post" | "patch", path: string) {
  return request(app.getHttpServer())
    [method](path)
    .set("Authorization", `Bearer ${jwt.sign({ sub: actor }, { secret })}`);
}
async function listed(id: number) {
  const res = await http(sales, "get", "/sales/experts")
    .query({ page: 1, limit: 100, search: `Audit-${runId}` })
    .expect(200);
  assert.equal(res.body.meta.limit, 100);
  assert.equal(res.body.meta.total, res.body.data.length);
  return res.body.data.find((expert: { expertUserId: number }) => expert.expertUserId === id);
}

before(async () => {
  Logger.overrideLogger(false);
  process.env.JWT_SECRET = secret;
  await prisma.$connect();
  countryId = (await prisma.country.upsert({ where: { isoCode: "KZ" }, create: { isoCode: "KZ" }, update: {} })).id;
  for (const code of ["ADMIN", "EXPERT", "STUDENT", "SALES_MANAGER"]) {
    const role = await prisma.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
    roles.set(code, role.id);
  }
  const permission = await prisma.permission.upsert({
    where: { code: "SALES_EXPERTS_READ_SLOTS" },
    create: { code: "SALES_EXPERTS_READ_SLOTS", name: "Read expert slots" },
    update: {},
  });
  await prisma.role.update({ where: { code: "SALES_MANAGER" }, data: { permissions: { connect: { id: permission.id } } } });
  admin = (await legacyUser("ADMIN")).id;
  sales = (await legacyUser("SALES_MANAGER")).id;
  const module = await Test.createTestingModule({
    controllers: [AdminController, UsersController, SalesLeadController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: AdminService, useValue: new AdminService(prisma, journey, {}, realtime) },
      { provide: FinanceService, useValue: {} },
      { provide: LeadRealtimeGateway, useValue: realtime },
      { provide: UsersService, useValue: new UsersService(new UsersRepository(prisma), journey) },
      { provide: SalesLeadService, useValue: {} },
      { provide: LeadExpertCallService, useValue: new LeadExpertCallService(prisma, realtime) },
      { provide: ExistsValidator, useValue: new ExistsValidator(prisma) },
      { provide: UniqueValidator, useValue: new UniqueValidator(prisma) },
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

for (const path of ["/admin/users", "/users"]) {
  test(`${path}: new EXPERT immediately appears in the Sales expert list`, async () => {
    const created = await http(admin, "post", path).send(dto()).expect(201);
    const profile = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: created.body.id } });
    assert.equal(profile.isActive, true);
    const expert = await listed(created.body.id);
    assert.equal(expert.consultantProfileId, profile.id);
    if (path === "/admin/users") assert.equal("password" in created.body, false);
  });
}

test("assigning EXPERT creates a profile and preserves the existing student portrait", async () => {
  const student = await legacyUser("STUDENT");
  const portrait = await prisma.studentPortrait.create({ data: { userId: student.id, consultationBalance: 7 } });
  const res = await http(admin, "patch", `/admin/users/${student.id}`)
    .send({ roleId: roles.get("EXPERT") })
    .expect(200);
  assert.equal(res.body.role.code, "EXPERT");
  assert.equal("password" in res.body, false);
  assert.ok(await listed(student.id));
  assert.equal((await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: student.id } })).id, portrait.id);
  assert.equal((await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: student.id } })).consultationBalance, 7);
  assert.ok(revoked.includes(student.id));
});

for (const includeRole of [false, true]) {
  test(`saving a legacy EXPERT repairs the missing profile (role supplied: ${includeRole})`, async () => {
    const user = await legacyUser();
    assert.equal(await listed(user.id), undefined);
    const data = { firstname: "Updated", ...(includeRole ? { roleId: roles.get("EXPERT") } : {}) };
    await http(admin, "patch", `/admin/users/${user.id}`).send(data).expect(200);
    assert.ok(await listed(user.id));
    await http(admin, "patch", `/admin/users/${user.id}`).send(data).expect(200);
    assert.equal(await prisma.consultantProfile.count({ where: { userId: user.id } }), 1);
  });
}

for (const isActive of [false, true]) {
  test(`saving or reassigning EXPERT preserves profile identity and isActive=${isActive}`, async () => {
    const user = await legacyUser();
    const profile = await prisma.consultantProfile.create({ data: { userId: user.id, isActive, bio: "Retain biography", rating: 4.2, successRate: 75 } });
    await http(admin, "patch", `/admin/users/${user.id}`)
      .send({ roleId: roles.get("EXPERT") })
      .expect(200);
    assert.deepEqual(await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: user.id } }), profile);
    await http(admin, "patch", `/admin/users/${user.id}`)
      .send({ roleId: roles.get("STUDENT") })
      .expect(200);
    assert.equal(await listed(user.id), undefined);
    await http(admin, "patch", `/admin/users/${user.id}`)
      .send({ roleId: roles.get("EXPERT") })
      .expect(200);
    assert.deepEqual(await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: user.id } }), profile);
    assert.equal(!!(await listed(user.id)), isActive);
  });
}

test("non-expert creation/edit retains student behavior without a consultant profile", async () => {
  const created = await http(admin, "post", "/admin/users").send(dto("STUDENT")).expect(201);
  const portrait = await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: created.body.id } });
  assert.equal(portrait.consultationBalance, 2);
  assert.ok(registrations.includes(created.body.id));
  await http(admin, "patch", `/admin/users/${created.body.id}`).send({ firstname: "Updated" }).expect(200);
  assert.equal(await prisma.consultantProfile.count({ where: { userId: created.body.id } }), 0);
});

test("concurrent legacy saves create exactly one profile", async () => {
  const user = await legacyUser();
  const results = await Promise.all(Array.from({ length: 3 }, () => http(admin, "patch", `/admin/users/${user.id}`).send({ roleId: roles.get("EXPERT") })));
  for (const res of results) assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await prisma.consultantProfile.count({ where: { userId: user.id } }), 1);
  assert.ok(await listed(user.id));
});

test("blocked users remain hidden; Sales cannot use admin writes; self role-change stays forbidden", async () => {
  const user = await legacyUser();
  await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
  await http(admin, "patch", `/admin/users/${user.id}`).send({ firstname: "Updated" }).expect(200);
  assert.equal(await listed(user.id), undefined);
  await http(sales, "patch", `/admin/users/${user.id}`)
    .send({ roleId: roles.get("EXPERT") })
    .expect(403);
  await http(sales, "post", "/admin/users").send(dto()).expect(403);
  await http(admin, "patch", `/admin/users/${admin}`)
    .send({ roleId: roles.get("EXPERT") })
    .expect(400);
  assert.equal(await prisma.consultantProfile.count({ where: { userId: admin } }), 0);
});

test("profile insertion failure rolls back user creation and role changes", async () => {
  const student = await legacyUser("STUDENT");
  await prisma.$executeRawUnsafe(`CREATE FUNCTION expert_profile_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected profile failure'; END; $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER expert_profile_test_failure BEFORE INSERT ON "ConsultantProfile" FOR EACH ROW EXECUTE FUNCTION expert_profile_test_failure()`);
  try {
    for (const path of ["/admin/users", "/users"]) {
      const data = dto();
      await http(admin, "post", path).send(data).expect(500);
      assert.equal(await prisma.user.count({ where: { email: data.email } }), 0);
    }
    const before = revoked.length;
    await http(admin, "patch", `/admin/users/${student.id}`)
      .send({ firstname: "Should roll back", roleId: roles.get("EXPERT") })
      .expect(500);
    const persisted = await prisma.user.findUniqueOrThrow({ where: { id: student.id } });
    assert.equal(persisted.firstname, student.firstname);
    assert.equal(persisted.roleId, student.roleId);
    assert.equal(revoked.length, before);
    assert.equal(await prisma.consultantProfile.count({ where: { userId: student.id } }), 0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER expert_profile_test_failure ON "ConsultantProfile"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION expert_profile_test_failure()`);
  }
});

test("C01: HTTP listener survives sequential and concurrent requests until suite teardown", async () => {
  const server = app.getHttpServer();
  assert.equal(server.listening, true, "The suite must own a persistent HTTP listener");
  const address = server.address();
  let closes = 0;
  const closed = () => closes++;
  server.on("close", closed);
  try {
    for (let i = 0; i < 5; i++) await http(admin, "get", "/admin/roles").expect(200);
    await Promise.all(Array.from({ length: 5 }, () => http(admin, "get", "/admin/roles").expect(200)));
    assert.equal(server.listening, true);
    assert.deepEqual(server.address(), address);
    assert.equal(closes, 0, "A request must never close the suite's HTTP listener");
  } finally {
    server.off("close", closed);
  }
});
