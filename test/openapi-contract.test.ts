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
test("Express public submission documents its student form and idempotency response", () => {
  const op = operation("/public/lead-sources/express/submissions", "post");
  assert.ok(!op.security?.length);
  const dto = doc.components.schemas.ExpressSubmissionDto;
  assert.deepEqual(dto.required.sort(), ["submissionId", "locale", "schoolName", "grade", "firstName", "lastName", "phone", "countryIds", "studyFields"].sort());
  assert.deepEqual(dto.properties.grade.enum, [9, 10, 11]);
  assert.equal(dto.properties.countryIds.items.type, "integer");
  assert.deepEqual(dto.properties.studyFields.items.enum, ["IT", "ENGINEERING", "BUSINESS", "ECONOMICS", "AVIATION", "MEDICINE", "LAW", "OTHER"]);
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
