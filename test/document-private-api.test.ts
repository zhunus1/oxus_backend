/** Real HTTP + PostgreSQL + MinIO; invoked only by the owning disposable runner. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { request as nodeRequest } from "node:http";
import { before, after, test } from "node:test";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger, ValidationPipe, ServiceUnavailableException } from "@nestjs/common";
import request from "supertest";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const database = new URL(process.env.DATABASE_URL ?? "");
const endpoint = new URL(process.env.MINIO_TEST_ENDPOINT ?? "");
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname.endsWith("_test") && !database.search);
assert(endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1" && endpoint.port && endpoint.pathname === "/" && !endpoint.search);
assert(process.env.MINIO_TEST_ACCESS_KEY?.startsWith("test-") && /^[0-9a-f-]{36}$/.test(process.env.MINIO_TEST_RUN_ID ?? ""));
const built = createRequire(resolve("package.json"));
const klass = (path: string, name: string) => built(`./dist/src/${path}.js`)[name];
const PrismaService = klass("database/prisma.service", "PrismaService");
const Access = klass("common/authorization/student-document-access.service", "StudentDocumentAccessService");
const DocumentService = klass("modules/document/service/document.service", "DocumentService");
const DocumentRepository = klass("modules/document/repository/document.repository", "DocumentRepository");
const DocumentController = klass("modules/document/api/document.controller", "DocumentController");
const Recovery = klass("modules/document/service/document-storage-recovery.service", "DocumentStorageRecoveryService");
const Audit = klass("modules/audit-log/service/audit-log.service", "AuditLogService");
const AuditRepo = klass("modules/audit-log/repository/audit-log.repository", "AuditLogRepository");
const JwtAuthGuard = klass("modules/admin/auth/rbac/auth.guard", "JwtAuthGuard");
const RolesGuard = klass("modules/admin/auth/rbac/roles.guard", "RolesGuard");
const StudentPortraitService = klass("modules/studentportrait/service/studentportrait.service", "StudentPortraitService");
const MinioService = klass("common/utils/minio/minio.service", "MinioService");
const Storage = klass("common/utils/minio/student-document-storage.service", "StudentDocumentStorageService");
const PortraitController = klass("modules/admin/portrait/api/portrait.controller", "PortraitController");
const PortraitService = klass("modules/admin/portrait/service/portrait.service", "PortraitService");
const PortraitRepository = klass("modules/admin/portrait/repository/portrait.repository", "PortraitRepository");
const db = new PrismaService();
const config = {
  AWS_BUCKET_NAME: `api-${process.env.MINIO_TEST_RUN_ID}`,
  AWS_MINIO_ENDPOINT: endpoint.toString(),
  AWS_ACCESS_KEY_ID: process.env.MINIO_TEST_ACCESS_KEY,
  AWS_SECRET_ACCESS_KEY: process.env.MINIO_TEST_SECRET_KEY,
};
const minio = new MinioService(new ConfigService(config));
const storage = new Storage(minio);
const client = minio.getS3Client();
const originalSend = client.send.bind(client);
let storageCalls = 0;
let sendHook: ((command: any, options: any) => Promise<any>) | undefined;
client.send = async (command: any, options: any) => {
  storageCalls++;
  return sendHook ? sendHook(command, options) : originalSend(command, options);
};
const access = new Access(db);
const repo = Object.assign(new DocumentRepository(), { prisma: db });
const audit = new Audit(Object.assign(new AuditRepo(), { prisma: db }));
const recovery = new Recovery(db, audit, storage);
const service = new DocumentService(repo, storage, audit, { async logEvent() {} }, access, db, recovery);
const jwt = new JwtService();
const secret = randomUUID();
const oldSecret = process.env.JWT_SECRET;
let app: any;
let student: number, schoolboy: number, foreignStudent: number, expert: number, foreignExpert: number, admin: number, salesManager: number, otherRole: number;
let portrait: number, foreignPortrait: number, profile: number, otherProfile: number, target: number, foreignTarget: number;
const publicFields = ["id", "title", "fileUrl", "documentType", "version", "status", "feedback", "studentPortraitId", "targetProgramId", "createdAt", "updatedAt"].sort();
const fixture = (name = "blank.pdf") => readFileSync(resolve("test/fixtures/student-documents", name));
const token = (actor: number) => jwt.sign({ sub: actor, roleCode: "ADMIN" }, { secret });
const http = (actor: number, method: "get" | "post" | "patch", path: string) =>
  request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set("Authorization", `Bearer ${token(actor)}`);
const upload = (actor = student, name = "blank.pdf", program?: number) => {
  const req = http(actor, "post", "/documents").field("title", "Synthetic document").field("documentType", "PASSPORT");
  if (program !== undefined) req.field("targetProgramId", String(program));
  return req.attach("file", fixture(name), name);
};
const replace = (id: number) => http(student, "patch", `/documents/${id}/new-version`).attach("file", fixture(), "replacement.pdf");
const binary = (req: any) =>
  req.buffer(true).parse((res: any, done: any) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => done(null, Buffer.concat(chunks)));
    res.on("error", done);
  });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { resolve, promise };
};
const latestIntent = () => db.auditLog.findFirstOrThrow({ where: { action: "DOCUMENT_STORAGE_PENDING" }, orderBy: { id: "desc" } });
const createPrivate = async () => (await upload().expect(201)).body;
const row = (id: number) => db.document.findUniqueOrThrow({ where: { id } });
const legacy = (status = "APPROVED", fileUrl = "https://legacy.example.test/existing") =>
  db.document.create({ data: { title: "Synthetic legacy", documentType: "PASSPORT", studentPortraitId: portrait, fileUrl, status, version: 3, feedback: "Existing feedback" } });

before(async () => {
  Logger.overrideLogger(false);
  process.env.JWT_SECRET = secret;
  await db.$connect();
  for (const code of ["ADMIN", "EXPERT", "STUDENT", "SCHOOLBOY", "SALES_MANAGER", "SUPPORT"]) await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const user = async (code: string) =>
    (await db.user.create({ data: { firstname: "Synthetic", lastname: "Fixture", email: `${randomUUID()}@example.test`, password: "local-only", role: { connect: { code } } } }))
      .id;
  student = await user("STUDENT");
  schoolboy = await user("SCHOOLBOY");
  foreignStudent = await user("STUDENT");
  expert = await user("EXPERT");
  foreignExpert = await user("EXPERT");
  admin = await user("ADMIN");
  salesManager = await user("SALES_MANAGER");
  otherRole = await user("SUPPORT");
  profile = (await db.consultantProfile.create({ data: { id: expert + 10000, userId: expert } })).id;
  otherProfile = (await db.consultantProfile.create({ data: { id: foreignExpert + 10000, userId: foreignExpert } })).id;
  portrait = (await db.studentPortrait.create({ data: { userId: student, consultantProfileId: profile } })).id;
  await db.studentPortrait.create({ data: { userId: schoolboy } });
  foreignPortrait = (await db.studentPortrait.create({ data: { userId: foreignStudent } })).id;
  const country = await db.country.create({ data: { isoCode: `T${randomUUID().slice(0, 8)}` } });
  const organisation = await db.organisation.create({ data: { slug: randomUUID(), countryId: country.id } });
  const program = await db.program.create({ data: { name: "Synthetic program", degreeLevel: "BACHELOR", organisationId: organisation.id } });
  const data = { programTitle: program.name, intake: "2026", organisationId: organisation.id, programId: program.id };
  target = (await db.targetProgram.create({ data: { ...data, studentPortraitId: portrait } })).id;
  foreignTarget = (await db.targetProgram.create({ data: { ...data, studentPortraitId: foreignPortrait } })).id;
  const mod = await Test.createTestingModule({
    controllers: [DocumentController, PortraitController],
    providers: [
      { provide: PortraitService, useValue: new PortraitService(Object.assign(new PortraitRepository(), { prisma: db }), audit, {}, access) },
      { provide: DocumentService, useValue: service },
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
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(new JwtAuthGuard(new Reflector(), jwt, db))
    .overrideGuard(RolesGuard)
    .useValue(new RolesGuard(new Reflector()))
    .compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidUnknownValues: false }));
  app.use((req: any, res: any, next: () => void) => {
    const id = req.headers["x-multipart-observation"];
    if (typeof id === "string")
      res.once("finish", () => {
        multipartObservations.set(
          id,
          Object.values(req.body ?? {}).reduce<number>((n, value) => n + (Array.isArray(value) ? value.length : 1), 0),
        );
      });
    next();
  });
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
  test(`real ${name} private upload, authenticated binary and mandatory audit`, async () => {
    const response = await upload(student, name, target).expect(201);
    assert.deepEqual(Object.keys(response.body).sort(), publicFields);
    const saved = await row(response.body.id);
    assert.match(saved.fileKey, /^documents\/[0-9a-f-]{36}$/);
    assert.equal(saved.fileUrl, `/api/v1/documents/${saved.id}/file`);
    assert.equal(saved.version, 1);
    assert.equal(saved.status, "DRAFT");
    assert.equal(saved.deletedAt, null);
    assert.equal(saved.targetProgramId, target);
    const download = await binary(http(student, "get", `/documents/${saved.id}/file`)).expect(200);
    assert.deepEqual(download.body, fixture(name));
    assert.equal(Number(download.headers["content-length"]), fixture(name).length);
    assert.equal(download.headers["content-type"], name.endsWith("pdf") ? "application/pdf" : name.endsWith("jpg") ? "image/jpeg" : "image/png");
    assert.match(download.headers["content-disposition"], /^attachment; filename="document-\d+\.(pdf|jpg|png)"$/);
    assert.equal(download.headers["cache-control"], "private, no-store");
    assert.equal(download.headers["x-content-type-options"], "nosniff");
    const anonymous = await fetch(new URL(`${config.AWS_BUCKET_NAME}-student-documents/${saved.fileKey}`, endpoint));
    await anonymous.body?.cancel();
    assert.equal(anonymous.status, 403);
    const event = await db.auditLog.findFirstOrThrow({ where: { action: "DOCUMENT_CREATED", entityId: saved.id, entityType: "Document" } });
    assert.equal(event.userId, student);
    assert.equal(event.details.ownerUserId, student);
    assert.equal(event.details.studentPortraitId, portrait);
    assert.equal(event.details.toVersion, 1);
    assert.equal((await latestIntent()).details.state, "COMMITTED");
  });

for (const actorName of ["ADMIN", "EXPERT", "STUDENT", "SCHOOLBOY"])
  test(`${actorName} authorized read and download`, async () => {
    const actor = actorName === "ADMIN" ? admin : actorName === "EXPERT" ? expert : actorName === "SCHOOLBOY" ? schoolboy : student;
    const doc = (await upload(actorName === "SCHOOLBOY" ? schoolboy : student).expect(201)).body;
    assert.deepEqual(Object.keys((await http(actor, "get", `/documents/${doc.id}`).expect(200)).body).sort(), publicFields);
    assert.deepEqual((await binary(http(actor, "get", `/documents/${doc.id}/file`)).expect(200)).body, fixture());
  });

for (const denial of ["no JWT", "foreign expert", "foreign student", "inactive expert", "deleted role", "blocked user", "deleted document"])
  test(`${denial} never reaches S3`, async () => {
    const doc = await createPrivate();
    const calls = storageCalls;
    let actor = student,
      expected = 403;
    if (denial === "foreign expert") actor = foreignExpert;
    if (denial === "foreign student") actor = foreignStudent;
    if (denial === "inactive expert") {
      actor = expert;
      await db.consultantProfile.update({ where: { id: profile }, data: { isActive: false } });
    }
    if (denial === "deleted role") await db.role.update({ where: { code: "STUDENT" }, data: { deletedAt: new Date() } });
    if (denial === "blocked user") {
      expected = 401;
      await db.user.update({ where: { id: student }, data: { deletedAt: new Date() } });
    }
    if (denial === "deleted document") {
      expected = 404;
      await db.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
    }
    try {
      if (denial === "no JWT") await request(app.getHttpServer()).get(`/api/v1/documents/${doc.id}/file`).expect(401);
      else await http(actor, "get", `/documents/${doc.id}/file`).expect(expected);
      assert.equal(storageCalls, calls);
    } finally {
      await db.consultantProfile.update({ where: { id: profile }, data: { isActive: true } });
      await db.role.update({ where: { code: "STUDENT" }, data: { deletedAt: null } });
      await db.user.update({ where: { id: student }, data: { deletedAt: null } });
    }
  });

// Phase 5A: exercise actual multipart interception, DB transactions and real private storage.
const maxBytes = 10 * 1024 * 1024;
const sizedPdf = (size: number) => {
  const buffer = Buffer.alloc(size, 0x20);
  buffer.write("%PDF-1.7\n");
  buffer.write("\n%%EOF\n", size - 7);
  return buffer;
};
const mutationSnapshot = async () => ({
  documents: await db.document.findMany({ orderBy: { id: "asc" } }),
  auditsAndIntents: await db.auditLog.findMany({ orderBy: { id: "asc" } }),
  storageCalls,
});

// Phase 5A.2: small, safe malformed-name fixtures; no destructive parser probes.
for (const route of ["create", "version"] as const)
  for (const fileFirst of [false, true])
    for (const name of ["title[nested]", "title[0]", "title[]", "title[", "title%22suffix"])
      test(`Phase 5A.2 ${route} rejects non-scalar name ${name} ${fileFirst ? "file-first" : "fields-first"}`, async () => {
        const doc = route === "version" ? await createPrivate() : undefined;
        const fields: [string, string][] =
          route === "create"
            ? [
                [name, "small"],
                ["documentType", "PASSPORT"],
              ]
            : [[name, "small"]];
        await assertMultipartRejected(studentMultipart(route, doc?.id, fields, fileFirst), route === "create" ? 3 : 0);
        await http(student, "get", "/documents/me").expect(200);
      });

for (const route of ["create", "version"] as const)
  test(`Phase 5A.2 ${route} missing boundary is 400 before any mutation`, async () => {
    const doc = route === "version" ? await createPrivate() : undefined;
    await assertMultipartRejected(
      http(student, doc ? "patch" : "post", doc ? `/documents/${doc.id}/new-version` : "/documents")
        .set("Content-Type", "multipart/form-data")
        .send("small malformed body"),
      0,
    );
  });

for (const route of ["create", "version"] as const)
  test(`Phase 5A.2 ${route} malformed names without JWT remain 401 before parsing`, async () => {
    const doc = route === "version" ? await createPrivate() : undefined;
    const before = await mutationSnapshot();
    await request(app.getHttpServer())
      [doc ? "patch" : "post"](`/api/v1${doc ? `/documents/${doc.id}/new-version` : "/documents"}`)
      .field("title[nested]", "small")
      .attach("file", fixture(), "small.pdf")
      .expect(401);
    assert.deepEqual(await mutationSnapshot(), before);
  });

test("Phase 5A.2 foreign ownership rejects malformed replacement before parsing", async () => {
  const doc = await createPrivate();
  const before = await mutationSnapshot();
  await http(foreignStudent, "patch", `/documents/${doc.id}/new-version`).field("title[nested]", "small").attach("file", fixture(), "small.pdf").expect(403);
  assert.deepEqual(await mutationSnapshot(), before);
});

// Phase 5A.1: bounded raw multipart admission, before DTO whitelist and private SDK calls.
const multipartObservations = new Map<string, number>();
const studentMultipart = (route: "create" | "version", id: number | undefined, fields: [string, string][], fileFirst = false) => {
  const req = http(student, route === "create" ? "post" : "patch", route === "create" ? "/documents" : `/documents/${id}/new-version`);
  if (fileFirst) req.attach("file", fixture(), "small.pdf");
  for (const [name, value] of fields) req.field(name, value);
  if (!fileFirst) req.attach("file", fixture(), "small.pdf");
  return req;
};
const rawStudentMultipart = (route: "create" | "version", id: number | undefined, fields: [string, string][], bytes: Buffer, skippedParts = 0) => {
  const boundary = `hardening-${randomUUID()}`;
  const parts: Buffer[] = fields.map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="small.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    bytes,
    Buffer.from("\r\n"),
  );
  for (let i = 0; i < skippedParts; i++) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: attachment\r\n\r\nskipped\r\n`));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return http(student, route === "create" ? "post" : "patch", route === "create" ? "/documents" : `/documents/${id}/new-version`)
    .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
    .send(Buffer.concat(parts));
};
const assertMultipartRejected = async (req: any, maxRetainedFields: number) => {
  const before = await mutationSnapshot();
  const observation = randomUUID();
  const response = await req.set("X-Multipart-Observation", observation).expect(400);
  assert.equal(response.body.statusCode, 400);
  assert(!JSON.stringify(response.body).includes(config.AWS_MINIO_ENDPOINT));
  assert.deepEqual(await mutationSnapshot(), before); // full rows + business/technical journal + every SDK call.
  const retained = multipartObservations.get(observation);
  multipartObservations.delete(observation);
  assert(retained !== undefined && retained <= maxRetainedFields);
};

for (const fileFirst of [false, true]) {
  for (const count of [0, 1, 2, 3])
    test(`Phase 5A.1 create ${count} allowed fields ${fileFirst ? "file-first" : "fields-first"}`, async () => {
      const fields: [string, string][] = [
        ["title", "Compatible title"],
        ["documentType", "PASSPORT"],
        ["targetProgramId", String(target)],
      ];
      const req = studentMultipart("create", undefined, fields.slice(0, count), fileFirst);
      if (count < 2) await assertMultipartRejected(req, count);
      else {
        const response = await req.expect(201);
        assert.equal(response.body.title, "Compatible title");
        assert.equal(response.body.targetProgramId, count === 3 ? target : null);
        assert.deepEqual((await binary(http(student, "get", `/documents/${response.body.id}/file`)).expect(200)).body, fixture());
      }
    });

  for (const invalid of [
    "unknown third field",
    "protected field",
    "fourth field",
    "duplicate title",
    "duplicate documentType",
    "duplicate targetProgramId",
    "nested title",
    "array targetProgramId",
  ])
    test(`Phase 5A.1 create rejects ${invalid} ${fileFirst ? "file-first" : "fields-first"} before storage`, async () => {
      const fields: [string, string][] = [
        ["title", "One"],
        ["documentType", "PASSPORT"],
      ];
      if (invalid === "unknown third field") fields.push(["ignored", "previously stripped"]);
      if (invalid === "protected field") fields.push(["fileKey", "never-accepted"]);
      if (invalid === "fourth field") fields.push(["targetProgramId", String(target)], ["extra", "no"]);
      if (invalid === "duplicate title") fields.push(["title", "Two"]);
      if (invalid === "duplicate documentType") fields.push(["documentType", "OTHER"]);
      if (invalid === "duplicate targetProgramId") fields.push(["targetProgramId", String(target)], ["targetProgramId", String(target)]);
      if (invalid === "nested title") fields[0] = ["title[nested]", "One"];
      if (invalid === "array targetProgramId") fields.push(["targetProgramId[]", String(target)]);
      await assertMultipartRejected(studentMultipart("create", undefined, fields, fileFirst), 3);
    });

  for (const name of ["title", "documentType", "targetProgramId", "ignored"])
    test(`Phase 5A.1 version rejects ${name} ${fileFirst ? "file-first" : "fields-first"} before storage`, async () => {
      const doc = await createPrivate();
      await assertMultipartRejected(studentMultipart("version", doc.id, [[name, "previously ignored"]], fileFirst), 0);
    });
}

for (const route of ["create", "version"] as const) {
  test(`Phase 5A.1 ${route} missing file remains 400 with no side effects`, async () => {
    const doc = route === "version" ? await createPrivate() : undefined;
    const req = http(student, doc ? "patch" : "post", doc ? `/documents/${doc.id}/new-version` : "/documents");
    if (!doc) req.field("title", "Missing file").field("documentType", "PASSPORT");
    else req.set("Content-Type", "multipart/form-data; boundary=empty").send("--empty--\r\n");
    await assertMultipartRejected(req, doc ? 0 : 2);
  });

  test(`Phase 5A.1 ${route} counts skipped multipart parts before storage`, async () => {
    const doc = route === "version" ? await createPrivate() : undefined;
    const fields: [string, string][] = doc
      ? []
      : [
          ["title", "Part bound"],
          ["documentType", "PASSPORT"],
        ];
    const req = rawStudentMultipart(route, doc?.id, fields, fixture(), doc ? 1 : 2);
    const before = await mutationSnapshot();
    const response = await req.expect(400);
    assert.equal(response.body.message, "Too many parts");
    assert.deepEqual(await mutationSnapshot(), before);
  });

  for (const shape of ["100000 small fields", "64 half-MiB fields"])
    for (const validFile of [false, true])
      test(`Phase 5A.1 ${route} bounds ${shape} with ${validFile ? "valid" : "invalid"} small file`, async () => {
        const doc = route === "version" ? await createPrivate() : undefined;
        const count = shape.startsWith("100000") ? 100000 : 64;
        const value = "x".repeat(count === 100000 ? 64 : 512 * 1024);
        const fields: [string, string][] = doc
          ? []
          : [
              ["title", "Resource bound"],
              ["documentType", "PASSPORT"],
            ];
        fields.push(...Array.from({ length: count }, (): [string, string] => ["ignored", value]));
        await assertMultipartRejected(rawStudentMultipart(route, doc?.id, fields, validFile ? fixture() : Buffer.from("invalid")), doc ? 0 : 3);
      });
}

for (const bytes of [1024 * 1024 - 1, 1024 * 1024, 1024 * 1024 + 1])
  test(`Phase 5A.1 student title preserves existing fieldSize boundary at ${bytes} bytes`, async () => {
    const req = studentMultipart("create", undefined, [
      ["title", "x".repeat(bytes)],
      ["documentType", "PASSPORT"],
    ]);
    if (bytes >= 1024 * 1024) await assertMultipartRejected(req, 1);
    else {
      const response = await req.expect(201);
      assert.equal(response.body.title.length, bytes);
      assert.equal((await row(response.body.id)).title.length, bytes);
    }
  });

test("Phase 5A.1 four concurrent field-heavy requests retain bounded fields with no side effects", async () => {
  const docs = [await createPrivate(), await createPrivate()];
  const before = await mutationSnapshot();
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const requests = ids.map((id, i) => {
    const route = i < 2 ? "create" : "version";
    const fields: [string, string][] =
      i < 2
        ? [
            ["title", "Concurrent"],
            ["documentType", "PASSPORT"],
          ]
        : [];
    fields.push(...Array.from({ length: 10000 }, (): [string, string] => ["ignored", "x".repeat(64)]));
    return rawStudentMultipart(route, i < 2 ? undefined : docs[i - 2].id, fields, fixture()).set("X-Multipart-Observation", id);
  });
  const responses = await Promise.all(requests);
  assert(responses.every(r => r.status === 400));
  assert.deepEqual(await mutationSnapshot(), before);
  for (let i = 0; i < ids.length; i++) {
    const count = multipartObservations.get(ids[i]);
    multipartObservations.delete(ids[i]);
    assert(count !== undefined && count <= (i < 2 ? 3 : 0));
  }
});

for (const route of ["create", "version"] as const) {
  const setup = async () => {
    const doc = route === "version" ? await createPrivate() : undefined;
    const path = doc ? `/documents/${doc.id}/new-version` : "/documents";
    const method = doc ? "patch" : "post";
    const req = (actor = student) => {
      const result = http(actor, method, path);
      return doc ? result : result.field("title", "Boundary PDF").field("documentType", "PASSPORT");
    };
    return { doc, path, method, req };
  };
  for (const delta of [-1, 0, 1, 2])
    test(`Phase 5A student ${route} MAX${delta < 0 ? delta : `+${delta}`} inclusive HTTP boundary`, async () => {
      const { doc, req } = await setup();
      const oldKey = doc ? (await row(doc.id)).fileKey : undefined;
      const buffer = sizedPdf(maxBytes + delta);
      const before = await mutationSnapshot();
      const response = await req().attach("file", buffer, { filename: "boundary.pdf", contentType: "application/pdf" });
      if (delta > 0) {
        assert.equal(response.status, 413);
        assert.deepEqual(await mutationSnapshot(), before); // includes every intent, audit, row and SDK call (including Delete).
      } else {
        assert.equal(response.status, doc ? 200 : 201);
        assert.deepEqual(Object.keys(response.body).sort(), publicFields);
        const saved = await row(response.body.id);
        assert.equal(saved.version, doc ? doc.version + 1 : 1);
        assert.deepEqual((await binary(http(student, "get", `/documents/${saved.id}/file`)).expect(200)).body, buffer);
        if (oldKey) {
          const old = await originalSend(new GetObjectCommand({ Bucket: `${config.AWS_BUCKET_NAME}-student-documents`, Key: oldKey }));
          assert.deepEqual(Buffer.from(await old.Body.transformToByteArray()), fixture());
        }
        const after = await mutationSnapshot();
        assert.equal(after.documents.length, before.documents.length + (doc ? 0 : 1));
        assert.equal(after.auditsAndIntents.length, before.auditsAndIntents.length + 2);
        const intent = await latestIntent();
        assert.equal(intent.details.state, "COMMITTED");
        assert.equal(intent.details.documentId, saved.id);
      }
    });

  for (const invalid of ["empty", "corrupt PDF", "corrupt JPEG", "corrupt PNG", "MIME mismatch", "multiple files", "extra file field"])
    test(`Phase 5A student ${route} rejects ${invalid} without DB or SDK mutation`, async () => {
      const { req } = await setup();
      const before = await mutationSnapshot();
      const contentType = invalid === "corrupt JPEG" ? "image/jpeg" : invalid === "corrupt PNG" || invalid === "MIME mismatch" ? "image/png" : "application/pdf";
      const buffer = invalid === "empty" ? Buffer.alloc(0) : invalid.startsWith("corrupt") ? Buffer.from("invalid content") : fixture();
      const upload = req().attach("file", buffer, { filename: "invalid.bin", contentType });
      if (invalid === "multiple files") upload.attach("file", fixture(), "second.pdf");
      if (invalid === "extra file field") upload.attach("otherFile", fixture(), "second.pdf");
      await upload.expect(400);
      assert.deepEqual(await mutationSnapshot(), before);
    });

  for (const fields of ["extra", "duplicate"])
    test(`Phase 5A.1 student ${route} ${fields} fields preserve parser error precedence`, async () => {
      const { req } = await setup();
      const before = await mutationSnapshot();
      const upload = req().field("ignored", "one");
      if (fields === "duplicate") upload.field("ignored", "two");
      await upload.attach("file", sizedPdf(maxBytes + 1), "oversized.pdf").expect(route === "version" || fields === "duplicate" ? 400 : 413);
      assert.deepEqual(await mutationSnapshot(), before);
    });

  test(`Phase 5A student ${route} field size bound rejects before storage`, async () => {
    const { req } = await setup();
    const before = await mutationSnapshot();
    await req()
      .field("ignored", "x".repeat(1024 * 1024 + 1))
      .attach("file", fixture(), "small.pdf")
      .expect(400);
    assert.deepEqual(await mutationSnapshot(), before);
  });

  test(`Phase 5A student ${route} no JWT preserves 401 without DB or SDK mutation`, async () => {
    const { path, method } = await setup();
    const before = await mutationSnapshot();
    await request(app.getHttpServer())[method](`/api/v1${path}`).attach("file", fixture(), "small.pdf").expect(401);
    assert.deepEqual(await mutationSnapshot(), before);
  });
}

for (const field of ["title", "documentType", "targetProgramId"])
  test(`Phase 5A student create rejects duplicate ${field} field without mutation`, async () => {
    const before = await mutationSnapshot();
    const req = http(student, "post", "/documents").field("title", "One").field("documentType", "PASSPORT");
    if (field === "targetProgramId") req.field(field, String(target));
    req.field(field, field === "targetProgramId" ? String(target) : "Two");
    await req.attach("file", fixture(), "small.pdf").expect(400);
    assert.deepEqual(await mutationSnapshot(), before);
  });

test("Phase 5A foreign student cannot replace exact-MAX document or use foreign target", async () => {
  const doc = await createPrivate();
  const before = await mutationSnapshot();
  await http(foreignStudent, "patch", `/documents/${doc.id}/new-version`).attach("file", sizedPdf(maxBytes), "max.pdf").expect(403);
  await http(foreignStudent, "post", "/documents")
    .field("title", "Foreign")
    .field("documentType", "PASSPORT")
    .field("targetProgramId", String(target))
    .attach("file", sizedPdf(maxBytes), "max.pdf")
    .expect(403);
  assert.deepEqual(await mutationSnapshot(), before);
});

test("Phase 5A.1 create preserves all three allowed text fields at exact MAX", async () => {
  const buffer = sizedPdf(maxBytes);
  const response = await http(student, "post", "/documents")
    .field("title", "All fields")
    .field("documentType", "PASSPORT")
    .field("targetProgramId", String(target))
    .attach("file", buffer, "max.pdf")
    .expect(201);
  assert.equal(response.body.targetProgramId, target);
  assert(!("ignored" in response.body));
  assert.deepEqual((await binary(http(student, "get", `/documents/${response.body.id}/file`)).expect(200)).body, buffer);
});

test("Phase 5A.1 version preserves file-only upload and inclusive MAX", async () => {
  const doc = await createPrivate();
  const buffer = sizedPdf(maxBytes);
  const result = await http(student, "patch", `/documents/${doc.id}/new-version`).attach("file", buffer, "max.pdf").expect(200);
  assert.deepEqual((await binary(http(student, "get", `/documents/${result.body.id}/file`)).expect(200)).body, buffer);
});

test("Phase 5A four concurrent exact-MAX student uploads preserve bytes and measure aggregate memory", async () => {
  const buffer = sizedPdf(maxBytes);
  const samples: ReturnType<typeof process.memoryUsage>[] = [];
  const baseline = process.memoryUsage();
  const started = performance.now();
  const timer = setInterval(() => samples.push(process.memoryUsage()), 10);
  timer.unref();
  let responses: any[];
  try {
    responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        http(student, "post", "/documents").field("title", "Concurrent boundary").field("documentType", "PASSPORT").attach("file", buffer, "max.pdf"),
      ),
    );
    const uploadDurationMs = performance.now() - started;
    samples.push(process.memoryUsage());
    assert(responses.every(r => r.status === 201));
    assert.equal(new Set(responses.map(r => r.body.id)).size, 4);
    const peakSampled = Object.fromEntries(["rss", "heapUsed", "external", "arrayBuffers"].map(key => [key, Math.max(baseline[key], ...samples.map(s => s[key]))]));
    console.log(
      "STUDENT_UPLOAD_BENCHMARK " +
        JSON.stringify({
          concurrency: 4,
          bytesPerFile: buffer.length,
          savedFiles: responses.length,
          uploadDurationMs,
          baseline,
          peakSampled,
          sampleCount: samples.length,
          mode: "bounded-buffer-upload",
          measurementProcess: "HTTP client+Nest server+Prisma+SDK in one process; not isolated production memory",
        }),
    );
  } finally {
    clearInterval(timer);
  }
  for (const response of responses!) assert.deepEqual((await binary(http(student, "get", `/documents/${response.body.id}/file`)).expect(200)).body, buffer);
});

for (const invalid of ["missing", "empty", "multiple", "oversized", "MIME mismatch", "magic mismatch", "foreign program"])
  test(`HTTP rejects ${invalid} before storage`, async () => {
    const calls = storageCalls;
    const req = http(student, "post", "/documents").field("title", "Synthetic").field("documentType", "PASSPORT");
    if (invalid === "foreign program") req.field("targetProgramId", String(foreignTarget));
    if (invalid !== "missing")
      req.attach(
        "file",
        invalid === "empty"
          ? Buffer.alloc(0)
          : invalid === "oversized"
            ? Buffer.alloc(10 * 1024 * 1024 + 1)
            : invalid === "magic mismatch"
              ? Buffer.from("MZ executable")
              : fixture(),
        { filename: "test.pdf", contentType: invalid === "MIME mismatch" ? "image/png" : "application/pdf" },
      );
    if (invalid === "multiple") req.attach("file", fixture(), "second.pdf");
    await req.expect(invalid === "oversized" ? 413 : invalid === "foreign program" ? 403 : 400);
    assert.equal(storageCalls, calls);
  });

test("ownership guard precedes oversized multipart buffering", async () => {
  const calls = storageCalls;
  await upload(admin).expect(403);
  const doc = await createPrivate();
  await http(foreignStudent, "patch", `/documents/${doc.id}/new-version`)
    .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1), "oversized.pdf")
    .expect(403);
  assert.equal(storageCalls, calls + 4); // normal create: bucket head/policy/ACL + PutObject
});

test("legacy URL remains public data, is never fetched by private endpoint, and rows stay unchanged", async () => {
  for (const status of ["APPROVED", "NEEDS_REVISION"]) {
    const doc = await legacy(status, "http://169.254.169.254/latest/meta-data/");
    const calls = storageCalls;
    assert.equal((await http(student, "get", `/documents/${doc.id}`).expect(200)).body.fileUrl, doc.fileUrl);
    await http(student, "get", `/documents/${doc.id}/file`).expect(404);
    assert.equal(storageCalls, calls);
    assert.deepEqual(await row(doc.id), doc);
  }
});

test("invalid internal key and missing private object fail safely", async () => {
  const doc = await legacy();
  const calls = storageCalls;
  await db.document.update({ where: { id: doc.id }, data: { fileKey: "http://remote.example.test/object" } });
  await http(student, "get", `/documents/${doc.id}/file`).expect(400);
  assert.equal(storageCalls, calls);
  await db.document.update({ where: { id: doc.id }, data: { fileKey: `documents/${randomUUID()}` } });
  await http(student, "get", `/documents/${doc.id}/file`).expect(404);
});

for (const mode of ["private", "legacy"])
  test(`${mode} replacement uses a fresh immutable object, DRAFT/version increment and transaction audit`, async () => {
    const doc = mode === "legacy" ? await legacy() : await row((await createPrivate()).id);
    const oldKey = doc.fileKey;
    const result = await replace(doc.id).expect(200);
    assert.deepEqual(Object.keys(result.body).sort(), publicFields);
    const updated = await row(doc.id);
    assert.notEqual(updated.fileKey, oldKey);
    assert.equal(updated.version, doc.version + 1);
    assert.equal(updated.status, "DRAFT");
    assert.equal(updated.feedback, null);
    assert.equal(updated.studentPortraitId, doc.studentPortraitId);
    assert.equal(updated.targetProgramId, doc.targetProgramId);
    if (oldKey) assert(await storage.privateDocumentExists(oldKey));
    const event = await db.auditLog.findFirstOrThrow({ where: { action: "DOCUMENT_VERSION_UPLOADED", entityId: doc.id } });
    assert.equal(event.details.fromVersion, doc.version);
    assert.equal(event.details.toVersion, updated.version);
    assert.equal(event.userId, student);
  });

test("two concurrent replacements have one CAS winner and preserve old object", async () => {
  const doc = await row((await createPrivate()).id);
  const entered = deferred(),
    release = deferred();
  let count = 0;
  sendHook = async (command, options) => {
    if (command instanceof PutObjectCommand) {
      if (++count === 2) entered.resolve();
      await release.promise;
    }
    return originalSend(command, options);
  };
  try {
    const first = replace(doc.id).then((r: any) => r);
    const second = replace(doc.id).then((r: any) => r);
    await entered.promise;
    release.resolve();
    assert.deepEqual((await Promise.all([first, second])).map(r => r.status).sort(), [200, 409]);
    assert.equal((await row(doc.id)).version, 2);
    assert(await storage.privateDocumentExists(doc.fileKey));
  } finally {
    release.resolve();
    sendHook = undefined;
  }
});

test("review committed during replacement upload wins CAS and preserves approved old bytes", async () => {
  const doc = await row((await createPrivate()).id);
  await db.document.update({ where: { id: doc.id }, data: { status: "REVIEW" } });
  const entered = deferred(),
    release = deferred();
  sendHook = async (command, options) => {
    if (command instanceof PutObjectCommand) {
      entered.resolve();
      await release.promise;
    }
    return originalSend(command, options);
  };
  try {
    const replacing = replace(doc.id).then((r: any) => r);
    await entered.promise;
    await http(expert, "patch", `/documents/${doc.id}/review`).send({ status: "APPROVED" }).expect(200);
    release.resolve();
    assert.equal((await replacing).status, 409);
    assert.equal((await row(doc.id)).status, "APPROVED");
    assert.equal((await row(doc.id)).fileKey, doc.fileKey);
  } finally {
    release.resolve();
    sendHook = undefined;
  }
});

for (const change of ["transfer", "role change", "block", "role delete", "program relink"])
  test(`${change} during upload is rechecked before commit`, async () => {
    const doc = (await upload(student, "blank.pdf", target).expect(201)).body;
    const beforeRow = await row(doc.id);
    const entered = deferred(),
      release = deferred();
    sendHook = async (command, options) => {
      if (command instanceof PutObjectCommand) {
        entered.resolve();
        await release.promise;
      }
      return originalSend(command, options);
    };
    try {
      const replacing = replace(doc.id).then((r: any) => r);
      await entered.promise;
      if (change === "transfer") await db.studentPortrait.update({ where: { id: portrait }, data: { consultantProfileId: otherProfile } });
      if (change === "role change") await db.user.update({ where: { id: student }, data: { role: { connect: { code: "ADMIN" } } } });
      if (change === "block") await db.user.update({ where: { id: student }, data: { deletedAt: new Date() } });
      if (change === "role delete") await db.role.update({ where: { code: "STUDENT" }, data: { deletedAt: new Date() } });
      if (change === "program relink") await db.targetProgram.update({ where: { id: target }, data: { studentPortraitId: foreignPortrait } });
      release.resolve();
      assert.equal((await replacing).status, change === "transfer" ? 409 : 403);
      assert.deepEqual(await row(doc.id), beforeRow);
      const intent = await latestIntent();
      assert.equal(intent.details.state, "CLEANED");
      assert.equal(await storage.privateDocumentExists(intent.details.fileKey), false);
    } finally {
      release.resolve();
      sendHook = undefined;
      await db.studentPortrait.update({ where: { id: portrait }, data: { consultantProfileId: profile } });
      await db.user.update({ where: { id: student }, data: { role: { connect: { code: "STUDENT" } }, deletedAt: null } });
      await db.role.update({ where: { code: "STUDENT" }, data: { deletedAt: null } });
      await db.targetProgram.update({ where: { id: target }, data: { studentPortraitId: portrait } });
    }
  });

for (const table of ["User", "Role", "StudentPortrait", "TargetProgram"])
  test(`mutation holds ${table} locks conflicting with ordinary revocation writers until commit`, async () => {
    const entered = deferred(),
      release = deferred();
    const original = audit.log;
    audit.log = async (...args: any[]) => {
      if (args[1] === "DOCUMENT_CREATED") {
        entered.resolve();
        await release.promise;
      }
      return original.apply(audit, args);
    };
    try {
      const committing = upload(student, "blank.pdf", target).then((response: any) => response);
      await entered.promise;
      const id =
        table === "User" ? student : table === "Role" ? (await db.user.findUniqueOrThrow({ where: { id: student } })).roleId : table === "StudentPortrait" ? portrait : target;
      await assert.rejects(
        db.$transaction((tx: any) => tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR NO KEY UPDATE NOWAIT`, id)),
        (error: any) => error.code === "P2010" && /55P03/.test(error.message),
      );
      release.resolve();
      assert.equal((await committing).status, 201);
    } finally {
      release.resolve();
      audit.log = original;
    }
  });

test("replacement committed after a review snapshot prevents approval of changed bytes", async () => {
  const doc = await row((await createPrivate()).id);
  await db.document.update({ where: { id: doc.id }, data: { status: "REVIEW" } });
  const entered = deferred(),
    release = deferred();
  const original = access.assertPortrait;
  access.assertPortrait = async (...args: any[]) => {
    const result = await original.apply(access, args);
    if (args[2] === "review") {
      entered.resolve();
      await release.promise;
    }
    return result;
  };
  try {
    const reviewing = http(expert, "patch", `/documents/${doc.id}/review`)
      .send({ status: "APPROVED" })
      .then((response: any) => response);
    await entered.promise;
    await replace(doc.id).expect(200);
    release.resolve();
    assert.equal((await reviewing).status, 409);
    assert.equal((await row(doc.id)).status, "DRAFT");
    assert.equal((await row(doc.id)).version, 2);
    assert.equal(await db.auditLog.count({ where: { action: "DOCUMENT_REVIEW", entityId: doc.id } }), 0);
  } finally {
    release.resolve();
    access.assertPortrait = original;
  }
});

for (const failure of ["before PutObject", "lost PutObject acknowledgement"])
  test(`MinIO failure ${failure} never inserts Document or falls back to public storage`, async () => {
    const count = await db.document.count();
    sendHook = async (command, options) => {
      if (command instanceof PutObjectCommand) {
        if (failure === "lost PutObject acknowledgement") await originalSend(command, options);
        throw new Error("secret SDK endpoint");
      }
      return originalSend(command, options);
    };
    try {
      const response = await upload().expect(503);
      assert(!JSON.stringify(response.body).includes("secret"));
      assert.equal(await db.document.count(), count);
      assert.equal((await latestIntent()).details.state, "PENDING");
      assert.equal(await storage.privateDocumentExists((await latestIntent()).details.fileKey), failure === "lost PutObject acknowledgement");
    } finally {
      sendHook = undefined;
    }
  });

test("failed durable intent prevents PutObject and any Document insertion", async () => {
  const log = audit.log;
  const count = await db.document.count();
  let puts = 0;
  audit.log = async (...args: any[]) => {
    if (args[1] === "DOCUMENT_STORAGE_PENDING") throw new Error("intent unavailable");
    return log.apply(audit, args);
  };
  sendHook = async (command, options) => {
    if (command instanceof PutObjectCommand) puts++;
    return originalSend(command, options);
  };
  try {
    await upload().expect(500);
    assert.equal(puts, 0);
    assert.equal(await db.document.count(), count);
  } finally {
    audit.log = log;
    sendHook = undefined;
  }
});

test("recovery state fencing prevents a late Document commit and retains bytes for recovery", async () => {
  const complete = recovery.committed;
  const count = await db.document.count();
  recovery.committed = async (intent: any, documentId: number, tx: any) => {
    await db.auditLog.update({ where: { id: intent.id }, data: { details: { ...intent.details, state: "RECONCILING" } } });
    return complete.call(recovery, intent, documentId, tx);
  };
  try {
    await upload().expect(409);
    const intent = await latestIntent();
    assert.equal(intent.details.state, "RECONCILING");
    assert.equal(await db.document.count(), count);
    assert(await storage.privateDocumentExists(intent.details.fileKey));
  } finally {
    recovery.committed = complete;
  }
});

for (const failure of ["insert", "audit", "replacement audit", "cleanup", "journal finalization"])
  test(`${failure} failure preserves DB state and compensates only the new object`, async () => {
    const doc = failure === "replacement audit" ? await row((await createPrivate()).id) : undefined;
    const count = await db.document.count();
    const create = repo.createPrivate;
    const log = audit.log;
    const remove = storage.deletePrivateDocument;
    const complete = recovery.committed;
    if (failure === "insert")
      repo.createPrivate = async () => {
        throw new Error("database insert failed");
      };
    else if (failure === "journal finalization")
      recovery.committed = async () => {
        throw new Error("journal finalization failed");
      };
    else
      audit.log = async (...args: any[]) => {
        if (args[1] === "DOCUMENT_CREATED" || args[1] === "DOCUMENT_VERSION_UPLOADED") throw new Error("audit failed");
        return log.apply(audit, args);
      };
    if (failure === "cleanup")
      storage.deletePrivateDocument = async () => {
        throw new ServiceUnavailableException("Document storage is unavailable");
      };
    try {
      await (doc ? replace(doc.id) : upload()).expect(500);
      assert.equal(await db.document.count(), count);
      const intent = await latestIntent();
      assert.equal(intent.details.state, failure === "cleanup" ? "ROLLED_BACK" : "CLEANED");
      assert.equal(await storage.privateDocumentExists(intent.details.fileKey), failure === "cleanup");
      assert.equal(
        await db.auditLog.count({
          where: { action: doc ? "DOCUMENT_VERSION_UPLOADED" : "DOCUMENT_CREATED", details: { path: ["operationId"], equals: intent.details.operationId } },
        }),
        0,
      );
      if (doc) {
        assert.deepEqual(await row(doc.id), doc);
        assert(await storage.privateDocumentExists(doc.fileKey));
      }
    } finally {
      repo.createPrivate = create;
      audit.log = log;
      storage.deletePrivateDocument = remove;
      recovery.committed = complete;
    }
  });

for (const outcome of ["lost COMMIT acknowledgement", "connection lost before callback"])
  test(`${outcome} retains bytes and durable intent without guessing rollback`, async () => {
    const transaction = db.$transaction.bind(db);
    db.$transaction = async (...args: any[]) => {
      if (outcome === "lost COMMIT acknowledgement") await transaction(...args);
      throw new Error("connection lost");
    };
    try {
      await upload().expect(500);
      const intent = await latestIntent();
      assert.equal(intent.details.state, outcome === "lost COMMIT acknowledgement" ? "COMMITTED" : "PENDING");
      assert(await storage.privateDocumentExists(intent.details.fileKey));
      assert.equal(await db.document.count({ where: { fileKey: intent.details.fileKey } }), outcome === "lost COMMIT acknowledgement" ? 1 : 0);
    } finally {
      db.$transaction = transaction;
    }
  });

test("referenced object, including archived reference, is never compensated", async () => {
  const doc = await row((await createPrivate()).id);
  const intent = await latestIntent();
  await db.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
  await recovery.compensate({ id: intent.id, details: intent.details }, true);
  assert(await storage.privateDocumentExists(doc.fileKey));
  assert.equal((await db.auditLog.findUniqueOrThrow({ where: { id: intent.id } })).details.state, "COMMITTED");
});

test("process interruption after PutObject leaves a durable recoverable intent and no Document", async () => {
  const script = `
    const { PrismaService } = require('./dist/src/database/prisma.service.js');
    const { MinioService } = require('./dist/src/common/utils/minio/minio.service.js');
    const { StudentDocumentStorageService } = require('./dist/src/common/utils/minio/student-document-storage.service.js');
    const { ConfigService } = require('@nestjs/config');
    const { readFileSync } = require('node:fs');
    (async () => {
      const db = new PrismaService();
      const storage = new StudentDocumentStorageService(new MinioService(new ConfigService(${JSON.stringify(config)})));
      const buffer = readFileSync('test/fixtures/student-documents/blank.pdf');
      await storage.uploadPrivateDocument({buffer,size:buffer.length,mimetype:'application/pdf'}, {
        beforeUpload: async fileKey => { await db.auditLog.create({data:{userId:${student},action:'DOCUMENT_STORAGE_PENDING',entityType:'DocumentStorageIntent',entityId:${portrait},details:{fileKey,state:'PENDING',operationId:'crash-probe',studentPortraitId:${portrait},ownerUserId:${student},documentId:null}}}); }
      });
      process.exit(77);
    })().catch(error => { console.error(error); process.exit(78); });`;
  const child = spawnSync(process.execPath, ["-e", script], {
    env: { PATH: process.env.PATH, DATABASE_URL: database.toString(), DOTENV_CONFIG_PATH: "/dev/null", DOTENV_CONFIG_OVERRIDE: "" },
    timeout: 10000,
  });
  assert.equal(child.status, 77, child.stderr?.toString());
  const intent = await latestIntent();
  assert.equal(intent.details.operationId, "crash-probe");
  assert.equal(intent.entityType, "DocumentStorageIntent");
  assert(await storage.privateDocumentExists(intent.details.fileKey));
  assert.equal(await db.document.count({ where: { fileKey: intent.details.fileKey } }), 0);
});

for (const stage of ["before headers", "after headers"])
  test(`upstream error ${stage} is sanitized and releases stream`, async () => {
    const doc = await createPrivate();
    const original = storage.streamPrivateDocument;
    let started = false;
    const body = new Readable({
      read() {
        if (started) return;
        started = true;
        if (stage === "after headers") {
          this.push(Buffer.from("partial"));
          setImmediate(() => this.destroy(new Error("secret upstream endpoint")));
        } else this.destroy(new Error("secret upstream endpoint"));
      },
    });
    storage.streamPrivateDocument = async () => ({ stream: body, contentType: "application/pdf", size: 100 });
    try {
      if (stage === "before headers") {
        const response = await http(student, "get", `/documents/${doc.id}/file`).expect(503);
        assert.equal(response.body.message, "Document storage is unavailable");
      } else await assert.rejects(binary(http(student, "get", `/documents/${doc.id}/file`)), /aborted|closed|reset/i);
      assert(body.destroyed);
    } finally {
      storage.streamPrivateDocument = original;
    }
  });

test("HTTP client cancellation closes upstream without buffering the full file", async () => {
  const doc = await createPrivate();
  const original = storage.streamPrivateDocument;
  const closed = deferred();
  let produced = 0;
  const body = new Readable({
    read() {
      produced += 1024;
      this.push(Buffer.alloc(1024));
    },
  });
  body.once("close", closed.resolve);
  storage.streamPrivateDocument = async () => ({ stream: body, contentType: "application/pdf", size: 10 * 1024 * 1024 });
  try {
    await new Promise<void>((resolve, reject) => {
      const req = nodeRequest(
        { hostname: "127.0.0.1", port: app.getHttpServer().address().port, path: `/api/v1/documents/${doc.id}/file`, headers: { Authorization: `Bearer ${token(student)}` } },
        res => {
          res.once("data", () => {
            res.destroy();
            req.destroy();
            resolve();
          });
        },
      );
      req.once("error", reject);
      req.end();
    });
    await closed.promise;
    assert(body.destroyed);
    assert(produced < 10 * 1024 * 1024);
  } finally {
    body.destroy();
    await closed.promise;
    storage.streamPrivateDocument = original;
  }
});

test("disconnect while metadata is pending aborts the upstream request", async () => {
  const doc = await createPrivate();
  const original = storage.streamPrivateDocument;
  const entered = deferred(),
    aborted = deferred();
  storage.streamPrivateDocument = async (_key: string, signal: AbortSignal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted.resolve();
          reject(new ServiceUnavailableException("Document storage is unavailable"));
        },
        { once: true },
      );
      entered.resolve();
    });
  try {
    const req = nodeRequest({
      hostname: "127.0.0.1",
      port: app.getHttpServer().address().port,
      path: `/api/v1/documents/${doc.id}/file`,
      headers: { Authorization: `Bearer ${token(student)}` },
    });
    req.on("error", () => {});
    req.end();
    await entered.promise;
    req.destroy();
    await aborted.promise;
  } finally {
    storage.streamPrivateDocument = original;
  }
});

const auditPath = () => `/expert/portraits/${portrait}/audit-log`;
for (const denied of ["foreign student", "foreign schoolboy", "foreign expert", "own student", "own schoolboy", "sales manager", "other role"])
  test(`portrait audit denies ${denied} without trusting forged JWT role`, async () => {
    const actors: Record<string, number> = {
      "foreign student": foreignStudent,
      "foreign schoolboy": schoolboy,
      "foreign expert": foreignExpert,
      "own student": student,
      "own schoolboy": schoolboy,
      "sales manager": salesManager,
      "other role": otherRole,
    };
    const portraitId = denied === "own schoolboy" ? (await db.studentPortrait.findUniqueOrThrow({ where: { userId: schoolboy } })).id : portrait;
    const response = await http(actors[denied], "get", `/expert/portraits/${portraitId}/audit-log`).expect(403);
    assert.deepEqual(response.body, { message: "Document access denied", error: "Forbidden", statusCode: 403 });
  });

test("portrait audit requires JWT", async () => {
  const response = await request(app.getHttpServer()).get(`/api/v1${auditPath()}`).expect(401);
  assert.deepEqual(response.body, { message: "Token not provided", error: "Unauthorized", statusCode: 401 });
});

for (const denial of ["blocked user", "deleted role", "inactive expert"])
  test(`portrait audit rejects ${denial}`, async () => {
    if (denial === "blocked user") await db.user.update({ where: { id: expert }, data: { deletedAt: new Date() } });
    if (denial === "deleted role") await db.role.update({ where: { code: "EXPERT" }, data: { deletedAt: new Date() } });
    if (denial === "inactive expert") await db.consultantProfile.update({ where: { id: profile }, data: { isActive: false } });
    try {
      const response = await http(expert, "get", auditPath()).expect(denial === "blocked user" ? 401 : 403);
      assert.deepEqual(response.body, {
        message: denial === "blocked user" ? "Account is disabled" : denial === "deleted role" ? "Role is disabled" : "Document access denied",
        error: denial === "blocked user" ? "Unauthorized" : "Forbidden",
        statusCode: denial === "blocked user" ? 401 : 403,
      });
    } finally {
      await db.user.update({ where: { id: expert }, data: { deletedAt: null } });
      await db.role.update({ where: { code: "EXPERT" }, data: { deletedAt: null } });
      await db.consultantProfile.update({ where: { id: profile }, data: { isActive: true } });
    }
  });

test("portrait audit follows current assignment with the same JWT", async () => {
  const bearer = token(expert);
  const get = () => request(app.getHttpServer()).get(`/api/v1${auditPath()}`).set("Authorization", `Bearer ${bearer}`);
  await get().expect(200);
  await db.studentPortrait.update({ where: { id: portrait }, data: { consultantProfileId: otherProfile } });
  try {
    const response = await get().expect(403);
    assert.deepEqual(response.body, { message: "Document access denied", error: "Forbidden", statusCode: 403 });
    await http(foreignExpert, "get", auditPath()).expect(200);
  } finally {
    await db.studentPortrait.update({ where: { id: portrait }, data: { consultantProfileId: profile } });
  }
});

for (const actorName of ["ADMIN", "assigned EXPERT"])
  test(`${actorName} gets exact safe business audit without legacy or internal intents`, async () => {
    const actor = actorName === "ADMIN" ? admin : expert;
    await createPrivate();
    const intent = await latestIntent();
    assert.equal(intent.entityType, "DocumentStorageIntent");
    const oldIntent = await db.auditLog.create({
      data: {
        userId: student,
        action: "DOCUMENT_STORAGE_PENDING",
        entityType: "StudentPortrait",
        entityId: portrait,
        details: { ...intent.details, operationId: randomUUID(), state: "PENDING" },
      },
    });
    const event = await db.auditLog.create({
      data: {
        userId: admin,
        action: "SUBSCRIPTION_UPDATE",
        entityType: "StudentPortrait",
        entityId: portrait,
        details: {
          fromSubscription: "FREE",
          toSubscription: "STANDARD",
          fromConsultationBalance: 1,
          toConsultationBalance: 2,
          fileKey: "NEVER-EXPOSE",
          operationId: "NEVER-EXPOSE",
          state: "PENDING",
          futureSensitiveMetadata: { secret: "NEVER-EXPOSE" },
        },
      },
    });
    const before = await db.auditLog.findMany({ where: { id: { in: [event.id, oldIntent.id, intent.id] } } });
    try {
      const response = await http(actor, "get", auditPath()).expect(200);
      const user = await db.user.findUniqueOrThrow({ where: { id: admin } });
      assert.deepEqual(response.body, [
        {
          id: event.id,
          action: "SUBSCRIPTION_UPDATE",
          entityType: "StudentPortrait",
          entityId: portrait,
          details: { fromSubscription: "FREE", toSubscription: "STANDARD", fromConsultationBalance: 1, toConsultationBalance: 2 },
          userId: admin,
          createdAt: event.createdAt.toISOString(),
          user: { id: admin, firstname: user.firstname, lastname: user.lastname },
        },
      ]);
      assert(!JSON.stringify(response.body).includes("NEVER-EXPOSE"));
      assert.deepEqual(await db.auditLog.findMany({ where: { id: { in: [event.id, oldIntent.id, intent.id] } } }), before);
      assert.equal((await db.auditLog.findUniqueOrThrow({ where: { id: oldIntent.id } })).details.state, "PENDING");
    } finally {
      await db.auditLog.delete({ where: { id: event.id } });
    }
  });

test("all audit repository readers exclude technical, unknown and future metadata", async () => {
  const event = await db.auditLog.create({
    data: {
      userId: admin,
      action: "PROCESS_STEP_CHANGE",
      entityType: "StudentPortrait",
      entityId: portrait,
      details: { from: "START", to: "DOCUMENTS", operationId: "NEVER-EXPOSE", fileKey: "NEVER-EXPOSE", unexpected: "NEVER-EXPOSE" },
    },
  });
  const unknown = await db.auditLog.create({
    data: { userId: admin, action: "FUTURE_INTERNAL_ACTION", entityType: "StudentPortrait", entityId: portrait, details: { secret: "NEVER-EXPOSE" } },
  });
  try {
    const generic = await audit.findByEntity("StudentPortrait", portrait);
    const portraitRepo = Object.assign(new PortraitRepository(), { prisma: db });
    assert.deepEqual(await portraitRepo.findAuditLogs("StudentPortrait", portrait), generic);
    assert.equal(generic.length, 1);
    assert.deepEqual(generic[0].details, { from: "START", to: "DOCUMENTS" });
    assert.deepEqual(await audit.findByEntity("DocumentStorageIntent", portrait), []);
    const doc = await createPrivate();
    const documentAudit = await audit.findByEntity("Document", doc.id);
    assert.equal(documentAudit.length, 1);
    assert.deepEqual(documentAudit[0].details, { fromStatus: null, toStatus: "DRAFT", fromVersion: 0, toVersion: 1 });
    assert(!JSON.stringify(documentAudit).includes("fileKey"));
    assert(!JSON.stringify(documentAudit).includes("operationId"));
  } finally {
    await db.auditLog.deleteMany({ where: { id: { in: [event.id, unknown.id] } } });
  }
});

for (const namespace of ["DocumentStorageIntent", "StudentPortrait"])
  test(`recovery retains and cleans identity-bound ${namespace} journal entries`, async () => {
    const file = fixture();
    let intent: any;
    const uploaded = await storage.uploadPrivateDocument(
      { buffer: file, size: file.length, mimetype: "application/pdf" },
      {
        beforeUpload: async (fileKey: string) => {
          intent = await recovery.begin(student, { operationId: randomUUID(), fileKey, studentPortraitId: portrait, ownerUserId: student, documentId: null, state: "PENDING" });
          if (namespace === "StudentPortrait") await db.auditLog.update({ where: { id: intent.id }, data: { entityType: namespace } });
        },
      },
    );
    assert.equal((await db.auditLog.findUniqueOrThrow({ where: { id: intent.id } })).entityType, namespace);
    await recovery.compensate({ ...intent, details: { ...intent.details, operationId: randomUUID() } }, true);
    assert(await storage.privateDocumentExists(uploaded.fileKey));
    assert.equal((await db.auditLog.findUniqueOrThrow({ where: { id: intent.id } })).details.state, "PENDING");
    await recovery.compensate(intent, true);
    assert.equal((await db.auditLog.findUniqueOrThrow({ where: { id: intent.id } })).details.state, "CLEANED");
    assert.equal(await storage.privateDocumentExists(uploaded.fileKey), false);
    assert.deepEqual((await http(admin, "get", auditPath()).expect(200)).body, []);
  });

test("archived reference protects a PENDING new-namespace object", async () => {
  const file = fixture();
  let intent: any;
  const uploaded = await storage.uploadPrivateDocument(
    { buffer: file, size: file.length, mimetype: "application/pdf" },
    {
      beforeUpload: async (fileKey: string) => {
        intent = await recovery.begin(student, { operationId: randomUUID(), fileKey, studentPortraitId: portrait, ownerUserId: student, documentId: null, state: "PENDING" });
      },
    },
  );
  const doc = await legacy();
  await db.document.update({ where: { id: doc.id }, data: { fileKey: uploaded.fileKey, deletedAt: new Date() } });
  await recovery.compensate(intent, true);
  assert(await storage.privateDocumentExists(uploaded.fileKey));
  assert.equal((await db.auditLog.findUniqueOrThrow({ where: { id: intent.id } })).details.state, "PENDING");
});

test("legacy namespace journal finalization remains atomic and private", async () => {
  const begin = recovery.begin;
  recovery.begin = async (...args: any[]) => {
    const intent = await begin.apply(recovery, args);
    await db.auditLog.update({ where: { id: intent.id }, data: { entityType: "StudentPortrait" } });
    return intent;
  };
  try {
    const doc = await createPrivate();
    const intent = await latestIntent();
    assert.equal(intent.entityType, "StudentPortrait");
    assert.equal(intent.details.state, "COMMITTED");
    assert.equal(intent.details.documentId, doc.id);
    assert.deepEqual((await http(admin, "get", auditPath()).expect(200)).body, []);
  } finally {
    recovery.begin = begin;
  }
});
