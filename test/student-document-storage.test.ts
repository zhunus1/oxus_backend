/** Invoked only by run-student-document-storage.mjs against its newly created MinIO. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  GetBucketAclCommand,
  GetBucketPolicyCommand,
  GetObjectAclCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutBucketAclCommand,
  PutBucketPolicyCommand,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StudentDocumentStorageService as StorageType } from "../src/common/utils/minio/student-document-storage.service";

const endpoint = new URL(process.env.MINIO_TEST_ENDPOINT ?? "");
assert(
  endpoint.protocol === "http:" &&
    endpoint.hostname === "127.0.0.1" &&
    endpoint.port &&
    endpoint.pathname === "/" &&
    !endpoint.search &&
    !endpoint.hash &&
    !endpoint.username &&
    !endpoint.password,
);
const owner = process.env.MINIO_TEST_RUN_ID ?? "";
assert(/^[0-9a-f-]{36}$/.test(owner) && process.env.MINIO_TEST_ACCESS_KEY?.startsWith("test-") && process.env.MINIO_TEST_SECRET_KEY, "Use the owning disposable MinIO runner");
const built = createRequire(resolve("package.json"));
const { MinioService } = built("./dist/src/common/utils/minio/minio.service.js");
const { UploadService } = built("./dist/src/common/utils/minio/upload.service.js");
const { StudentDocumentStorageService } = built("./dist/src/common/utils/minio/student-document-storage.service.js");
const { STUDENT_DOCUMENT_MAX_BYTES } = built("./dist/src/common/utils/minio/student-document-file.js");
const base = `sdt-${owner}`;
const bucket = `${base}-student-documents`;
const contracts = `${base}-contracts`;
const config = new ConfigService({
  AWS_BUCKET_NAME: base,
  AWS_MINIO_ENDPOINT: endpoint.toString(),
  AWS_MINIO_PUBLIC_URL: endpoint.toString().replace(/\/$/, ""),
  AWS_ACCESS_KEY_ID: process.env.MINIO_TEST_ACCESS_KEY,
  AWS_SECRET_ACCESS_KEY: process.env.MINIO_TEST_SECRET_KEY,
});
const minio = new MinioService(config);
const client: S3Client = minio.getS3Client();
const storage: StorageType = new StudentDocumentStorageService(minio);
const uploads = new UploadService(minio);
const publicKey = "public/existing.txt";
const contractKey = "contract/existing";
const foreignDocumentKey = `documents/${randomUUID()}`;
let publicPolicy: string | undefined;
let contractAcl: unknown;
const file = (name = "blank.pdf", mimetype = "application/pdf") => {
  const buffer = readFileSync(resolve("test/fixtures/student-documents", name));
  return { buffer, size: buffer.length, mimetype, originalname: "Synthetic Passport Иванов.pdf" } as Express.Multer.File;
};
const read = async (key: string) => {
  const { stream, contentType, size } = await storage.streamPrivateDocument(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  assert(stream.readableEnded && stream.destroyed);
  return { buffer: Buffer.concat(chunks), contentType, size };
};
const anonymous = async (Bucket: string, Key: string) => {
  const response = await fetch(new URL(`${Bucket}/${Key}`, endpoint), { signal: AbortSignal.timeout(5000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes };
};

before(async () => {
  Logger.overrideLogger(false);
  // Existing public initializer is exercised only in this owned container.
  await minio.onModuleInit();
  await client.send(new PutObjectCommand({ Bucket: base, Key: publicKey, Body: "public fixture" }));
  await client.send(new PutObjectCommand({ Bucket: base, Key: foreignDocumentKey, Body: "foreign fixture" }));
  publicPolicy = (await client.send(new GetBucketPolicyCommand({ Bucket: base }))).Policy;
  await client.send(new CreateBucketCommand({ Bucket: contracts }));
  await client.send(new PutObjectCommand({ Bucket: contracts, Key: contractKey, Body: "contract fixture" }));
  contractAcl = await client.send(new GetBucketAclCommand({ Bucket: contracts }));
});
// The runner deletes only its entire disposable container, including interrupted test objects.
after(() => client.destroy());

test("creates a private bucket and tolerates concurrent initialization from separate services", async () => {
  await Promise.all(Array.from({ length: 12 }, () => new StudentDocumentStorageService(minio).ensurePrivateBucket()));
  const buckets = await client.send(new ListBucketsCommand({}));
  assert(buckets.Buckets?.some(item => item.Name === bucket));
  await assert.rejects(client.send(new GetBucketPolicyCommand({ Bucket: bucket })), { name: "NoSuchBucketPolicy" });
  const acl = await client.send(new GetBucketAclCommand({ Bucket: bucket }));
  assert(acl.Grants?.every(grant => grant.Grantee?.Type === "CanonicalUser" && (acl.Owner?.ID ? grant.Grantee.ID === acl.Owner.ID : !grant.Grantee.ID)));
});

for (const [name, mime] of [
  ["blank.pdf", "application/pdf"],
  ["pixel.jpg", "image/jpeg"],
  ["pixel.png", "image/png"],
]) {
  test(`uploads and streams real ${mime} bytes without a URL or PII`, async () => {
    const source = file(name, mime);
    const uploaded = await storage.uploadPrivateDocument(source);
    assert.deepEqual(Object.keys(uploaded).sort(), ["contentType", "fileKey", "size"]);
    assert.match(uploaded.fileKey, /^documents\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert(!uploaded.fileKey.includes("Passport") && !uploaded.fileKey.includes("Иванов") && !uploaded.fileKey.includes(name));
    const downloaded = await read(uploaded.fileKey);
    assert.deepEqual(downloaded, { buffer: source.buffer, contentType: mime, size: source.size });
    assert(await storage.privateDocumentExists(uploaded.fileKey));
    const acl = await client.send(new GetObjectAclCommand({ Bucket: bucket, Key: uploaded.fileKey }));
    assert(acl.Grants?.every(grant => grant.Grantee?.Type === "CanonicalUser" && (acl.Owner?.ID ? grant.Grantee.ID === acl.Owner.ID : !grant.Grantee.ID)));
    const unauthenticated = await anonymous(bucket, uploaded.fileKey);
    assert.equal(unauthenticated.status, 403);
    assert(!unauthenticated.bytes.equals(source.buffer));
  });
}

test("denies anonymous bucket listing and writes", async () => {
  const listing = await fetch(new URL(`${bucket}?list-type=2`, endpoint));
  await listing.body?.cancel();
  assert.equal(listing.status, 403);
  const write = await fetch(new URL(`${bucket}/documents/${randomUUID()}`, endpoint), { method: "PUT", body: "unauthorized" });
  await write.body?.cancel();
  assert.equal(write.status, 403);
});

for (const [label, source] of [
  ["missing", undefined],
  ["empty", { ...file(), buffer: Buffer.alloc(0), size: 0 }],
  ["oversized", { ...file(), buffer: Buffer.alloc(STUDENT_DOCUMENT_MAX_BYTES + 1), size: STUDENT_DOCUMENT_MAX_BYTES + 1 }],
  ["MIME mismatch", file("pixel.png", "application/pdf")],
  ["forbidden format", file("blank.pdf", "application/zip")],
  ["multiple files", [file(), file()]],
] as const) {
  test(`rejects ${label} upload without creating an object`, async () => {
    const before = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    await assert.rejects(storage.uploadPrivateDocument(source as Express.Multer.File), { status: 400 });
    const after = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    assert.deepEqual(after.Contents, before.Contents);
  });
}

test("does not overwrite keys under parallel uploads", async () => {
  const objects = await Promise.all(Array.from({ length: 16 }, () => storage.uploadPrivateDocument(file())));
  assert.equal(new Set(objects.map(object => object.fileKey)).size, objects.length);
  await Promise.all(objects.map(async object => assert.deepEqual((await read(object.fileKey)).buffer, file().buffer)));
  const key = objects[0].fileKey;
  await assert.rejects(client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "overwrite", IfNoneMatch: "*" })), { name: "PreconditionFailed" });
  assert.deepEqual((await read(key)).buffer, file().buffer);
});

test("deletes exactly one object and repeat deletion is idempotent", async () => {
  const removed = await storage.uploadPrivateDocument(file());
  const retained = await storage.uploadPrivateDocument(file());
  await storage.deletePrivateDocument(removed.fileKey);
  await storage.deletePrivateDocument(removed.fileKey);
  assert.equal(await storage.privateDocumentExists(removed.fileKey), false);
  await assert.rejects(storage.streamPrivateDocument(removed.fileKey), { status: 404 });
  assert.equal(await storage.privateDocumentExists(retained.fileKey), true);
  await client.send(new HeadObjectCommand({ Bucket: base, Key: foreignDocumentKey }));
  await client.send(new HeadObjectCommand({ Bucket: contracts, Key: contractKey }));
});

test("missing key returns not found and false existence", async () => {
  const key = `documents/${randomUUID()}`;
  await assert.rejects(storage.streamPrivateDocument(key), { status: 404 });
  assert.equal(await storage.privateDocumentExists(key), false);
  await storage.deletePrivateDocument(key);
});

test("foreign buckets, URLs, traversal and namespaces cannot be used", async () => {
  for (const key of [`${base}/${foreignDocumentKey}`, contractKey, `http://example.test/${bucket}/file`, "../x", foreignDocumentKey + "\n"]) {
    await assert.rejects(storage.deletePrivateDocument(key), { status: 400 });
    await assert.rejects(storage.streamPrivateDocument(key), { status: 400 });
  }
  await client.send(new HeadObjectCommand({ Bucket: base, Key: foreignDocumentKey }));
  await client.send(new HeadObjectCommand({ Bucket: contracts, Key: contractKey }));
});

test("public policy on an existing private bucket fails closed without repair", async () => {
  const { fileKey } = await storage.uploadPrivateDocument(file());
  const policy = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: `arn:aws:s3:::${bucket}/*` }] });
  await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy }));
  try {
    assert.equal((await anonymous(bucket, fileKey)).status, 200); // Canary proves anonymous probe can detect public access.
    const existingPolicy = (await client.send(new GetBucketPolicyCommand({ Bucket: bucket }))).Policy;
    await assert.rejects(storage.ensurePrivateBucket(), { status: 503 });
    await assert.rejects(storage.uploadPrivateDocument(file()), { status: 503 });
    await assert.rejects(storage.streamPrivateDocument(fileKey), { status: 503 });
    await assert.rejects(storage.deletePrivateDocument(fileKey), { status: 503 });
    assert.equal((await client.send(new GetBucketPolicyCommand({ Bucket: bucket }))).Policy, existingPolicy);
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: fileKey }));
  } finally {
    // Only the test's own injected policy in its own disposable bucket is removed.
    await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
  }
  await storage.ensurePrivateBucket();
  assert.equal((await anonymous(bucket, fileKey)).status, 403);
});

test("MinIO rejects public bucket and object ACLs; stored objects remain anonymous-inaccessible", async () => {
  const { fileKey } = await storage.uploadPrivateDocument(file());
  await assert.rejects(
    client.send(new PutBucketAclCommand({ Bucket: bucket, ACL: "public-read" })),
    error => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 501,
  );
  await assert.rejects(
    client.send(new PutObjectAclCommand({ Bucket: bucket, Key: fileKey, ACL: "public-read" })),
    error => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 501,
  );
  await storage.ensurePrivateBucket();
  assert.equal((await anonymous(bucket, fileKey)).status, 403);
});

test("unverifiable storage with invalid local credentials fails closed", async () => {
  const unauthorizedMinio = new MinioService(
    new ConfigService({
      AWS_BUCKET_NAME: base,
      AWS_MINIO_ENDPOINT: endpoint.toString(),
      AWS_ACCESS_KEY_ID: "test-invalid",
      AWS_SECRET_ACCESS_KEY: "test-invalid-secret",
    }),
  );
  const unauthorized: StorageType = new StudentDocumentStorageService(unauthorizedMinio);
  try {
    await assert.rejects(unauthorized.ensurePrivateBucket(), { status: 503 });
    await assert.rejects(unauthorized.uploadPrivateDocument(file()), { status: 503 });
    await assert.rejects(unauthorized.streamPrivateDocument(`documents/${randomUUID()}`), { status: 503 });
    await assert.rejects(unauthorized.deletePrivateDocument(`documents/${randomUUID()}`), { status: 503 });
  } finally {
    unauthorizedMinio.getS3Client().destroy();
  }
});

test("early stream cancellation releases the upstream S3 request", async () => {
  const buffer = Buffer.alloc(STUDENT_DOCUMENT_MAX_BYTES, 32);
  buffer.write("%PDF-1.7\n");
  buffer.write("%%EOF", buffer.length - 5);
  const { fileKey } = await storage.uploadPrivateDocument({ buffer, size: buffer.length, mimetype: "application/pdf" });
  const { stream } = await storage.streamPrivateDocument(fileKey);
  stream.destroy();
  await new Promise(resolve => stream.once("close", resolve));
  assert(stream.destroyed);
  assert.deepEqual((await read(fileKey)).buffer, buffer);
});

test("shared public UploadService semantics and contract bucket are preserved", async () => {
  const url = await uploads.uploadFile("avatars", file("pixel.png", "image/png"));
  assert(url.startsWith(`${endpoint.origin}/${base}/avatars/`));
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), file("pixel.png", "image/png").buffer);
  assert.equal((await client.send(new GetBucketPolicyCommand({ Bucket: base }))).Policy, publicPolicy);
  const afterAcl = await client.send(new GetBucketAclCommand({ Bucket: contracts }));
  // Request metadata changes per request, while actual ACL must stay identical.
  assert.deepEqual({ Owner: afterAcl.Owner, Grants: afterAcl.Grants }, { Owner: (contractAcl as typeof afterAcl).Owner, Grants: (contractAcl as typeof afterAcl).Grants });
  await assert.rejects(client.send(new GetBucketPolicyCommand({ Bucket: contracts })), { name: "NoSuchBucketPolicy" });
  assert.equal((await anonymous(contracts, contractKey)).status, 403);
  const contract = await client.send(new GetObjectCommand({ Bucket: contracts, Key: contractKey }));
  assert.equal(await contract.Body?.transformToString(), "contract fixture");
  assert.equal((await anonymous(base, publicKey)).bytes.toString(), "public fixture");
});
