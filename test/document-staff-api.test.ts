/** Actual Nest HTTP/JWT/RBAC + owning runner's disposable PostgreSQL and private MinIO. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { before, after, test } from "node:test";
import { Test } from "@nestjs/testing";
import { Logger, ValidationPipe } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { Client } from "pg";
import request from "supertest";
import { localTestDatabaseUrl } from "./runner-utils.mjs";

const built = createRequire(resolve("package.json"));
const load = (path: string, name: string) => built(`./dist/src/${path}.js`)[name];
const PrismaService = load("database/prisma.service", "PrismaService");
const Access = load("common/authorization/student-document-access.service", "StudentDocumentAccessService");
const Minio = load("common/utils/minio/minio.service", "MinioService");
const Storage = load("common/utils/minio/student-document-storage.service", "StudentDocumentStorageService");
const Audit = load("modules/audit-log/service/audit-log.service", "AuditLogService");
const AuditRepo = load("modules/audit-log/repository/audit-log.repository", "AuditLogRepository");
const Recovery = load("modules/document/service/document-storage-recovery.service", "DocumentStorageRecoveryService");
const Service = load("modules/document/service/document.service", "DocumentService");
const Repo = load("modules/document/repository/document.repository", "DocumentRepository");
const StaffController = load("modules/document/api/staff-document.controller", "StaffDocumentController");
const StudentController = load("modules/document/api/document.controller", "DocumentController");
const StudentPortraitService = load("modules/studentportrait/service/studentportrait.service", "StudentPortraitService");
const JwtGuard = load("modules/admin/auth/rbac/auth.guard", "JwtAuthGuard");
const RoleGuard = load("modules/admin/auth/rbac/roles.guard", "RolesGuard");
const PortraitController = load("modules/admin/portrait/api/portrait.controller", "PortraitController");
const PortraitService = load("modules/admin/portrait/service/portrait.service", "PortraitService");
const PortraitRepo = load("modules/admin/portrait/repository/portrait.repository", "PortraitRepository");
const { toPublicAudit } = built("./dist/src/common/serialization/public-audit.js");
const database = localTestDatabaseUrl(process.env.DATABASE_URL);
const endpoint = new URL(process.env.MINIO_TEST_ENDPOINT!);
assert.equal(endpoint.hostname, "127.0.0.1");
assert.match(process.env.MINIO_TEST_RUN_ID!, /^[a-f0-9-]{36}$/);
const db = new PrismaService();
const config = {
  AWS_BUCKET_NAME: `staff-${process.env.MINIO_TEST_RUN_ID}`,
  AWS_MINIO_ENDPOINT: endpoint.toString(),
  AWS_ACCESS_KEY_ID: process.env.MINIO_TEST_ACCESS_KEY,
  AWS_SECRET_ACCESS_KEY: process.env.MINIO_TEST_SECRET_KEY,
};
const minio = new Minio(new ConfigService(config));
const storage = new Storage(minio);
const client = minio.getS3Client();
const originalSend = client.send.bind(client);
let sendHook: ((command: any, options: any) => Promise<any>) | undefined;
let calls = 0,
  deletes = 0;
client.send = (command: any, options: any) => {
  calls++;
  if (command instanceof DeleteObjectCommand) deletes++;
  return sendHook ? sendHook(command, options) : originalSend(command, options);
};
const access = new Access(db);
const repo = Object.assign(new Repo(), { prisma: db });
const audit = new Audit(Object.assign(new AuditRepo(), { prisma: db }));
const recovery = new Recovery(db, audit, storage);
const service = new Service(repo, storage, audit, { async logEvent() {} }, access, db, recovery);
const jwt = new JwtService(),
  secret = randomUUID(),
  oldSecret = process.env.JWT_SECRET;
let app: any;
let student: number, schoolboy: number, expert: number, otherExpert: number, admin: number, sales: number, support: number;
let portrait: number, otherPortrait: number, schoolboyPortrait: number, profile: number, otherProfile: number, target: number, foreignTarget: number;
const fields = ["id", "title", "fileUrl", "documentType", "version", "status", "feedback", "studentPortraitId", "targetProgramId", "createdAt", "updatedAt"].sort();
const token = (actor: number) => jwt.sign({ sub: actor, roleCode: "ADMIN" }, { secret });
const base = (pid = portrait) => `/expert/portraits/${pid}/documents`;
const http = (actor: number, method: "get" | "post" | "patch" | "delete", path: string, bearer = token(actor)) =>
  request(app.getHttpServer())[method](`/api/v1${path}`).set("Authorization", `Bearer ${bearer}`);
const fixture = (name = "blank.pdf") => readFileSync(resolve("test/fixtures/student-documents", name));
const snap = (doc: any) => ({ expectedVersion: doc.version, expectedUpdatedAt: new Date(doc.updatedAt).toISOString() });
const row = (id: number) => db.document.findUniqueOrThrow({ where: { id } });
const intent = () => db.auditLog.findFirstOrThrow({ where: { action: "DOCUMENT_STORAGE_PENDING" }, orderBy: { id: "desc" } });
const upload = (actor = expert, pid = portrait, name = "blank.pdf", program?: number) => {
  const req = http(actor, "post", base(pid)).field("title", " Staff document ").field("documentType", "OTHER");
  if (program !== undefined) req.field("targetProgramId", String(program));
  return req.attach("file", fixture(name), name);
};
const create = async () => (await upload().expect(201)).body;
const replace = (doc: any, actor = expert) =>
  http(actor, "patch", `${base(doc.studentPortraitId)}/${doc.id}/new-version`)
    .field("expectedVersion", String(doc.version))
    .field("expectedUpdatedAt", new Date(doc.updatedAt).toISOString())
    .attach("file", fixture(), "replacement.pdf");
const metadata = (doc: any, title = "Edited", actor = expert) => http(actor, "patch", `${base(doc.studentPortraitId)}/${doc.id}`).send({ ...snap(doc), title });
const remove = (doc: any, actor = expert) => http(actor, "delete", `${base(doc.studentPortraitId)}/${doc.id}`).send(snap(doc));
const legacy = (pid = portrait, status = "APPROVED") =>
  db.document.create({
    data: { studentPortraitId: pid, title: "Legacy", documentType: "OTHER", fileUrl: "http://169.254.169.254/latest/meta-data/", status, version: 3, feedback: "Keep feedback" },
  });
const binary = (req: any) =>
  req.buffer(true).parse((res: any, done: any) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => done(null, Buffer.concat(chunks)));
    res.on("error", done);
  });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
};
const waitFor = async (promise: Promise<void>) => {
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Controlled test barrier was not reached")), 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
};
const putBarrier = (count = 1) => {
  const entered = deferred(),
    release = deferred();
  let puts = 0;
  sendHook = async (command, options) => {
    if (command instanceof PutObjectCommand) {
      if (++puts === count) entered.resolve();
      await release.promise;
    }
    return originalSend(command, options);
  };
  return {
    entered,
    release,
    close() {
      release.resolve();
      sendHook = undefined;
    },
  };
};

before(async () => {
  Logger.overrideLogger(false);
  process.env.JWT_SECRET = secret;
  await db.$connect();
  for (const code of ["ADMIN", "EXPERT", "STUDENT", "SCHOOLBOY", "SALES_MANAGER", "SUPPORT"]) await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const user = async (code: string) =>
    (await db.user.create({ data: { firstname: "Synthetic", lastname: "Staff", email: `${randomUUID()}@example.test`, password: "fixture-only", role: { connect: { code } } } }))
      .id;
  student = await user("STUDENT");
  schoolboy = await user("SCHOOLBOY");
  expert = await user("EXPERT");
  otherExpert = await user("EXPERT");
  admin = await user("ADMIN");
  sales = await user("SALES_MANAGER");
  support = await user("SUPPORT");
  profile = (await db.consultantProfile.create({ data: { userId: expert, id: expert + 10000 } })).id;
  otherProfile = (await db.consultantProfile.create({ data: { userId: otherExpert, id: otherExpert + 10000 } })).id;
  portrait = (await db.studentPortrait.create({ data: { id: student + 20000, userId: student, consultantProfileId: profile } })).id;
  schoolboyPortrait = (await db.studentPortrait.create({ data: { id: schoolboy + 20000, userId: schoolboy } })).id;
  const otherStudent = await user("STUDENT");
  otherPortrait = (await db.studentPortrait.create({ data: { id: otherStudent + 20000, userId: otherStudent } })).id;
  const country = await db.country.create({ data: { isoCode: `S${randomUUID().slice(0, 8)}` } });
  const organisation = await db.organisation.create({ data: { slug: randomUUID(), countryId: country.id } });
  const program = await db.program.create({ data: { name: "Synthetic", degreeLevel: "BACHELOR", organisationId: organisation.id } });
  const programData = { programTitle: program.name, intake: "2026", organisationId: organisation.id, programId: program.id };
  target = (await db.targetProgram.create({ data: { ...programData, studentPortraitId: portrait } })).id;
  foreignTarget = (await db.targetProgram.create({ data: { ...programData, studentPortraitId: otherPortrait } })).id;
  const mod = await Test.createTestingModule({
    controllers: [StaffController, StudentController, PortraitController],
    providers: [
      { provide: Service, useValue: service },
      { provide: PrismaService, useValue: db },
      { provide: Access, useValue: access },
      {
        provide: StudentPortraitService,
        useValue: {
          async findMe(id: number) {
            return db.studentPortrait.findUniqueOrThrow({ where: { userId: id } });
          },
        },
      },
      { provide: PortraitService, useValue: new PortraitService(Object.assign(new PortraitRepo(), { prisma: db }), audit, {}, access) },
    ],
  })
    .overrideGuard(JwtGuard)
    .useValue(new JwtGuard(new Reflector(), jwt, db))
    .overrideGuard(RoleGuard)
    .useValue(new RoleGuard(new Reflector()))
    .compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix("api/v1");
  // Match production's weaker global pipe: staff's local forbidden-field policy must still work.
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidUnknownValues: false }));
  await app.listen(0, "127.0.0.1");
});
after(async () => {
  await app?.close();
  await db.$disconnect();
  client.destroy();
  if (oldSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = oldSecret;
});

for (const name of ["blank.pdf", "pixel.jpg", "pixel.png"])
  test(`assigned active EXPERT creates ${name} without student JWT and downloads real private bytes`, async () => {
    const response = await upload(expert, portrait, name, target).expect(201);
    assert.deepEqual(Object.keys(response.body).sort(), fields);
    assert.equal(response.body.title, "Staff document");
    const doc = await row(response.body.id);
    assert.equal(doc.studentPortraitId, portrait);
    assert.equal(doc.targetProgramId, target);
    assert.equal(doc.version, 1);
    assert.equal(doc.status, "DRAFT");
    assert.equal(doc.feedback, null);
    assert.match(doc.fileKey, /^documents\/[a-f0-9-]{36}$/);
    const result = await binary(http(expert, "get", `${base()}/${doc.id}/file`)).expect(200);
    assert.deepEqual(result.body, fixture(name));
    assert.equal(result.headers["cache-control"], "private, no-store");
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    assert.equal(Number(result.headers["content-length"]), fixture(name).length);
    assert.equal(doc.fileUrl, `/api/v1/documents/${doc.id}/file`);
    assert.deepEqual((await binary(http(student, "get", doc.fileUrl.replace("/api/v1", ""))).expect(200)).body, fixture(name));
    const anonymous = await fetch(new URL(`${config.AWS_BUCKET_NAME}-student-documents/${doc.fileKey}`, endpoint));
    await anonymous.body?.cancel();
    assert.equal(anonymous.status, 403);
    const event = await db.auditLog.findFirstOrThrow({ where: { entityType: "Document", entityId: doc.id, action: "DOCUMENT_CREATED" } });
    assert.equal(event.userId, expert);
    assert.equal(event.details.ownerUserId, student);
    assert.equal(event.details.studentPortraitId, portrait);
    const journal = await intent();
    assert.equal(journal.userId, expert);
    assert.equal(journal.entityType, "DocumentStorageIntent");
    assert.equal(journal.details.state, "COMMITTED");
    assert.equal(journal.details.documentId, doc.id);
    assert.equal(journal.details.fileKey, doc.fileKey);
    assert.equal(event.details.operationId, journal.details.operationId);
  });

test("ADMIN can upload for every existing portrait, including unassigned SCHOOLBOY, without own portrait", async () => {
  assert.equal(await db.studentPortrait.count({ where: { userId: admin } }), 0);
  for (const pid of [portrait, otherPortrait, schoolboyPortrait]) {
    const doc = (await upload(admin, pid).expect(201)).body;
    assert.equal(doc.studentPortraitId, pid);
    await http(admin, "get", `${base(pid)}/${doc.id}`).expect(200);
    await http(admin, "get", base(pid)).expect(200);
  }
});

const routes = ["list", "detail", "upload", "download", "version", "metadata", "delete"];
for (const role of ["STUDENT", "SCHOOLBOY", "SALES_MANAGER", "SUPPORT", "foreign EXPERT", "no JWT"])
  for (const route of routes)
    test(`${role} denied staff ${route} even with forged JWT ADMIN roleCode`, async () => {
      const actor = role === "STUDENT" ? student : role === "SCHOOLBOY" ? schoolboy : role === "SALES_MANAGER" ? sales : role === "SUPPORT" ? support : otherExpert;
      const doc = await legacy();
      const beforeCalls = calls;
      const method = route === "upload" ? "post" : ["version", "metadata"].includes(route) ? "patch" : route === "delete" ? "delete" : "get";
      const path = ["list", "upload"].includes(route) ? base() : `${base()}/${doc.id}${route === "download" ? "/file" : route === "version" ? "/new-version" : ""}`;
      const req = role === "no JWT" ? request(app.getHttpServer())[method](`/api/v1${path}`) : http(actor, method, path);
      // Deliberately oversized upload demonstrates guards precede buffering/file validation (403, not 413).
      if (["upload", "version"].includes(route)) req.attach("file", role === "no JWT" ? fixture() : Buffer.alloc(10 * 1024 * 1024 + 1), "oversize.pdf");
      else if (["metadata", "delete"].includes(route)) req.send({ ...snap(doc), ...(route === "metadata" ? { title: "Forbidden" } : {}) });
      const result = await req.expect(role === "no JWT" ? 401 : 403);
      assert.equal(calls, beforeCalls);
      assert.deepEqual(await row(doc.id), doc);
      assert.doesNotMatch(JSON.stringify(result.body), /fileKey|169\.254|operationId/);
    });

for (const denial of ["inactive profile", "blocked user", "deleted role", "role changed", "assignment revoked", "assignment transferred", "profile transferred"])
  test(`same EXPERT JWT loses access after ${denial}`, async () => {
    const bearer = token(expert);
    const doc = await legacy();
    const beforeCalls = calls;
    if (denial === "inactive profile") await db.consultantProfile.update({ where: { id: profile }, data: { isActive: false } });
    if (denial === "blocked user") await db.user.update({ where: { id: expert }, data: { deletedAt: new Date() } });
    if (denial === "deleted role") await db.role.update({ where: { code: "EXPERT" }, data: { deletedAt: new Date() } });
    if (denial === "role changed") await db.user.update({ where: { id: expert }, data: { role: { connect: { code: "STUDENT" } } } });
    if (denial.startsWith("assignment"))
      await db.studentPortrait.update({ where: { id: portrait }, data: { consultantProfileId: denial.endsWith("revoked") ? null : otherProfile } });
    if (denial === "profile transferred") await db.consultantProfile.update({ where: { id: profile }, data: { userId: support } });
    try {
      for (const path of [base(), `${base()}/${doc.id}`, `${base()}/${doc.id}/file`]) await http(expert, "get", path, bearer).expect(denial === "blocked user" ? 401 : 403);
      assert.equal(calls, beforeCalls);
    } finally {
      await db.consultantProfile.update({ where: { id: profile }, data: { isActive: true, userId: expert } });
      await db.studentPortrait.update({ where: { id: portrait }, data: { consultantProfileId: profile } });
      await db.role.update({ where: { code: "EXPERT" }, data: { deletedAt: null } });
      await db.user.update({ where: { id: expert }, data: { deletedAt: null, role: { connect: { code: "EXPERT" } } } });
    }
  });

test("service-level staff mutation/read authorization cannot be bypassed with direct calls", async () => {
  const doc = await legacy();
  const beforeCalls = calls;
  const file = { buffer: fixture(), size: fixture().length, mimetype: "application/pdf" };
  for (const run of [
    () => service.staffList(student, portrait, {}),
    () => service.staffDetail(otherExpert, portrait, doc.id),
    () => service.staffDownload(otherExpert, portrait, doc.id),
    () => service.staffUpload(student, portrait, file, { title: "No", documentType: "OTHER" }),
    () => service.staffNewVersion(otherExpert, portrait, doc.id, file, snap(doc)),
    () => service.staffUpdateMetadata(student, portrait, doc.id, { ...snap(doc), title: "No" }),
    () => service.staffDelete(student, portrait, doc.id, snap(doc)),
  ])
    await assert.rejects(run, (e: any) => e.getStatus() === 403);
  assert.equal(calls, beforeCalls);
  assert.deepEqual(await row(doc.id), doc);
});

test("portrait+document scope prevents IDOR on every id-bearing route including ADMIN", async () => {
  const foreign = await legacy(otherPortrait);
  const beforeCalls = calls;
  for (const actor of [expert, admin]) {
    await http(actor, "get", `${base()}/${foreign.id}`).expect(404);
    await http(actor, "get", `${base()}/${foreign.id}/file`).expect(404);
    await replace({ ...foreign, studentPortraitId: portrait }, actor).expect(404);
    await metadata({ ...foreign, studentPortraitId: portrait }, "No", actor).expect(404);
    await remove({ ...foreign, studentPortraitId: portrait }, actor).expect(404);
  }
  assert.equal(calls, beforeCalls);
  assert.deepEqual(await row(foreign.id), foreign);
});

test("missing portrait never creates StudentPortrait and missing document is safely indistinguishable", async () => {
  const count = await db.studentPortrait.count();
  const beforeCalls = calls;
  await upload(admin, 2147483647).expect(403);
  await http(admin, "get", `${base()}/2147483647`).expect(404);
  assert.equal(await db.studentPortrait.count(), count);
  assert.equal(calls, beforeCalls);
});

for (const input of ["0", "-1", "1.5", "2147483648", "1e2", "not-an-id"])
  test(`staff path rejects malformed DB ID ${input}`, async () => {
    await http(admin, "get", `/expert/portraits/${input}/documents`).expect(400);
    await http(expert, "get", `${base()}/${input}`).expect(400);
  });

for (const query of [
  "limit=0",
  "limit=101",
  "limit=1.5",
  "page=0",
  "page=1.5",
  "page=100002&limit=100",
  "status=INVALID",
  "documentType=INVALID",
  "targetProgramId=0",
  "targetProgramId=2147483648",
  "includeDeleted=true",
  "fileKey=private",
])
  test(`staff list rejects unsafe query ${query}`, async () => {
    await http(expert, "get", `${base()}?${query}`).expect(400);
  });

test("legacy list/detail preserve locator without fetching it or exposing relations/private internals", async () => {
  const doc = await legacy();
  const beforeCalls = calls;
  const result = (await http(expert, "get", `${base()}/${doc.id}`).expect(200)).body;
  assert.deepEqual(Object.keys(result).sort(), fields);
  assert.equal(result.fileUrl, doc.fileUrl);
  await http(expert, "get", `${base()}/${doc.id}/file`).expect(404);
  assert.equal(calls, beforeCalls);
  const listing = (await http(expert, "get", `${base()}?limit=100`).expect(200)).body;
  for (const d of listing.data) {
    assert.deepEqual(Object.keys(d).sort(), fields);
    assert.equal(d.studentPortraitId, portrait);
  }
});

for (const field of ["studentPortraitId", "fileKey", "fileUrl", "status", "version", "feedback", "deletedAt", "documentType", "targetProgramId", "ownerUserId", "recovery"])
  test(`production-style global pipe does not silently strip protected metadata ${field}`, async () => {
    const doc = await legacy();
    await http(expert, "patch", `${base()}/${doc.id}`)
      .send({ ...snap(doc), title: "No", [field]: "private" })
      .expect(400);
    assert.deepEqual(await row(doc.id), doc);
  });

for (const body of [
  {},
  { title: "Valid" },
  { title: null },
  { title: "" },
  { title: "  " },
  { title: "x".repeat(256) },
  { title: "Valid", expectedVersion: 0 },
  { title: "Valid", expectedUpdatedAt: "2026-02-30T00:00:00.000Z" },
])
  test(`metadata rejects invalid title/snapshot ${JSON.stringify(body).slice(0, 80)}`, async () => {
    const doc = await legacy();
    const input = Object.keys(body).length < 2 ? body : { ...snap(doc), ...body };
    await http(expert, "patch", `${base()}/${doc.id}`).send(input).expect(400);
    assert.deepEqual(await row(doc.id), doc);
  });

// F-3-R01: raw transport validation must precede coercion and every side effect.
const rejectNumericRequest = async (req: any, doc: any) => {
  const before = { document: await row(doc.id), documents: await db.document.count(), audits: await db.auditLog.count(), calls };
  const response = await req.expect(400);
  assert.doesNotMatch(JSON.stringify(response.body), /fileKey|operationId|recovery/);
  assert.equal(calls, before.calls);
  assert.equal(await db.document.count(), before.documents);
  assert.equal(await db.auditLog.count(), before.audits);
  assert.deepEqual(await row(doc.id), before.document);
};
for (const expectedVersion of [true, false, "1", null, [], [1], {}, 1.5, 0, -1, 2147483648])
  test(`F-3-R01 JSON metadata/delete reject raw version ${JSON.stringify(expectedVersion)} before mutation`, async () => {
    const doc = await row((await create()).id);
    assert.equal(doc.version, 1); // Reproduce the boolean-to-1 acceptance against matching version/time.
    for (const method of ["patch", "delete"] as const)
      await rejectNumericRequest(
        http(expert, method, `${base()}/${doc.id}`).send({ ...snap(doc), ...(method === "patch" ? { title: "Must not change" } : {}), expectedVersion }),
        doc,
      );
  });

const noncanonicalNumbers = ["0x10", "1e2", " 1", "1 ", "01", "+1", "-1", "1.5", "0", "true", "false", ""];
for (const value of noncanonicalNumbers)
  test(`F-3-R01 query rejects noncanonical number ${JSON.stringify(value)} for every numeric filter`, async () => {
    const doc = await legacy();
    for (const field of ["page", "limit", "targetProgramId"]) await rejectNumericRequest(http(expert, "get", base()).query({ [field]: value }), doc);
  });

for (const value of noncanonicalNumbers)
  test(`F-3-R01 multipart rejects noncanonical version/program ${JSON.stringify(value)} before storage`, async () => {
    const doc = await row((await create()).id);
    await rejectNumericRequest(
      http(expert, "post", base()).field("title", "Must not create").field("documentType", "OTHER").field("targetProgramId", value).attach("file", fixture(), "invalid.pdf"),
      doc,
    );
    await rejectNumericRequest(
      http(expert, "patch", `${base()}/${doc.id}/new-version`)
        .field("expectedVersion", value)
        .field("expectedUpdatedAt", doc.updatedAt.toISOString())
        .attach("file", fixture(), "invalid.pdf"),
      doc,
    );
  });

test("F-3-R01 rejects the exact owned hex/exponent target and matching malformed version reproductions", async () => {
  const doc = await row((await create()).id);
  for (const value of [`0x${target.toString(16)}`, `${target}e0`]) {
    await rejectNumericRequest(http(expert, "get", base()).query({ targetProgramId: value }), doc);
    await rejectNumericRequest(
      http(expert, "post", base()).field("title", "Must not create").field("documentType", "OTHER").field("targetProgramId", value).attach("file", fixture(), "invalid.pdf"),
      doc,
    );
  }
  for (const expectedVersion of ["0x1", "1e0", " 1 "])
    await rejectNumericRequest(
      http(expert, "patch", `${base()}/${doc.id}/new-version`)
        .field("expectedVersion", expectedVersion)
        .field("expectedUpdatedAt", doc.updatedAt.toISOString())
        .attach("file", fixture(), "invalid.pdf"),
      doc,
    );
});

test("F-3-R01 arrays/objects in query cannot reach numeric transformation", async () => {
  const doc = await legacy();
  for (const field of ["page", "limit", "targetProgramId"]) {
    await rejectNumericRequest(http(expert, "get", `${base()}?${field}=1&${field}=1`), doc);
    await rejectNumericRequest(http(expert, "get", `${base()}?${field}%5Bvalue%5D=1`), doc);
  }
});

test("F-3-R01 canonical IDs are required on every staff route", async () => {
  const doc = await row((await create()).id);
  for (const raw of [`0x${portrait.toString(16)}`, `${portrait}e0`, "2147483648", "01", " 1", "+1", "1.5"]) {
    const path = `/expert/portraits/${encodeURIComponent(raw)}/documents`;
    for (const req of [
      http(expert, "get", path),
      http(expert, "get", `${path}/${doc.id}`),
      http(expert, "post", path).field("title", "No").field("documentType", "OTHER").attach("file", fixture(), "x.pdf"),
      http(expert, "get", `${path}/${doc.id}/file`),
      http(expert, "patch", `${path}/${doc.id}/new-version`)
        .field("expectedVersion", "1")
        .field("expectedUpdatedAt", doc.updatedAt.toISOString())
        .attach("file", fixture(), "x.pdf"),
      http(expert, "patch", `${path}/${doc.id}`).send({ ...snap(doc), title: "No" }),
      http(expert, "delete", `${path}/${doc.id}`).send(snap(doc)),
    ])
      await rejectNumericRequest(req, doc);
    const documentPath = `${base()}/${encodeURIComponent(raw)}`;
    for (const req of [
      http(expert, "get", documentPath),
      http(expert, "get", `${documentPath}/file`),
      http(expert, "patch", `${documentPath}/new-version`).field("expectedVersion", "1").field("expectedUpdatedAt", doc.updatedAt.toISOString()).attach("file", fixture(), "x.pdf"),
      http(expert, "patch", documentPath).send({ ...snap(doc), title: "No" }),
      http(expert, "delete", documentPath).send(snap(doc)),
    ])
      await rejectNumericRequest(req, doc);
  }
});

test("F-3-R01 direct staff service entrypoints reject unvalidated numeric primitives", async () => {
  const doc = await row((await create()).id);
  const before = { document: doc, documents: await db.document.count(), audits: await db.auditLog.count(), calls };
  const file = { buffer: fixture(), size: fixture().length, mimetype: "application/pdf" };
  for (const run of [
    () => service.staffUpdateMetadata(expert, portrait, doc.id, { ...snap(doc), title: "No", expectedVersion: true }),
    () => service.staffDelete(expert, portrait, doc.id, { ...snap(doc), expectedVersion: "1" }),
    () => service.staffNewVersion(expert, portrait, doc.id, file, { ...snap(doc), expectedVersion: [1] }),
    () => service.staffUpload(expert, portrait, file, { title: "No", documentType: "OTHER", targetProgramId: `0x${target.toString(16)}` }),
    () => service.staffList(expert, portrait, { page: true }),
    () => service.staffList(expert, portrait, { limit: [1] }),
    () => service.staffList(expert, portrait, { targetProgramId: { value: target } }),
    () => service.staffDetail(expert, true, doc.id),
    () => service.staffDownload(expert, portrait, [doc.id]),
  ])
    await assert.rejects(run, (error: any) => error.getStatus() === 400);
  assert.equal(calls, before.calls);
  assert.equal(await db.document.count(), before.documents);
  assert.equal(await db.auditLog.count(), before.audits);
  assert.deepEqual(await row(doc.id), before.document);
});

test("F-3-R01 valid canonical query/multipart and JSON numbers preserve CAS and archive behavior", async () => {
  const doc = (await upload(expert, portrait, "blank.pdf", target).expect(201)).body;
  const result = (
    await http(expert, "get", base())
      .query({ page: "1", limit: "100", targetProgramId: String(target) })
      .expect(200)
  ).body;
  assert(result.data.some((d: any) => d.id === doc.id));
  const edited = (await metadata(doc, "Valid integer snapshot").expect(200)).body;
  const version = (await replace(edited).expect(200)).body;
  assert.equal(version.version, doc.version + 1);
  await metadata(doc, "Stale still rejected").expect(409);
  await remove(version).expect(200, { deleted: true });
  await remove(version).expect(200, { deleted: true });
  assert.equal(await db.auditLog.count({ where: { entityId: doc.id, action: "DOCUMENT_DELETED" } }), 1);
});

test("title-only preserves approval, feedback, file-version/key/program and emits transactional business audit", async () => {
  const doc = await legacy();
  const beforeCalls = calls;
  const result = await metadata(doc, " New title ").expect(200);
  const current = await row(doc.id);
  assert.equal(current.title, "New title");
  assert.equal(current.status, doc.status);
  assert.equal(current.feedback, doc.feedback);
  assert.equal(current.version, doc.version);
  assert.equal(current.fileKey, doc.fileKey);
  assert.equal(current.targetProgramId, doc.targetProgramId);
  assert(new Date(result.body.updatedAt).getTime() > doc.updatedAt.getTime());
  assert.equal(calls, beforeCalls);
  const event = await db.auditLog.findFirstOrThrow({ where: { entityId: doc.id, action: "DOCUMENT_METADATA_UPDATED" }, include: { user: true } });
  assert.equal(event.userId, expert);
  assert.equal(event.details.ownerUserId, student);
  assert.equal(event.details.documentId, doc.id);
  assert.deepEqual(toPublicAudit(event).details, { fromTitle: "Legacy", toTitle: "New title", fromVersion: 3, toVersion: 3 });
  await metadata(doc, "Stale").expect(409);
});

test("soft-delete CAS/idempotence keeps row/reference/bytes/status and hides every active read/mutation", async () => {
  const original = await row((await create()).id);
  const beforeCalls = calls,
    beforeDeletes = deletes;
  await remove({ ...original, version: original.version + 1 }).expect(409);
  await remove(original).expect(200, { deleted: true });
  const archived = await row(original.id);
  assert(archived.deletedAt);
  assert.equal(archived.fileKey, original.fileKey);
  assert.equal(archived.version, original.version);
  assert.equal(archived.status, original.status);
  assert.equal(archived.feedback, original.feedback);
  await remove(original, admin).expect(200, { deleted: true });
  assert.equal(await db.auditLog.count({ where: { entityId: original.id, action: "DOCUMENT_DELETED" } }), 1);
  assert.equal(calls, beforeCalls);
  assert.equal(deletes, beforeDeletes);
  await http(expert, "get", `${base()}/${original.id}`).expect(404);
  await http(expert, "get", `${base()}/${original.id}/file`).expect(404);
  await http(student, "get", `/documents/${original.id}`).expect(404);
  await http(student, "get", `/documents/${original.id}/file`).expect(404);
  await http(student, "patch", `/documents/${original.id}/submit-for-review`).expect(404);
  await http(expert, "patch", `/documents/${original.id}/review`).send({ status: "APPROVED" }).expect(404);
  await replace(original).expect(404);
  await metadata(original).expect(404);
  for (const path of [base(), "/documents/me"]) {
    const r = (await http(path === base() ? expert : student, "get", path).expect(200)).body;
    assert(!(r.data ?? r).some((d: any) => d.id === original.id));
  }
  const full = (await http(expert, "get", `/expert/portraits/${portrait}/full`).expect(200)).body;
  assert(!full.documents.some((d: any) => d.id === original.id));
  assert(await storage.privateDocumentExists(original.fileKey));
  await db.consultantProfile.update({ where: { id: profile }, data: { isActive: false } });
  try {
    await remove(original).expect(403);
  } finally {
    await db.consultantProfile.update({ where: { id: profile }, data: { isActive: true } });
  }
  assert.equal(await db.auditLog.count({ where: { entityId: original.id, action: "DOCUMENT_DELETED" } }), 1);
});

test("same-millisecond metadata ABA, submit/review and replacement strictly advance updatedAt", async () => {
  const d = await create();
  const timestamp = new Date("2099-01-01T00:00:00.000Z");
  await db.document.update({ where: { id: d.id }, data: { updatedAt: timestamp } });
  const originalNow = Date.now;
  Date.now = () => timestamp.getTime();
  try {
    const a = await row(d.id);
    const b = (await metadata(a, "B").expect(200)).body;
    assert.equal(new Date(b.updatedAt).getTime(), timestamp.getTime() + 1);
    const c = (await metadata(b, a.title).expect(200)).body;
    assert.equal(new Date(c.updatedAt).getTime(), timestamp.getTime() + 2);
    await metadata(a, "Lost").expect(409);
    await remove(a).expect(409);
    const submitted = (await http(student, "patch", `/documents/${d.id}/submit-for-review`).expect(200)).body;
    assert.equal(new Date(submitted.updatedAt).getTime(), timestamp.getTime() + 3);
    const reviewed = (await http(expert, "patch", `/documents/${d.id}/review`).send({ status: "APPROVED" }).expect(200)).body;
    assert.equal(new Date(reviewed.updatedAt).getTime(), timestamp.getTime() + 4);
    const replaced = (await replace(reviewed).expect(200)).body;
    assert.equal(new Date(replaced.updatedAt).getTime(), timestamp.getTime() + 5);
    await metadata(reviewed, "Lost review").expect(409);
  } finally {
    Date.now = originalNow;
  }
});

for (const action of ["metadata", "delete"])
  test(`two concurrent ${action} mutations have one strict CAS winner`, async () => {
    const doc = await legacy();
    const entered = deferred(),
      release = deferred();
    let count = 0;
    const update = repo.updateStaffDocument;
    repo.updateStaffDocument = async (...args: any[]) => {
      if (++count === 2) entered.resolve();
      await release.promise;
      return update.apply(repo, args);
    };
    try {
      const a = (action === "metadata" ? metadata(doc, "A") : remove(doc)).then((r: any) => r);
      const b = (action === "metadata" ? metadata(doc, "B", admin) : remove(doc, admin)).then((r: any) => r);
      await waitFor(entered.promise);
      release.resolve();
      assert.deepEqual((await Promise.all([a, b])).map(r => r.status).sort(), [200, 409]);
      assert.equal(await db.auditLog.count({ where: { entityId: doc.id, action: action === "metadata" ? "DOCUMENT_METADATA_UPDATED" : "DOCUMENT_DELETED" } }), 1);
    } finally {
      release.resolve();
      repo.updateStaffDocument = update;
    }
  });

for (const other of ["staff", "student"])
  test(`staff vs ${other} concurrent replacement has one winner and preserves old bytes`, async () => {
    const doc = await row((await create()).id);
    const barrier = putBarrier(2);
    try {
      const a = replace(doc).then((r: any) => r);
      const b = (other === "staff" ? replace(doc, admin) : http(student, "patch", `/documents/${doc.id}/new-version`).attach("file", fixture(), "student.pdf")).then((r: any) => r);
      await waitFor(barrier.entered.promise);
      barrier.release.resolve();
      assert.deepEqual((await Promise.all([a, b])).map(r => r.status).sort(), [200, 409]);
      const current = await row(doc.id);
      assert.equal(current.version, doc.version + 1);
      assert.notEqual(current.fileKey, doc.fileKey);
      assert.equal(current.status, "DRAFT");
      assert(await storage.privateDocumentExists(doc.fileKey));
      assert.deepEqual((await binary(http(expert, "get", `${base()}/${doc.id}/file`)).expect(200)).body, fixture());
      assert.equal(await db.auditLog.count({ where: { entityId: doc.id, action: "DOCUMENT_VERSION_UPLOADED" } }), 1);
    } finally {
      barrier.close();
    }
  });

for (const winner of ["metadata", "delete", "review"])
  test(`${winner} committed during staff Put prevents stale replacement`, async () => {
    let doc = await row((await create()).id);
    if (winner === "review") doc = await db.document.update({ where: { id: doc.id }, data: { status: "REVIEW" } });
    const barrier = putBarrier();
    try {
      const pending = replace(doc).then((r: any) => r);
      await waitFor(barrier.entered.promise);
      if (winner === "metadata") await metadata(doc, "Won").expect(200);
      if (winner === "delete") await remove(doc).expect(200);
      if (winner === "review") await http(expert, "patch", `/documents/${doc.id}/review`).send({ status: "APPROVED" }).expect(200);
      barrier.release.resolve();
      assert.equal((await pending).status, 409);
      const current = await row(doc.id);
      assert.equal(current.fileKey, doc.fileKey);
      assert.equal(current.version, doc.version);
      assert(await storage.privateDocumentExists(doc.fileKey));
      assert.equal(await db.auditLog.count({ where: { entityId: doc.id, action: "DOCUMENT_VERSION_UPLOADED" } }), 0);
    } finally {
      barrier.close();
    }
  });

test("replacement winning before metadata/delete rejects stale client tokens", async () => {
  const doc = await create();
  await replace(doc).expect(200);
  await metadata(doc).expect(409);
  await remove(doc).expect(409);
});

test("review snapshot cannot approve bytes replaced by staff", async () => {
  const doc = await row((await create()).id);
  await db.document.update({ where: { id: doc.id }, data: { status: "REVIEW" } });
  const original = access.assertPortrait;
  const entered = deferred(),
    release = deferred();
  let held = false;
  access.assertPortrait = async (...args: any[]) => {
    const result = await original.apply(access, args);
    if (args[2] === "review" && !held) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return result;
  };
  try {
    const reviewing = http(expert, "patch", `/documents/${doc.id}/review`)
      .send({ status: "APPROVED" })
      .then((r: any) => r);
    await waitFor(entered.promise);
    await replace(await row(doc.id)).expect(200);
    release.resolve();
    assert.equal((await reviewing).status, 409);
    assert.equal((await row(doc.id)).status, "DRAFT");
    assert.equal(await db.auditLog.count({ where: { entityId: doc.id, action: "DOCUMENT_REVIEW" } }), 0);
  } finally {
    release.resolve();
    access.assertPortrait = original;
  }
});

for (const change of ["assignment transfer", "assignment revoke", "inactive profile", "profile transfer", "role change", "role deleted", "blocked actor", "program transfer"])
  test(`${change} between early authorization and transaction prevents staff COMMIT`, async () => {
    const doc = await row((await upload(expert, portrait, "blank.pdf", target).expect(201)).body.id);
    const barrier = putBarrier();
    try {
      const pending = replace(doc).then((r: any) => r);
      await waitFor(barrier.entered.promise);
      if (change.startsWith("assignment"))
        await db.studentPortrait.update({ where: { id: portrait }, data: { consultantProfileId: change.endsWith("revoke") ? null : otherProfile } });
      if (change === "inactive profile") await db.consultantProfile.update({ where: { id: profile }, data: { isActive: false } });
      if (change === "profile transfer") await db.consultantProfile.update({ where: { id: profile }, data: { userId: support } });
      if (change === "role change") await db.user.update({ where: { id: expert }, data: { role: { connect: { code: "STUDENT" } } } });
      if (change === "role deleted") await db.role.update({ where: { code: "EXPERT" }, data: { deletedAt: new Date() } });
      if (change === "blocked actor") await db.user.update({ where: { id: expert }, data: { deletedAt: new Date() } });
      if (change === "program transfer") await db.targetProgram.update({ where: { id: target }, data: { studentPortraitId: otherPortrait } });
      barrier.release.resolve();
      assert.equal((await pending).status, 403);
      assert.deepEqual(await row(doc.id), doc);
      const journal = await intent();
      assert.equal(journal.details.state, "CLEANED");
      assert.equal(journal.userId, expert);
      assert.equal(journal.details.ownerUserId, student);
      assert.equal(journal.details.documentId, doc.id);
      assert(await storage.privateDocumentExists(doc.fileKey));
    } finally {
      barrier.close();
      await db.consultantProfile.update({ where: { id: profile }, data: { isActive: true, userId: expert } });
      await db.studentPortrait.update({ where: { id: portrait }, data: { consultantProfileId: profile } });
      await db.user.update({ where: { id: expert }, data: { deletedAt: null, role: { connect: { code: "EXPERT" } } } });
      await db.role.update({ where: { code: "EXPERT" }, data: { deletedAt: null } });
      await db.targetProgram.update({ where: { id: target }, data: { studentPortraitId: portrait } });
    }
  });

for (const table of ["User", "Role", "StudentPortrait", "ConsultantProfile", "TargetProgram"])
  test(`staff mutation holds ${table} against ordinary UPDATE revocation until commit`, async () => {
    const original = audit.log;
    const entered = deferred(),
      release = deferred();
    audit.log = async (...args: any[]) => {
      if (args[1] === "DOCUMENT_CREATED") {
        entered.resolve();
        await release.promise;
      }
      return original.apply(audit, args);
    };
    try {
      const pending = upload(expert, portrait, "blank.pdf", target).then((r: any) => r);
      await waitFor(entered.promise);
      const id =
        table === "User"
          ? expert
          : table === "Role"
            ? (await db.user.findUniqueOrThrow({ where: { id: expert } })).roleId
            : table === "StudentPortrait"
              ? portrait
              : table === "ConsultantProfile"
                ? profile
                : target;
      await assert.rejects(
        db.$transaction((tx: any) => tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id=$1 FOR NO KEY UPDATE NOWAIT`, id)),
        (e: any) => e.code === "P2010" && /55P03/.test(e.message),
      );
      release.resolve();
      assert.equal((await pending).status, 201);
    } finally {
      release.resolve();
      audit.log = original;
    }
  });

for (const operation of ["upload", "version", "metadata", "delete"])
  test(`mandatory ${operation} audit failure rolls back Document and preserves old bytes`, async () => {
    const doc = await row((await create()).id),
      count = await db.document.count();
    const original = audit.log;
    audit.log = async (...args: any[]) => {
      if (args[1] === { upload: "DOCUMENT_CREATED", version: "DOCUMENT_VERSION_UPLOADED", metadata: "DOCUMENT_METADATA_UPDATED", delete: "DOCUMENT_DELETED" }[operation])
        throw new Error("synthetic-private-audit-failure");
      return original.apply(audit, args);
    };
    try {
      const pending = operation === "upload" ? upload() : operation === "version" ? replace(doc) : operation === "metadata" ? metadata(doc) : remove(doc);
      const response = await pending.expect(500);
      assert.doesNotMatch(JSON.stringify(response.body), /synthetic-private|fileKey|operationId|postgres/);
      assert.deepEqual(await row(doc.id), doc);
      assert.equal(await db.document.count(), count);
      assert(await storage.privateDocumentExists(doc.fileKey));
      if (["upload", "version"].includes(operation)) {
        const journal = await intent();
        assert.equal(journal.details.state, "CLEANED");
        assert(!(await storage.privateDocumentExists(journal.details.fileKey)));
      }
    } finally {
      audit.log = original;
    }
  });

for (const mode of ["Put failed", "lost Put acknowledgement"])
  test(`${mode} retains PENDING without blind DeleteObject or Document insert`, async () => {
    const count = await db.document.count(),
      beforeDeletes = deletes;
    sendHook = async (command, options) => {
      if (command instanceof PutObjectCommand) {
        if (mode.startsWith("lost")) await originalSend(command, options);
        throw new Error("private SDK detail");
      }
      return originalSend(command, options);
    };
    try {
      const response = await upload().expect(503);
      assert.doesNotMatch(JSON.stringify(response.body), /SDK|fileKey|operationId|credentials/);
      assert.equal(await db.document.count(), count);
      assert.equal(deletes, beforeDeletes);
      const journal = await intent();
      assert.equal(journal.details.state, "PENDING");
      assert.equal(journal.userId, expert);
      assert.equal(await storage.privateDocumentExists(journal.details.fileKey), mode.startsWith("lost"));
    } finally {
      sendHook = undefined;
    }
  });

for (const mode of ["lost COMMIT acknowledgement", "DB unavailable after Put"])
  test(`${mode} keeps referenced/unknown bytes and exact journal identity`, async () => {
    const transaction = db.$transaction.bind(db),
      beforeDeletes = deletes;
    db.$transaction = async (...args: any[]) => {
      if (mode.startsWith("lost")) await transaction(...args);
      throw new Error("private connection detail");
    };
    try {
      await upload().expect(500);
      const journal = await intent();
      assert.equal(journal.details.state, mode.startsWith("lost") ? "COMMITTED" : "PENDING");
      assert.equal(journal.userId, expert);
      assert.equal(journal.details.ownerUserId, student);
      assert.equal(deletes, beforeDeletes);
      assert(await storage.privateDocumentExists(journal.details.fileKey));
      assert.equal(await db.document.count({ where: { fileKey: journal.details.fileKey } }), mode.startsWith("lost") ? 1 : 0);
    } finally {
      db.$transaction = transaction;
    }
  });

test("staff producer crash after real Put preserves durable intent without Document or guessed cleanup", async () => {
  const script = `
    require('reflect-metadata');
    const {PrismaService}=require('./dist/src/database/prisma.service.js');
    const {StudentDocumentAccessService}=require('./dist/src/common/authorization/student-document-access.service.js');
    const {MinioService}=require('./dist/src/common/utils/minio/minio.service.js');
    const {StudentDocumentStorageService}=require('./dist/src/common/utils/minio/student-document-storage.service.js');
    const {DocumentStorageRecoveryService}=require('./dist/src/modules/document/service/document-storage-recovery.service.js');
    const {DocumentService}=require('./dist/src/modules/document/service/document.service.js');
    const {ConfigService}=require('@nestjs/config');
    (async()=>{const db=new PrismaService(); const storage=new StudentDocumentStorageService(new MinioService(new ConfigService(${JSON.stringify(config)})));
      const audit={log:(actor,action,entityType,entityId,details,tx)=>(tx||db).auditLog.create({data:{userId:actor,action,entityType,entityId,details}})};
      const recovery=new DocumentStorageRecoveryService(db,audit,storage);
      const upload=storage.uploadPrivateDocument.bind(storage);storage.uploadPrivateDocument=async(...args)=>{await upload(...args);process.exit(77);};
      const service=new DocumentService({},storage,audit,{},new StudentDocumentAccessService(db),db,recovery);
      const buffer=require('node:fs').readFileSync('test/fixtures/student-documents/blank.pdf');
      await service.staffUpload(${expert},${portrait},{buffer,size:buffer.length,mimetype:'application/pdf'},{title:'Crash',documentType:'OTHER'});
    })().catch(()=>process.exit(78));`;
  const child = spawnSync(process.execPath, ["-e", script], {
    env: { PATH: process.env.PATH, DATABASE_URL: database.toString(), DOTENV_CONFIG_PATH: "/dev/null", DOTENV_CONFIG_OVERRIDE: "" },
    timeout: 15000,
  });
  assert.equal(child.status, 77, child.stderr?.toString());
  const journal = await intent();
  assert.equal(journal.details.state, "PENDING");
  assert.equal(journal.userId, expert);
  assert.match(journal.details.operationId, /^[a-f0-9-]{36}$/);
  assert(await storage.privateDocumentExists(journal.details.fileKey));
  assert.equal(await db.document.count({ where: { fileKey: journal.details.fileKey } }), 0);
});

test("staff business audits are allowlisted; technical intents remain hidden in real public readers", async () => {
  const doc = await create();
  const edited = (await metadata(doc).expect(200)).body;
  await remove(edited).expect(200);
  const logs = (await http(expert, "get", `/expert/portraits/${portrait}/audit-log`).expect(200)).body;
  assert(!logs.some((r: any) => r.action === "DOCUMENT_STORAGE_PENDING" || r.entityType === "DocumentStorageIntent"));
  // This reader returns portrait business logs; document action projection is independently checked against actual rows.
  for (const action of ["DOCUMENT_CREATED", "DOCUMENT_METADATA_UPDATED", "DOCUMENT_DELETED"]) {
    const event = await db.auditLog.findFirstOrThrow({ where: { entityType: "Document", entityId: doc.id, action }, include: { user: true } });
    const out = toPublicAudit(event);
    assert(out);
    assert.equal(out.userId, expert);
    assert.doesNotMatch(JSON.stringify(out), /fileKey|operationId|ownerUserId|deletedAt|recovery/);
  }
});

test("staff Swagger advertises exactly seven routes, strict DTOs and safe binary/public response schemas", () => {
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Staff").addBearerAuth().build());
  const root = "/api/v1/expert/portraits/{portraitId}/documents";
  assert.equal(
    Object.entries(doc.paths)
      .filter(([p]) => p.startsWith(root))
      .reduce((n, [, v]) => n + Object.keys(v).length, 0),
    7,
  );
  for (const [path, method] of [
    [root, "get"],
    [root, "post"],
    [root + "/{documentId}", "get"],
    [root + "/{documentId}", "patch"],
    [root + "/{documentId}", "delete"],
    [root + "/{documentId}/new-version", "patch"],
    [root + "/{documentId}/file", "get"],
  ]) {
    const op = (doc.paths as any)[path][method];
    assert(op.security.some((s: any) => s.bearer));
    for (const status of [400, 401, 403, 404, 409, 500]) assert(op.responses[String(status)]);
  }
  const schema = doc.components!.schemas!.StaffUpdateDocumentDto as any;
  assert.deepEqual(Object.keys(schema.properties).sort(), ["expectedUpdatedAt", "expectedVersion", "title"]);
  assert.deepEqual(schema.required.sort(), ["expectedUpdatedAt", "expectedVersion", "title"]);
  assert(!(doc.components!.schemas!.DocumentEntity as any).properties.fileKey);
  const replacement = (doc.paths[root + "/{documentId}/new-version"] as any).patch.requestBody.content["multipart/form-data"].schema;
  assert.deepEqual(replacement.required.sort(), ["expectedUpdatedAt", "expectedVersion", "file"]);
  for (const mime of ["application/pdf", "image/jpeg", "image/png"])
    assert.equal((doc.paths[root + "/{documentId}/file"] as any).get.responses["200"].content[mime].schema.format, "binary");
});

// Compatibility matrix: student sentinel remediation must preserve both staff upload paths.
for (const route of ["create", "version"])
  for (const delta of [-1, 0, 1, 2])
    test(`Phase 5A staff ${route} MAX${delta < 0 ? delta : `+${delta}`} boundary compatibility`, async () => {
      const doc = route === "version" ? await create() : undefined;
      const before = { documents: await db.document.findMany({ orderBy: { id: "asc" } }), audits: await db.auditLog.findMany({ orderBy: { id: "asc" } }), calls, deletes };
      const buffer = Buffer.alloc(10 * 1024 * 1024 + delta, 0x20);
      buffer.write("%PDF-1.7\n");
      buffer.write("\n%%EOF\n", buffer.length - 7);
      const req = doc
        ? http(expert, "patch", `${base()}/${doc.id}/new-version`).field("expectedVersion", String(doc.version)).field("expectedUpdatedAt", doc.updatedAt)
        : http(expert, "post", base()).field("title", "Boundary").field("documentType", "OTHER").field("targetProgramId", String(target));
      const response = await req.attach("file", buffer, "boundary.pdf");
      if (delta > 0) {
        assert.equal(response.status, 413);
        assert.deepEqual(
          { documents: await db.document.findMany({ orderBy: { id: "asc" } }), audits: await db.auditLog.findMany({ orderBy: { id: "asc" } }), calls, deletes },
          before,
        );
      } else {
        assert.equal(response.status, doc ? 200 : 201);
        assert.deepEqual((await binary(http(expert, "get", `${base()}/${response.body.id}/file`)).expect(200)).body, buffer);
      }
    });

for (const invalid of ["missing", "empty", "oversized", "multiple", "magic mismatch", "MIME mismatch", "foreign target"])
  test(`staff upload rejects ${invalid} before any storage request`, async () => {
    const beforeCalls = calls;
    const req = http(expert, "post", base()).field("title", "Valid").field("documentType", "OTHER");
    if (invalid === "foreign target") req.field("targetProgramId", String(foreignTarget));
    if (invalid !== "missing")
      req.attach(
        "file",
        invalid === "empty" ? Buffer.alloc(0) : invalid === "oversized" ? Buffer.alloc(10 * 1024 * 1024 + 1) : invalid === "magic mismatch" ? Buffer.from("MZ invalid") : fixture(),
        { filename: "doc.pdf", contentType: invalid === "MIME mismatch" ? "image/png" : "application/pdf" },
      );
    if (invalid === "multiple") req.attach("file", fixture(), "extra.pdf");
    await req.expect(invalid === "oversized" ? 413 : invalid === "foreign target" ? 403 : 400);
    assert.equal(calls, beforeCalls);
  });

test("target-program filter validates portrait ownership without foreign relation disclosure", async () => {
  await http(expert, "get", `${base()}?targetProgramId=${foreignTarget}`).expect(403);
  await http(expert, "get", `${base()}?targetProgramId=2147483647`).expect(403);
  const doc = (await upload(expert, portrait, "blank.pdf", target).expect(201)).body;
  const result = (await http(expert, "get", `${base()}?targetProgramId=${target}&documentType=OTHER&status=DRAFT&limit=100`).expect(200)).body;
  assert(result.data.some((d: any) => d.id === doc.id));
  for (const d of result.data) {
    assert.equal(d.targetProgramId, target);
    assert.equal(d.status, "DRAFT");
    assert.deepEqual(Object.keys(d).sort(), fields);
  }
});

test("list 50/100/500 rows has stable bounded pagination, constant SQL count and no N+1", async () => {
  const owner = await db.user.create({
    data: { firstname: "Synthetic", lastname: "Benchmark", email: `${randomUUID()}@example.test`, password: "fixture-only", role: { connect: { code: "STUDENT" } } },
  });
  const pid = (await db.studentPortrait.create({ data: { userId: owner.id, consultantProfileId: profile } })).id;
  const original = Reflect.get(Client.prototype, "query");
  let measured = false;
  let queries: { text: string; values: any[] }[] = [];
  Client.prototype.query = function (this: Client, ...args: any[]) {
    if (measured) queries.push({ text: typeof args[0] === "string" ? args[0] : args[0].text, values: typeof args[0] === "string" ? (args[1] ?? []) : (args[0].values ?? []) });
    return original.apply(this, args as any);
  } as any;
  const results: any[] = [];
  const diagnostic = new Client({ connectionString: database.toString() });
  await diagnostic.connect();
  try {
    for (const size of [50, 100, 500]) {
      await db.document.deleteMany({ where: { studentPortraitId: pid } });
      const timestamp = new Date("2026-01-01T00:00:00.000Z");
      await db.document.createMany({
        data: Array.from({ length: size }, (_, i) => ({
          title: `Synthetic ${i}`,
          documentType: "OTHER",
          fileUrl: "/synthetic",
          studentPortraitId: pid,
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      });
      queries = [];
      const start = performance.now();
      measured = true;
      const result = (await http(expert, "get", `${base(pid)}?limit=100`).expect(200)).body;
      measured = false;
      const durationMs = performance.now() - start;
      assert.equal(result.total, size);
      assert.equal(result.data.length, Math.min(size, 100));
      assert.equal(result.totalPages, Math.ceil(size / 100));
      const dataReads = queries.filter(q => q.text.startsWith("SELECT"));
      const documentReads = dataReads.filter(q => q.text.includes('"Document"'));
      assert.equal(documentReads.length, 2); // count and bounded select, no per-document queries.
      const listing = documentReads.find(q => !q.text.includes("COUNT("))!;
      const plan = (await diagnostic.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + listing.text, listing.values)).rows[0]["QUERY PLAN"][0];
      const ids: number[] = [];
      for (let page = 1; page <= result.totalPages; page++)
        ids.push(...(await http(expert, "get", `${base(pid)}?limit=100&page=${page}`).expect(200)).body.data.map((d: any) => d.id));
      assert.equal(new Set(ids).size, size);
      assert.deepEqual(
        ids,
        [...ids].sort((a, b) => b - a),
      );
      results.push({
        rows: size,
        limit: 100,
        dataSelectCount: dataReads.length,
        documentSelectCount: documentReads.length,
        durationMs,
        planExecutionMs: plan["Execution Time"],
        plan: plan.Plan,
      });
    }
    assert(results.every(r => r.dataSelectCount === results[0].dataSelectCount));
    console.log("STAFF_LIST_BENCHMARK " + JSON.stringify(results));
  } finally {
    measured = false;
    Client.prototype.query = original;
    await diagnostic.end();
  }
});

test("four maximum bounded multipart uploads measure aggregate memory and short post-Put transactions", async () => {
  const buffer = Buffer.alloc(10 * 1024 * 1024, 0x20);
  buffer.write("%PDF-1.7\n", 0, "ascii");
  buffer.write("\n%%EOF\n", buffer.length - 7, "ascii");
  const count = 4,
    barrier = putBarrier(count),
    samples: ReturnType<typeof process.memoryUsage>[] = [];
  const baseline = process.memoryUsage();
  const timer = setInterval(() => samples.push(process.memoryUsage()), 10);
  timer.unref();
  const transaction = db.$transaction.bind(db);
  const transactionMs: number[] = [];
  db.$transaction = async (...args: any[]) => {
    const start = performance.now();
    try {
      return await transaction(...args);
    } finally {
      transactionMs.push(performance.now() - start);
    }
  };
  const start = performance.now();
  try {
    const pending = Array.from({ length: count }, () =>
      http(expert, "post", base())
        .field("title", "Maximum synthetic PDF")
        .field("documentType", "OTHER")
        .attach("file", buffer, { filename: "max.pdf", contentType: "application/pdf" })
        .then((r: any) => r),
    );
    await waitFor(barrier.entered.promise);
    const atPutBarrier = process.memoryUsage();
    barrier.release.resolve();
    const responses = await Promise.all(pending);
    assert(responses.every(r => r.status === 201));
    assert.equal(transactionMs.length, count);
    const peak = {
      rss: Math.max(baseline.rss, atPutBarrier.rss, ...samples.map(s => s.rss)),
      heapUsed: Math.max(baseline.heapUsed, atPutBarrier.heapUsed, ...samples.map(s => s.heapUsed)),
      external: Math.max(baseline.external, atPutBarrier.external, ...samples.map(s => s.external)),
      arrayBuffers: Math.max(baseline.arrayBuffers, atPutBarrier.arrayBuffers, ...samples.map(s => s.arrayBuffers)),
    };
    const result = await binary(http(expert, "get", `${base()}/${responses[0].body.id}/file`)).expect(200);
    assert.deepEqual(result.body, buffer);
    console.log(
      "STAFF_UPLOAD_BENCHMARK " +
        JSON.stringify({
          concurrency: count,
          bytesPerFile: buffer.length,
          mode: "bounded-buffer-upload",
          durationMs: performance.now() - start,
          transactionMs,
          baseline,
          atPutBarrier,
          peakSampled: peak,
          sampleCount: samples.length,
          measurementProcess: "HTTP client+Nest server+Prisma+SDK in one process; not isolated server RSS",
        }),
    );
  } finally {
    clearInterval(timer);
    barrier.close();
    db.$transaction = transaction;
  }
});
