/** Uses an existing schema in a disposable local *_test DB; never applies migrations or contacts storage. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { before, after, test } from "node:test";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { Logger, ValidationPipe, type INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService as PrismaServiceType } from "../src/database/prisma.service";

const url = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"), "Use a disposable local *_test database");
const built = createRequire(resolve("package.json"));
const klass = (path: string, name: string) => built(`./dist/src/${path}.js`)[name];
const PrismaService = klass("database/prisma.service", "PrismaService");
const DocumentService = klass("modules/document/service/document.service", "DocumentService");
const DocumentRepository = klass("modules/document/repository/document.repository", "DocumentRepository");
const DocumentController = klass("modules/document/api/document.controller", "DocumentController");
const Access = klass("common/authorization/student-document-access.service", "StudentDocumentAccessService");
const RequirementService = klass("modules/program-requirement/service/program-requirement.service", "ProgramRequirementService");
const RequirementRepository = klass("modules/program-requirement/repository/program-requirement.repository", "ProgramRequirementRepository");
const RequirementController = klass("modules/program-requirement/api/program-requirement.controller", "ProgramRequirementController");
const PortraitService = klass("modules/admin/portrait/service/portrait.service", "PortraitService");
const PortraitRepository = klass("modules/admin/portrait/repository/portrait.repository", "PortraitRepository");
const PortraitController = klass("modules/admin/portrait/api/portrait.controller", "PortraitController");
const TargetService = klass("modules/target-program/service/target-program.service", "TargetProgramService");
const TargetRepository = klass("modules/target-program/repository/target-program.repository", "TargetProgramRepository");
const TargetController = klass("modules/target-program/api/target-program.controller", "TargetProgramController");
const DashboardService = klass("modules/expert-dashboard/service/expert-dashboard.service", "ExpertDashboardService");
const DashboardRepository = klass("modules/expert-dashboard/repository/expert-dashboard.repository", "ExpertDashboardRepository");
const DashboardController = klass("modules/expert-dashboard/api/expert-dashboard.controller", "ExpertDashboardController");
const ExpertStudentsController = klass("modules/expert-dashboard/api/expert-students.controller", "ExpertStudentsController");
const AdminController = klass("modules/admin/admin.controller", "AdminController");
const AdminService = klass("modules/admin/admin.service", "AdminService");
const FinanceService = klass("modules/admin/finance.service", "FinanceService");
const LeadRealtimeGateway = klass("modules/lead/realtime/lead-realtime.gateway", "LeadRealtimeGateway");
const { Prisma } = built("./generated/prisma/client.ts");
const AuditRepository = klass("modules/audit-log/repository/audit-log.repository", "AuditLogRepository");
const AuthController = klass("modules/admin/auth/api/auth.controller", "AuthController");
const AuthService = klass("modules/admin/auth/service/auth.service", "AuthService");
const UsersService = klass("modules/admin/users/service/users.service", "UsersService");
const UsersRepository = klass("modules/admin/users/repository/users.repository", "UsersRepository");
const CookieService = klass("modules/admin/auth/service/cookie.service", "CookieService");
const StudentPortraitService = klass("modules/studentportrait/service/studentportrait.service", "StudentPortraitService");
const AuditService = klass("modules/audit-log/service/audit-log.service", "AuditLogService");
const JwtAuthGuard = klass("modules/admin/auth/rbac/auth.guard", "JwtAuthGuard");
const RolesGuard = klass("modules/admin/auth/rbac/roles.guard", "RolesGuard");
const prisma: PrismaServiceType = new PrismaService();
const access = new Access(prisma);
const jwt = new JwtService();
const secret = randomUUID();
const previousSecret = process.env.JWT_SECRET;
const repo = Object.assign(new DocumentRepository(), { prisma });
const audit = new AuditService(Object.assign(new AuditRepository(), { prisma }));
const journey = { async logEvent() {} };
let uploadCalls = 0;
let uploadHook: (() => Promise<void>) | undefined;
const upload = {
  async uploadFile() {
    uploadCalls++;
    await uploadHook?.();
    return `https://files.example.test/documents/${randomUUID()}`;
  },
};
const service = new DocumentService(repo, upload, audit, journey, access, prisma);
const targetRepo = Object.assign(new TargetRepository(), { prisma });
const targetService = new TargetService(targetRepo, journey, access);
const portraitRepo = Object.assign(new PortraitRepository(), { prisma });
const dashboardRepo = Object.assign(new DashboardRepository(), { prisma });
let app: INestApplication;
let expert: number, otherExpert: number, admin: number, student: number, schoolboy: number, sales: number;
let portrait: number, schoolPortrait: number, target: number, foreignTarget: number;

function http(actor: number, method: "get" | "post" | "patch", path: string) {
  // A forged privileged claim must never override the current role in the database.
  return request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set("Authorization", `Bearer ${jwt.sign({ sub: actor, roleCode: "ADMIN" }, { secret })}`);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}
async function document(status: "DRAFT" | "REVIEW" | "APPROVED" | "NEEDS_REVISION" = "DRAFT", owner = portrait, program?: number) {
  return prisma.document.create({
    data: { title: "Passport", fileUrl: "https://files.example.test/original", documentType: "PASSPORT", status, studentPortraitId: owner, targetProgramId: program },
  });
}
async function newUser(role: string) {
  return prisma.user.create({ data: { firstname: "Test", lastname: role, email: `${randomUUID()}@example.test`, password: "test-only", role: { connect: { code: role } } } });
}
async function multipart(actor: number, program?: number, path = "/documents", method: "post" | "patch" = "post") {
  const req = http(actor, method, path).field("title", "Uploaded passport").field("documentType", "PASSPORT");
  if (program !== undefined) req.field("targetProgramId", String(program));
  return req.attach("file", Buffer.from("test file"), "passport.pdf");
}

before(async () => {
  Logger.overrideLogger(false);
  process.env.JWT_SECRET = secret;
  await prisma.$connect();
  for (const code of ["ADMIN", "EXPERT", "STUDENT", "SCHOOLBOY", "SALES_MANAGER"]) await prisma.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  expert = (await newUser("EXPERT")).id;
  otherExpert = (await newUser("EXPERT")).id;
  admin = (await newUser("ADMIN")).id;
  student = (await newUser("STUDENT")).id;
  schoolboy = (await newUser("SCHOOLBOY")).id;
  sales = (await newUser("SALES_MANAGER")).id;
  // Deliberately make profile IDs different from user IDs.
  const profile = await prisma.consultantProfile.create({ data: { id: 100000 + expert, userId: expert } });
  await prisma.consultantProfile.create({ data: { id: 100000 + otherExpert, userId: otherExpert } });
  portrait = (await prisma.studentPortrait.create({ data: { userId: student, consultantProfileId: profile.id } })).id;
  schoolPortrait = (await prisma.studentPortrait.create({ data: { userId: schoolboy } })).id;
  const country = await prisma.country.create({ data: { isoCode: `D${randomUUID().slice(0, 8)}` } });
  const org = await prisma.organisation.create({ data: { slug: randomUUID(), countryId: country.id } });
  const program = await prisma.program.create({ data: { name: "Test program", degreeLevel: "BACHELOR", organisationId: org.id } });
  const targetData = { programTitle: program.name, intake: "Fall 2026", organisationId: org.id, programId: program.id };
  target = (await prisma.targetProgram.create({ data: { ...targetData, studentPortraitId: portrait } })).id;
  foreignTarget = (await prisma.targetProgram.create({ data: { ...targetData, studentPortraitId: schoolPortrait } })).id;
  await prisma.programRequirement.create({ data: { programId: program.id, type: "PASSPORT", title: "Passport required" } });
  const module = await Test.createTestingModule({
    controllers: [DocumentController, RequirementController, PortraitController, TargetController, DashboardController, ExpertStudentsController, AdminController, AuthController],
    providers: [
      { provide: AuthService, useValue: new AuthService(new UsersService(new UsersRepository(prisma), journey), jwt, {}, new CookieService(), {}, {}) },
      { provide: PrismaService, useValue: prisma },
      { provide: AdminService, useValue: new AdminService(prisma, journey, {}, {}) },
      { provide: FinanceService, useValue: {} },
      { provide: LeadRealtimeGateway, useValue: {} },
      { provide: DocumentService, useValue: service },
      { provide: RequirementService, useValue: new RequirementService(new RequirementRepository(prisma), access) },
      { provide: PortraitService, useValue: new PortraitService(portraitRepo, audit, targetService, access) },
      { provide: TargetService, useValue: targetService },
      { provide: DashboardService, useValue: new DashboardService(dashboardRepo, audit, access) },
      {
        provide: StudentPortraitService,
        useValue: {
          async findMe(id: number) {
            return prisma.studentPortrait.findUniqueOrThrow({ where: { userId: id } });
          },
        },
      },
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
  await app.listen(0, "127.0.0.1");
});
after(async () => {
  await app?.close();
  await prisma.$disconnect();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

for (const [name, actor, owner, expected] of [
  ["STUDENT own", () => student, () => portrait, 200],
  ["SCHOOLBOY own", () => schoolboy, () => schoolPortrait, 200],
  ["STUDENT foreign", () => student, () => schoolPortrait, 403],
  ["SCHOOLBOY foreign", () => schoolboy, () => portrait, 403],
  ["assigned EXPERT", () => expert, () => portrait, 200],
  ["foreign EXPERT", () => otherExpert, () => portrait, 403],
  ["ADMIN", () => admin, () => portrait, 200],
  ["SALES_MANAGER forged ADMIN claim", () => sales, () => portrait, 403],
] as const)
  test(`document read: ${name}`, async () => {
    const doc = await document("DRAFT", owner());
    const res = await http(actor(), "get", `/documents/${doc.id}`).expect(expected);
    if (expected === 200) assert.deepEqual(Object.keys(res.body).sort(), Object.keys(doc).sort());
    else assert.equal(res.body.fileUrl, undefined);
  });
test("document read: inactive consultant", async () => {
  const doc = await document();
  await prisma.consultantProfile.update({ where: { userId: expert }, data: { isActive: false } });
  try {
    await http(expert, "get", `/documents/${doc.id}`).expect(403);
  } finally {
    await prisma.consultantProfile.update({ where: { userId: expert }, data: { isActive: true } });
  }
});
test("document read: disabled user rejected by JWT and domain", async () => {
  const doc = await document();
  await prisma.user.update({ where: { id: student }, data: { deletedAt: new Date() } });
  try {
    await http(student, "get", `/documents/${doc.id}`).expect(401);
    await assert.rejects(service.findById(student, doc.id), (e: any) => e.getStatus() === 403);
  } finally {
    await prisma.user.update({ where: { id: student }, data: { deletedAt: null } });
  }
});
test("document read: missing document", async () => {
  await http(admin, "get", "/documents/2147483647").expect(404);
});
test("document read: missing and invalid JWT", async () => {
  const doc = await document();
  await request(app.getHttpServer()).get(`/api/v1/documents/${doc.id}`).expect(401);
  await request(app.getHttpServer()).get(`/api/v1/documents/${doc.id}`).set("Authorization", "Bearer invalid").expect(401);
});
test("assignment transfer immediately revokes expert access", async () => {
  const doc = await document();
  await prisma.studentPortrait.update({ where: { id: portrait }, data: { consultantProfileId: 100000 + otherExpert } });
  try {
    await http(expert, "get", `/documents/${doc.id}`).expect(403);
    await http(otherExpert, "get", `/documents/${doc.id}`).expect(200);
    await http(expert, "get", `/target-programs/${target}/requirements-status`).expect(403);
  } finally {
    await prisma.studentPortrait.update({ where: { id: portrait }, data: { consultantProfileId: 100000 + expert } });
  }
});
for (const [name, actor, expected] of [
  ["assigned EXPERT", () => expert, 200],
  ["foreign EXPERT", () => otherExpert, 403],
  ["ADMIN", () => admin, 200],
  ["STUDENT", () => student, 403],
  ["SCHOOLBOY", () => schoolboy, 403],
  ["SALES_MANAGER", () => sales, 403],
] as const)
  test(`document review: ${name}`, async () => {
    const doc = await document("REVIEW");
    await http(actor(), "patch", `/documents/${doc.id}/review`).send({ status: "APPROVED", feedback: "Verified" }).expect(expected);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status, expected === 200 ? "APPROVED" : "REVIEW");
    assert.equal(await prisma.auditLog.count({ where: { entityType: "Document", entityId: doc.id, action: "DOCUMENT_REVIEW" } }), expected === 200 ? 1 : 0);
  });
test("review may request revision", async () => {
  const doc = await document("REVIEW");
  const res = await http(expert, "patch", `/documents/${doc.id}/review`).send({ status: "NEEDS_REVISION" }).expect(200);
  assert.equal(res.body.status, "NEEDS_REVISION");
});
test("inactive EXPERT cannot review", async () => {
  const doc = await document("REVIEW");
  await prisma.consultantProfile.update({ where: { userId: expert }, data: { isActive: false } });
  try {
    await http(expert, "patch", `/documents/${doc.id}/review`).send({ status: "APPROVED" }).expect(403);
  } finally {
    await prisma.consultantProfile.update({ where: { userId: expert }, data: { isActive: true } });
  }
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "REVIEW");
});
for (const status of ["DRAFT", "REVIEW", "INVALID", null])
  test(`review rejects outcome ${status}`, async () => {
    const doc = await document("REVIEW");
    await http(expert, "patch", `/documents/${doc.id}/review`).send({ status }).expect(400);
    await assert.rejects(service.review(expert, doc.id, { status }), (e: any) => e.getStatus() === 400);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "REVIEW");
  });
for (const status of ["DRAFT", "APPROVED", "NEEDS_REVISION"] as const)
  test(`review rejects source ${status}`, async () => {
    const doc = await document(status);
    await http(expert, "patch", `/documents/${doc.id}/review`).send({ status: "APPROVED" }).expect(400);
  });
test("review rolls back when audit fails", async () => {
  const doc = await document("REVIEW");
  const original = audit.log;
  audit.log = async () => {
    throw new Error("Injected audit failure");
  };
  try {
    await http(expert, "patch", `/documents/${doc.id}/review`).send({ status: "APPROVED" }).expect(500);
  } finally {
    audit.log = original;
  }
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "REVIEW");
});
test("concurrent reviews cannot both commit", async () => {
  const doc = await document("REVIEW");
  const original = access.assertPortrait.bind(access);
  const ready = deferred();
  let arrived = 0;
  access.assertPortrait = async (...args: any[]) => {
    const result = await original(...args);
    if (args[2] === "review") {
      if (++arrived === 2) ready.resolve();
      await ready.promise;
    }
    return result;
  };
  try {
    const responses = await Promise.all(["APPROVED", "NEEDS_REVISION"].map(status => http(expert, "patch", `/documents/${doc.id}/review`).send({ status })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal(await prisma.auditLog.count({ where: { entityId: doc.id, entityType: "Document" } }), 1);
  } finally {
    access.assertPortrait = original;
    ready.resolve();
  }
});
test("review snapshot cannot approve a concurrently replaced file", async () => {
  const doc = await document("REVIEW");
  const original = access.assertPortrait.bind(access);
  const captured = deferred(),
    release = deferred();
  access.assertPortrait = async (...args: any[]) => {
    const result = await original(...args);
    if (args[2] === "review") {
      captured.resolve();
      await release.promise;
    }
    return result;
  };
  try {
    const reviewing = http(expert, "patch", `/documents/${doc.id}/review`)
      .send({ status: "APPROVED" })
      .then(r => r);
    await captured.promise;
    try {
      assert.equal((await multipart(student, undefined, `/documents/${doc.id}/new-version`, "patch")).status, 200);
    } finally {
      release.resolve();
    }
    assert.equal((await reviewing).status, 409);
    const current = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    assert.equal(current.status, "DRAFT");
    assert.equal(current.version, 2);
  } finally {
    access.assertPortrait = original;
    release.resolve();
  }
});
test("replacement cannot overwrite a review committed during upload", async () => {
  const doc = await document("REVIEW");
  const captured = deferred(),
    release = deferred();
  uploadHook = async () => {
    captured.resolve();
    await release.promise;
  };
  try {
    const replacing = multipart(student, undefined, `/documents/${doc.id}/new-version`, "patch");
    await captured.promise;
    try {
      await http(expert, "patch", `/documents/${doc.id}/review`).send({ status: "APPROVED" }).expect(200);
    } finally {
      release.resolve();
    }
    assert.equal((await replacing).status, 409);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).fileUrl, doc.fileUrl);
  } finally {
    uploadHook = undefined;
    release.resolve();
  }
});
test("concurrent replacements cannot lose a version increment", async () => {
  const doc = await document();
  const ready = deferred();
  let arrived = 0;
  uploadHook = async () => {
    if (++arrived === 2) ready.resolve();
    await ready.promise;
  };
  try {
    const responses = await Promise.all([
      multipart(student, undefined, `/documents/${doc.id}/new-version`, "patch"),
      multipart(student, undefined, `/documents/${doc.id}/new-version`, "patch"),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).version, 2);
  } finally {
    uploadHook = undefined;
    ready.resolve();
  }
});
test("upload accepts own target program", async () => {
  const res = await multipart(student, target);
  assert.equal(res.status, 201);
  assert.equal(res.body.targetProgramId, target);
  assert.equal(res.body.studentPortraitId, portrait);
});
test("upload hides foreign and missing target program identically, before storage", async () => {
  const calls = uploadCalls;
  const foreign = await multipart(student, foreignTarget);
  const missing = await multipart(student, 2147483647);
  assert.equal(foreign.status, 403);
  assert.equal(missing.status, 403);
  assert.deepEqual(foreign.body, missing.body);
  assert.equal(uploadCalls, calls);
});
test("upload accepts no target program and SCHOOLBOY", async () => {
  const res = await multipart(schoolboy);
  assert.equal(res.status, 201);
  assert.equal(res.body.targetProgramId, null);
  assert.equal(res.body.studentPortraitId, schoolPortrait);
});
test("self list, replacement and submit retain successful contracts", async () => {
  const doc = await document();
  const list = await http(student, "get", "/documents/me").expect(200);
  assert(Array.isArray(list.body));
  const replaced = await multipart(student, undefined, `/documents/${doc.id}/new-version`, "patch");
  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.version, 2);
  assert.equal(replaced.body.status, "DRAFT");
  await http(student, "patch", `/documents/${doc.id}/submit-for-review`).expect(200);
  await http(student, "patch", `/documents/${doc.id}/submit-for-review`).expect(400);
});
test("domain boundary rejects client-supplied foreign portrait on upload", async () => {
  const calls = uploadCalls;
  await assert.rejects(service.upload(student, schoolPortrait, {}, { title: "Forged", documentType: "PASSPORT" }), (e: any) => e.getStatus() === 403);
  assert.equal(uploadCalls, calls);
});
for (const [name, actor, expected] of [
  ["owner", () => student, 200],
  ["assigned EXPERT", () => expert, 200],
  ["foreign EXPERT", () => otherExpert, 403],
  ["ADMIN", () => admin, 200],
  ["SALES_MANAGER", () => sales, 403],
  ["foreign SCHOOLBOY", () => schoolboy, 403],
] as const)
  test(`requirements status: ${name}`, async () => {
    const doc = await document("DRAFT", portrait, target);
    const res = await http(actor(), "get", `/target-programs/${target}/requirements-status`).expect(expected);
    if (expected === 200) {
      assert(Array.isArray(res.body));
      assert.equal(res.body[0].documentId, doc.id);
    } else assert.equal(res.body.documentId, undefined);
  });
test("legacy mislinked documents do not leak through requirements or nested programs", async () => {
  const foreign = await document("DRAFT", schoolPortrait, target);
  const requirements = await http(student, "get", `/target-programs/${target}/requirements-status`).expect(200);
  assert.notEqual(requirements.body[0].documentId, foreign.id);
  const program = await http(student, "get", `/target-programs/${target}`).expect(200);
  assert(!program.body.documents.some((d: any) => d.id === foreign.id));
  const full = await http(expert, "get", `/expert/portraits/${portrait}/full`).expect(200);
  assert(!full.body.targetPrograms.find((p: any) => p.id === target).documents.some((d: any) => d.id === foreign.id));
});
test("SCHOOLBOY can read own requirements status", async () => {
  const doc = await document("DRAFT", schoolPortrait, foreignTarget);
  const res = await http(schoolboy, "get", `/target-programs/${foreignTarget}/requirements-status`).expect(200);
  assert.equal(res.body[0].documentId, doc.id);
});
test("current DB role overrides a stale privileged token on all document readers", async () => {
  const doc = await document();
  const salesRole = await prisma.role.findUniqueOrThrow({ where: { code: "SALES_MANAGER" } });
  const studentRole = await prisma.role.findUniqueOrThrow({ where: { code: "STUDENT" } });
  await prisma.user.update({ where: { id: student }, data: { roleId: salesRole.id } });
  try {
    await http(student, "get", `/documents/${doc.id}`).expect(403);
    await http(student, "get", "/documents/me").expect(403);
    await http(student, "get", `/target-programs/${target}`).expect(403);
    await http(student, "get", `/target-programs/${target}/requirements-status`).expect(403);
  } finally {
    await prisma.user.update({ where: { id: student }, data: { roleId: studentRole.id } });
  }
});
test("full profile denies foreign/inactive experts and preserves assigned/admin access", async () => {
  await http(otherExpert, "get", `/expert/portraits/${portrait}/full`).expect(403);
  await http(expert, "get", `/expert/portraits/${portrait}/full`).expect(200);
  await http(admin, "get", `/expert/portraits/${portrait}/full`).expect(200);
  await http(student, "get", `/expert/portraits/${portrait}/full`).expect(403);
  await prisma.consultantProfile.update({ where: { userId: expert }, data: { isActive: false } });
  try {
    await http(expert, "get", `/expert/portraits/${portrait}/full`).expect(403);
    await http(expert, "get", "/expert/dashboard/kanban").expect(403);
    await http(expert, "get", "/expert/dashboard/stale").expect(403);
    await http(expert, "get", `/target-programs/${target}/requirements-status`).expect(403);
  } finally {
    await prisma.consultantProfile.update({ where: { userId: expert }, data: { isActive: true } });
  }
});

test("deleted ADMIN role blocks CRM and direct documents for the same JWT; restoration re-enables both", async () => {
  const doc = await document();
  const token = jwt.sign({ sub: admin, roleCode: "ADMIN" }, { secret });
  const paths = [`/documents/${doc.id}`, `/admin/crm/students/${student}`, `/expert/portraits/${portrait}/full`, `/target-programs/${target}/requirements-status`];
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
  assert.equal((await get(paths[0]).expect(200)).body.fileUrl, doc.fileUrl);
  const crm = await get(paths[1]).expect(200);
  assert(crm.body.detail.portrait.documents.some((d: any) => d.id === doc.id && d.fileUrl === doc.fileUrl));
  await prisma.role.update({ where: { code: "ADMIN" }, data: { deletedAt: new Date() } });
  try {
    for (const path of paths) {
      const res = await get(path).expect(403);
      assert.deepEqual(Object.keys(res.body).sort(), ["error", "message", "statusCode"]);
      assert(!JSON.stringify(res.body).includes(doc.fileUrl));
    }
    await assert.rejects(service.findById(admin, doc.id), (e: any) => e.getStatus() === 403);
  } finally {
    await prisma.role.update({ where: { code: "ADMIN" }, data: { deletedAt: null } });
  }
  await get(paths[0]).expect(200);
  await get(paths[1]).expect(200);
});

for (const [code, actor, ownPortrait, ownTarget, expected] of [
  ["STUDENT", () => student, () => portrait, () => target, 200],
  ["SCHOOLBOY", () => schoolboy, () => schoolPortrait, () => foreignTarget, 200],
  ["EXPERT", () => expert, () => portrait, () => target, 200],
  ["SALES_MANAGER", () => sales, () => portrait, () => target, 403],
] as const)
  test(`deleted ${code} role blocks document aliases and restoration respects current rights`, async () => {
    const doc = await document("DRAFT", ownPortrait());
    const token = jwt.sign({ sub: actor(), roleCode: "ADMIN" }, { secret });
    const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
    const paths = [
      `/documents/${doc.id}`,
      `/target-programs/${ownTarget()}/requirements-status`,
      `/expert/portraits/${ownPortrait()}/full`,
      "/documents/me",
      `/target-programs/${ownTarget()}`,
      "/target-programs/me",
      "/expert/dashboard/kanban",
      "/expert/dashboard/stale",
    ];
    await get(paths[0]).expect(expected);
    await prisma.role.update({ where: { code }, data: { deletedAt: new Date() } });
    try {
      for (const path of paths) {
        const res = await get(path).expect(403);
        assert.deepEqual(Object.keys(res.body).sort(), ["error", "message", "statusCode"]);
      }
    } finally {
      await prisma.role.update({ where: { code }, data: { deletedAt: null } });
    }
    await get(paths[0]).expect(expected);
  });

test("current ADMIN user role and blocking revoke CRM and direct document access for an existing JWT", async () => {
  const doc = await document();
  const token = jwt.sign({ sub: admin, roleCode: "ADMIN" }, { secret });
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  const salesRole = await prisma.role.findUniqueOrThrow({ where: { code: "SALES_MANAGER" } });
  try {
    await prisma.user.update({ where: { id: admin }, data: { roleId: salesRole.id } });
    await get(`/documents/${doc.id}`).expect(403);
    await get(`/admin/crm/students/${student}`).expect(403);
    await prisma.user.update({ where: { id: admin }, data: { roleId: adminRole.id, deletedAt: new Date() } });
    await get(`/documents/${doc.id}`).expect(401);
    await get(`/admin/crm/students/${student}`).expect(401);
  } finally {
    await prisma.user.update({ where: { id: admin }, data: { roleId: adminRole.id, deletedAt: null } });
  }
  await get(`/admin/crm/students/${student}`).expect(200);
});

for (const [code, expected] of [
  ["P2034", 409],
  ["P2003", 500],
] as const)
  test(`audit-stage ${code} rolls back real document and audit writes, responds ${expected}, and never retries`, async () => {
    const doc = await document("REVIEW");
    const original = audit.log;
    let auditCalls = 0,
      createCalls = 0;
    audit.log = async (...args: any[]) => {
      auditCalls++;
      const tx = args[5];
      assert(tx, "Review must supply its transaction client");
      // Execute the real INSERT before fault injection to prove both writes roll back.
      const delegate = new Proxy(tx.auditLog, {
        get(object, key) {
          if (key !== "create") return Reflect.get(object, key);
          return async (data: any) => {
            createCalls++;
            await object.create(data);
            throw new Prisma.PrismaClientKnownRequestError("Injected audit-stage conflict", { code, clientVersion: "test" });
          };
        },
      });
      args[5] = new Proxy(tx, { get: (object, key) => (key === "auditLog" ? delegate : Reflect.get(object, key)) });
      return original.apply(audit, args);
    };
    try {
      await http(expert, "patch", `/documents/${doc.id}/review`).send({ status: "APPROVED", feedback: "Must roll back" }).expect(expected);
    } finally {
      audit.log = original;
    }
    assert.deepEqual(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } }), doc);
    assert.equal(await prisma.auditLog.count({ where: { entityType: "Document", entityId: doc.id } }), 0);
    assert.equal(auditCalls, 1);
    assert.equal(createCalls, 1);
  });

for (const operation of ["assign", "transfer", "comment", "answers"] as const)
  test(`inactive expert cannot ${operation} through the shared dashboard helper`, async () => {
    const beforeAssigned = await prisma.studentPortrait.findUniqueOrThrow({ where: { id: portrait } });
    const beforeAvailable = await prisma.studentPortrait.findUniqueOrThrow({ where: { id: schoolPortrait } });
    const audits = await prisma.auditLog.count();
    await prisma.consultantProfile.update({ where: { userId: expert }, data: { isActive: false } });
    try {
      if (operation === "assign") await http(expert, "patch", `/students/${schoolPortrait}/assign`).expect(403);
      if (operation === "transfer") await http(expert, "patch", `/students/${portrait}/transfer`).send({ newExpertId: otherExpert }).expect(403);
      if (operation === "comment") await http(expert, "post", `/expert/dashboard/stale/${portrait}/comment`).send({ comment: "Test only" }).expect(403);
      if (operation === "answers") await http(expert, "get", `/expert/dashboard/students/${portrait}/tests/1/answers`).expect(403);
    } finally {
      await prisma.consultantProfile.update({ where: { userId: expert }, data: { isActive: true } });
    }
    assert.deepEqual(await prisma.studentPortrait.findUniqueOrThrow({ where: { id: portrait } }), beforeAssigned);
    assert.deepEqual(await prisma.studentPortrait.findUniqueOrThrow({ where: { id: schoolPortrait } }), beforeAvailable);
    assert.equal(await prisma.auditLog.count(), audits);
  });

test("active expert retains assignment, transfer, comment and test-answer behavior", async () => {
  const testRow = await prisma.test.create({ data: { title: "Local remediation test" } });
  const attempt = await prisma.attempt.create({ data: { testId: testRow.id, userId: student } });
  await http(expert, "get", `/expert/dashboard/students/${portrait}/tests/${testRow.id}/answers`)
    .expect(200)
    .then(res => assert.equal(res.body.attempts[0].id, attempt.id));
  await http(expert, "post", `/expert/dashboard/stale/${portrait}/comment`)
    .send({ comment: "Test only" })
    .expect(201)
    .then(res => assert.deepEqual(res.body, { success: true }));
  assert.equal(await prisma.auditLog.count({ where: { action: "STALE_COMMENT", entityId: portrait } }), 1);
  try {
    await http(expert, "patch", `/students/${schoolPortrait}/assign`).expect(200);
    assert.equal((await prisma.studentPortrait.findUniqueOrThrow({ where: { id: schoolPortrait } })).consultantProfileId, 100000 + expert);
    await http(expert, "patch", `/students/${schoolPortrait}/transfer`).send({ newExpertId: otherExpert }).expect(200);
    assert.equal((await prisma.studentPortrait.findUniqueOrThrow({ where: { id: schoolPortrait } })).consultantProfileId, 100000 + otherExpert);
  } finally {
    await prisma.studentPortrait.update({ where: { id: schoolPortrait }, data: { consultantProfileId: null } });
  }
});

test("expert without a profile is denied by shared dashboard operations", async () => {
  const noProfile = await newUser("EXPERT");
  await http(noProfile.id, "patch", `/students/${schoolPortrait}/assign`).expect(403);
  await http(noProfile.id, "patch", `/students/${portrait}/transfer`).send({ newExpertId: otherExpert }).expect(403);
  await http(noProfile.id, "post", `/expert/dashboard/stale/${portrait}/comment`).send({ comment: "Test only" }).expect(403);
  await http(noProfile.id, "get", `/expert/dashboard/students/${portrait}/tests/1/answers`).expect(403);
});

test("document Swagger review metadata reflects actors and denied/conflict outcomes", () => {
  const spec = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Test").setVersion("1").build());
  const review = spec.paths["/api/v1/documents/{id}/review"].patch!;
  assert.match(review.summary!, /expert or admin/i);
  assert(review.responses["403"]);
  assert(review.responses["409"]);
  for (const suffix of ["new-version", "submit-for-review", "review"]) {
    const operation = spec.paths[`/api/v1/documents/{id}/${suffix}`].patch!;
    assert(operation.responses["403"]);
    assert(operation.responses["409"]);
  }
});

for (const [code, actor] of [
  ["ADMIN", () => admin],
  ["EXPERT", () => expert],
  ["STUDENT", () => student],
  ["SCHOOLBOY", () => schoolboy],
  ["SALES_MANAGER", () => sales],
] as const)
  test(`auth me/sign-out use current ${code} role and resume after restoration`, async () => {
    const token = jwt.sign({ sub: actor(), roleCode: "ADMIN" }, { secret });
    const me = () => request(app.getHttpServer()).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    const signOut = () => request(app.getHttpServer()).post("/api/v1/auth/sign-out").set("Authorization", `Bearer ${token}`);
    const active = await me().expect(200);
    assert.equal(active.body.id, actor());
    assert.equal(active.body.password, undefined);
    assert.equal((await signOut().expect(200)).headers["set-cookie"].length, 2);
    await prisma.role.update({ where: { code }, data: { deletedAt: new Date() } });
    try {
      await me().expect(403);
      await signOut().expect(403);
    } finally {
      await prisma.role.update({ where: { code }, data: { deletedAt: null } });
    }
    await me().expect(200);
    await signOut().expect(200);
  });
