/** Generates the complete document from built production controllers, without external I/O. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { before, after, test } from "node:test";
import { Test } from "@nestjs/testing";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

const built = createRequire(resolve("package.json"));
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
let app: any, doc: any;
const operation = (path: string, method = "get") => doc.paths[`/api/v1${path}`][method];
const schema = (path: string, method = "get", status = "200") => operation(path, method).responses[status].content["application/json"].schema;
before(async () => {
  const controllers = files(resolve("dist/src"))
    .filter(f => f.endsWith(".controller.js"))
    .flatMap(f => Object.values(built(f)).filter((c: any) => typeof c === "function" && Reflect.hasMetadata("path", c))) as any[];
  const mod = await Test.createTestingModule({ controllers })
    .useMocker(() => ({}))
    .compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix("api/v1");
  doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Oxus Edu API").setVersion("1.0").addBearerAuth({ name: "Bearer", type: "http" }).build());
  writeFileSync(join(tmpdir(), "oxus-phase4-openapi.json"), JSON.stringify(doc, null, 2));
});
after(async () => {
  await app?.close();
});

test("private documents advertise JWT multipart limits and authenticated binary downloads", () => {
  const upload = operation("/documents", "post");
  const replacement = operation("/documents/{id}/new-version", "patch");
  for (const api of [upload, replacement]) {
    assert(api.security.some((item: any) => Object.hasOwn(item, "bearer")));
    const body = api.requestBody.content["multipart/form-data"].schema;
    assert.equal(body.properties.file.format, "binary");
    assert.match(body.properties.file.description, /10 MiB/);
    for (const status of [400, 401, 403, 404, 413, 503]) assert(api.responses[String(status)]);
  }
  assert(replacement.responses["409"]);
  const download = operation("/documents/{id}/file");
  for (const mime of ["application/pdf", "image/jpeg", "image/png"]) assert.equal(download.responses["200"].content[mime].schema.format, "binary");
  for (const header of ["Content-Disposition", "Content-Type", "Content-Length", "Cache-Control", "X-Content-Type-Options"]) assert(download.responses["200"].headers[header]);
});

test("Document schemas describe exactly eleven required public fields with nullable scalars and exact enums", () => {
  const dto = doc.components.schemas.DocumentEntity;
  const fields = ["id", "title", "fileUrl", "documentType", "version", "status", "feedback", "studentPortraitId", "targetProgramId", "createdAt", "updatedAt"];
  assert.deepEqual(Object.keys(dto.properties).sort(), [...fields].sort());
  assert.deepEqual([...dto.required].sort(), [...fields].sort());
  assert.equal(dto.properties.feedback.type, "string");
  assert.equal(dto.properties.feedback.nullable, true);
  assert.equal(dto.properties.targetProgramId.type, "integer");
  assert.equal(dto.properties.targetProgramId.nullable, true);
  assert.deepEqual(dto.properties.status.enum, ["DRAFT", "REVIEW", "NEEDS_REVISION", "APPROVED"]);
  assert.deepEqual(dto.properties.documentType.enum, ["SOP", "CV", "PASSPORT", "TRANSCRIPT", "RECOMMENDATION_LETTER", "PORTFOLIO", "LANGUAGE_CERTIFICATE", "OTHER"]);
  for (const field of ["id", "version", "studentPortraitId"]) assert.equal(dto.properties[field].type, "integer");
  for (const field of ["title", "fileUrl"]) assert.equal(dto.properties[field].type, "string");
  for (const field of ["createdAt", "updatedAt"]) assert.equal(dto.properties[field].format, "date-time");
});

for (const values of [
  { feedback: null, targetProgramId: null },
  { feedback: "Synthetic feedback", targetProgramId: 301 },
]) {
  test(`actual full Document JSON retains required ${values.feedback === null ? "null" : "scalar"} properties without private fields`, () => {
    const { toPublicDocument } = built("./dist/src/common/serialization/public-document.js");
    const { DocumentEntity } = built("./dist/src/modules/document/api/dto/document.entity.js");
    const record = {
      id: 901,
      title: "Synthetic document",
      fileUrl: "/api/v1/documents/901/file",
      documentType: "PASSPORT",
      version: 1,
      status: "DRAFT",
      ...values,
      studentPortraitId: 101,
      createdAt: new Date("2026-10-10T00:00:00.000Z"),
      updatedAt: new Date("2026-10-10T00:00:00.001Z"),
      fileKey: "documents/synthetic-private-key",
      deletedAt: null,
      operationId: "synthetic-private-operation",
    };
    const out = JSON.parse(JSON.stringify(toPublicDocument(record)));
    assert.deepEqual(out, {
      id: 901,
      title: "Synthetic document",
      fileUrl: "/api/v1/documents/901/file",
      documentType: "PASSPORT",
      version: 1,
      status: "DRAFT",
      ...values,
      studentPortraitId: 101,
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.001Z",
    });
    assert.deepEqual(JSON.parse(JSON.stringify(new DocumentEntity(record))), out);
    assert.deepEqual(Object.keys(out).sort(), [...doc.components.schemas.DocumentEntity.required].sort());
  });
}

test("staff numeric inputs have integer bounds and optional target input does not become nullable", () => {
  for (const name of ["StaffDocumentSnapshotDto", "StaffUpdateDocumentDto"]) {
    const dto = doc.components.schemas[name];
    assert.equal(dto.properties.expectedVersion.type, "integer");
    assert.equal(dto.properties.expectedVersion.minimum, 1);
    assert.equal(dto.properties.expectedVersion.maximum, 2147483647);
    assert.ok(dto.required.includes("expectedVersion"));
    assert.ok(dto.required.includes("expectedUpdatedAt"));
  }
  const { StaffCreateDocumentDto, validateStaffDto } = built("./dist/src/modules/document/api/dto/staff-document.dto.js");
  assert.throws(
    () => validateStaffDto(StaffCreateDocumentDto, { title: "Synthetic", documentType: "PASSPORT", targetProgramId: null }),
    (e: any) => e.getStatus() === 400,
  );
  assert.equal(validateStaffDto(StaffCreateDocumentDto, { title: "Synthetic", documentType: "PASSPORT" }).targetProgramId, undefined);
  const create = operation("/expert/portraits/{portraitId}/documents", "post").requestBody.content["multipart/form-data"].schema;
  assert.equal(create.properties.targetProgramId.type, "integer");
  assert.equal(create.properties.targetProgramId.minimum, 1);
  assert.equal(create.properties.targetProgramId.maximum, 2147483647);
  assert.ok(!create.required.includes("targetProgramId"));
  assert.ok(!create.properties.targetProgramId.nullable);
  const target = operation("/expert/portraits/{portraitId}/documents").parameters.find((p: any) => p.name === "targetProgramId");
  assert.equal(target.schema.type, "integer");
  assert.equal(target.schema.minimum, 1);
  assert.equal(target.schema.maximum, 2147483647);
  assert.ok(!target.required && !target.schema.nullable);
});

test("staff and every shared pagination route use scalar integer query parameters with unchanged defaults and bounds", () => {
  const consumers: string[] = [];
  for (const [path, item] of Object.entries(doc.paths) as any) {
    for (const [method, op] of Object.entries(item) as any) {
      const page = op.parameters?.find((p: any) => p.name === "page" && p.in === "query");
      const limit = op.parameters?.find((p: any) => p.name === "limit" && p.in === "query");
      if (!page || !limit) continue;
      // Other independent pagination DTOs keep their own advertised bounds.
      if (!["/api/v1/contracts", "/api/v1/admin/finance/experts/{id}/earnings", "/api/v1/expert/portraits/{portraitId}/documents"].includes(path)) continue;
      consumers.push(`${method} ${path}`);
      for (const [param, value] of [
        [page, 1],
        [limit, 20],
      ]) {
        assert.equal(param.schema.type, "integer");
        assert.equal(param.schema.default, value);
        assert.equal(param.schema.minimum, 1);
        assert.ok(!param.required && !param.schema.$ref && !param.schema.allOf);
      }
      assert.equal(limit.schema.maximum, 100);
    }
  }
  assert.deepEqual(consumers.sort(), ["get /api/v1/contracts", "get /api/v1/admin/finance/experts/{id}/earnings", "get /api/v1/expert/portraits/{portraitId}/documents"].sort());
});

test("exact seven staff routes preserve bearer, bounded integer path IDs and binary/multipart contracts", () => {
  const root = "/api/v1/expert/portraits/{portraitId}/documents";
  const expected = [
    "get " + root,
    "post " + root,
    "get " + root + "/{documentId}",
    "patch " + root + "/{documentId}",
    "delete " + root + "/{documentId}",
    "get " + root + "/{documentId}/file",
    "patch " + root + "/{documentId}/new-version",
  ];
  const actual: string[] = [];
  for (const [path, item] of Object.entries(doc.paths) as any) {
    if (!path.startsWith(root)) continue;
    for (const [method, op] of Object.entries(item) as any) {
      actual.push(`${method} ${path}`);
      assert.ok(op.security?.some((s: any) => "bearer" in s));
      const ids = op.parameters.filter((p: any) => p.in === "path");
      assert.deepEqual(ids.map((p: any) => p.name).sort(), path.includes("{documentId}") ? ["documentId", "portraitId"] : ["portraitId"]);
      for (const param of ids) {
        assert.equal(param.required, true);
        assert.deepEqual(param.schema, { type: "integer", minimum: 1, maximum: 2147483647 });
      }
    }
  }
  assert.deepEqual(actual.sort(), expected.sort());
  const binary = doc.paths[root + "/{documentId}/file"].get;
  for (const mime of ["application/pdf", "image/jpeg", "image/png"]) assert.equal(binary.responses["200"].content[mime].schema.format, "binary");
  assert.deepEqual(binary.responses["200"].headers["Content-Length"].schema, { type: "integer", minimum: 1, maximum: 10485760 });
  for (const header of ["Content-Disposition", "Cache-Control", "X-Content-Type-Options"]) assert.ok(binary.responses["200"].headers[header]);
  const replace = doc.paths[root + "/{documentId}/new-version"].patch;
  assert.deepEqual(replace.requestBody.content["multipart/form-data"].schema.required, ["file", "expectedVersion", "expectedUpdatedAt"]);
  assert.equal(replace.requestBody.content["multipart/form-data"].schema.properties.expectedVersion.type, "integer");
  for (const status of ["400", "401", "403", "404", "409", "413", "503"]) assert.ok(replace.responses[status]);
});

test("student routes retain their original multipart fields, JWT binary contract and no staff snapshot requirement", () => {
  const create = operation("/documents", "post").requestBody.content["multipart/form-data"].schema;
  assert.deepEqual(create.required, ["file", "title", "documentType"]);
  const replace = operation("/documents/{id}/new-version", "patch").requestBody.content["multipart/form-data"].schema;
  assert.deepEqual(replace.required, ["file"]);
  assert.deepEqual(Object.keys(replace.properties), ["file"]);
  assert.ok(operation("/documents/me").security.some((s: any) => "bearer" in s));
  assert.ok(operation("/documents/{id}/file").security.some((s: any) => "bearer" in s));
  assert.ok(!operation("/documents/{id}/file").parameters.some((p: any) => p.name === "portraitId"));
  assert.ok(doc.paths["/api/v1/documents/{id}/submit-for-review"].patch);
  assert.ok(doc.paths["/api/v1/documents/{id}/review"].patch);
});
test("manual lead writes expose optional frontend metrics while preview keeps its server-calculation contract", () => {
  for (const name of ["CreateManualLeadV2Dto", "SaveCalculatorAnswersDto", "ExpressSubmissionDto"]) {
    const dto = doc.components.schemas[name];
    for (const [field, maximum] of Object.entries({ score: 1000, percent: 100, universities: 10000 })) {
      assert.equal(dto.properties[field].type, "integer");
      assert.equal(dto.properties[field].minimum, 0);
      assert.equal(dto.properties[field].maximum, maximum);
      assert.ok(!dto.properties[field].nullable);
      assert.ok(!dto.required?.includes(field));
    }
  }
  assert.match(operation("/sales/v2/leads", "post").description, /together/);
  assert.match(operation("/sales/v2/leads/{id}/questionnaire", "patch").requestBody.content["application/json"].schema.$ref, /SaveCalculatorAnswersDto$/);
  assert.ok(!doc.components.schemas.CalculatorAnswersDto.properties.score);
});
test("Express public submission documents its student form and idempotency response", () => {
  const op = operation("/public/lead-sources/express/submissions", "post");
  assert.ok(!op.security?.length);
  const dto = doc.components.schemas.ExpressSubmissionDto;
  assert.deepEqual(dto.required.sort(), ["submissionId", "locale", "schoolName", "grade", "firstName", "lastName", "phone", "countryIds", "studyFields"].sort());
  for (const field of ["score", "percent", "universities"]) assert.ok(dto.properties[field]);
  assert.match(op.description, /without recalculation/);
  assert.deepEqual(dto.properties.grade.enum, [9, 10, 11]);
  assert.equal(dto.properties.countryIds.items.type, "integer");
  assert.deepEqual(dto.properties.studyFields.items.enum, ["IT", "ENGINEERING", "BUSINESS", "ECONOMICS", "AVIATION", "MEDICINE", "LAW", "OTHER"]);
  assert.equal(dto.properties.studyFieldsOther.type, "string");
  assert.equal(dto.properties.studyFieldsOther.nullable, true);
  assert.equal(dto.properties.studyFieldsOther.maxLength, 4000);
  assert.equal(schema("/public/lead-sources/express/submissions", "post", "201").properties.created.type, "boolean");
  for (const status of ["400", "404", "413", "429"]) assert.ok(op.responses[status]);
});
test("R05 finance has currency-aware nullable scalars, per-contract currencies and paged earnings", () => {
  const summary = schema("/admin/finance/summary").properties;
  for (const field of ["totalPaidAmount", "totalSignedAmount", "signedUnpaidAmount", "currency"]) assert.equal(summary[field].nullable, true);
  assert.equal(summary.byCurrency.items.properties.currency.type, "string");
  const earnings = schema("/admin/finance/experts/{id}/earnings").properties;
  assert.equal(earnings.totals.properties.paidAmount.nullable, true);
  assert.ok(earnings.totals.properties.byCurrency);
  assert.equal(earnings.contracts.items.properties.currency.type, "string");
  assert.ok(earnings.totalPages);
  assert.ok(schema("/contracts").properties.data.items.properties.status);
});
test("R05 prepare/signature/confirm/detail document drafts, nullable contract and installment receipts", () => {
  const prepare = schema("/expert/leads/{id}/contract", "post", "201").properties;
  assert.equal(prepare.contract.nullable, true);
  assert.equal(prepare.draft.nullable, true);
  assert.ok(prepare.draft.properties.signedAt);
  assert.ok(schema("/expert/leads/{id}").properties.contractDraft);
  assert.ok(schema("/expert/leads/{id}/contract/signature", "post", "201").properties.draft);
  const confirmed = schema("/expert/leads/{id}/contract/confirm", "post", "201");
  assert.equal(confirmed.properties.contract.properties.installments.items.properties.amount.type, "string");
  assert.ok(schema("/contracts/{id}/confirm-manual", "post", "201").properties.manualConfirmedAt);
  assert.ok(schema("/contracts/{id}/confirm-manual", "post", "409").properties.code.enum.includes("HISTORICAL_BENEFITS_REVIEW_REQUIRED"));
});
test("R05 analytics describes event/storage times, event types and nullable durations", () => {
  const event = schema("/admin/analytics/events").properties.data.items.properties;
  assert.equal(event.occurredAt.format, "date-time");
  assert.equal(event.createdAt.format, "date-time");
  assert.match(event.eventType.description, /CONTRACT_INSTALLMENT_PAID/);
  const stage = schema("/admin/analytics/student/{id}/journey").properties.stageDurations.items.properties;
  assert.equal(stage.durationMs.nullable, true);
  assert.equal(stage.durationDays.nullable, true);
});
test("R05 all four OTP routes are deprecated and advertise only the manual-signature conflict", () => {
  for (const side of ["expert", "student"])
    for (const action of ["otp", "sign"]) {
      const op = operation(`/contracts/{id}/${action}/${side}`, "post");
      assert.equal(op.deprecated, true);
      assert.ok(!op.responses["200"] && !op.responses["201"]);
      assert.deepEqual(op.responses["409"].content["application/json"].schema.properties.code.enum, ["MANUAL_SIGNATURE_REQUIRED"]);
    }
});
test("R05 scans advertise multipart file, content limits and binary downloads", () => {
  const upload = operation("/contracts/{id}/scan", "post");
  const file = upload.requestBody.content["multipart/form-data"].schema.properties.file;
  assert.equal(file.format, "binary");
  assert.match(file.description, /10485760/);
  assert.match(file.description, /PDF, JPEG or PNG/);
  assert.ok(upload.responses["413"]);
  for (const mime of ["application/pdf", "image/jpeg", "image/png"]) assert.equal(operation("/contracts/{id}/scan").responses["200"].content[mime].schema.format, "binary");
});
test("R05 provider callback documents raw signed form fields and XML, without bearer", () => {
  const op = operation("/payment/freedompay-webhook", "post");
  assert.ok(!op.security?.length);
  assert.ok(op.requestBody.content["application/x-www-form-urlencoded"].schema.properties.pg_sig);
  assert.ok(op.requestBody.content["multipart/form-data"].schema.additionalProperties);
  assert.ok(op.responses["200"].content["application/xml"]);
  assert.ok(!op.responses["200"].content["application/json"]);
});
test("C03 public OpenAPI properties never expose internal contract OTP fields", () => {
  const walk = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const key of ["studentOtpHash", "studentOtpExpiry", "expertOtpHash", "expertOtpExpiry"]) assert.ok(!Object.hasOwn(value.properties ?? {}, key), key);
    Object.values(value).forEach(walk);
  };
  walk(doc);
});
test("R05 modified protected operations declare bearer and all schema references resolve", () => {
  for (const [path, item] of Object.entries(doc.paths) as any) {
    if (!/^\/api\/v1\/(contracts|expert\/leads|admin\/finance|admin\/analytics)(\/|$)/.test(path)) continue;
    for (const method of ["get", "post", "patch"])
      if (item[method])
        assert.ok(
          item[method].security?.some((s: any) => "bearer" in s),
          `${method} ${path}`,
        );
  }
  const walk = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (value.$ref?.startsWith("#/components/schemas/")) assert.ok(doc.components.schemas[value.$ref.split("/").at(-1)]);
    Object.values(value).forEach(walk);
  };
  walk(doc);
  for (const path of ["/contracts", "/admin/finance/experts/{id}/earnings"]) {
    const limit = operation(path).parameters.find((p: any) => p.name === "limit");
    assert.equal(limit.schema.maximum, 100);
    assert.equal(limit.schema.default, 20);
  }
});
