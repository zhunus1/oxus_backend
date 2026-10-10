import { BadRequestException, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { GetBucketAclCommand, GetBucketPolicyCommand, GetObjectAclCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { MinioService } from "./minio.service";
import { StudentDocumentStorageService } from "./student-document-storage.service";
import { STUDENT_DOCUMENT_MAX_BYTES, STUDENT_DOCUMENT_MULTIPART_LIMITS, validateStudentDocumentFile } from "./student-document-file";

const acl = { Owner: { ID: "owner" }, Grants: [{ Grantee: { Type: "CanonicalUser", ID: "owner" }, Permission: "FULL_CONTROL" }] };
const missing = (name: string) => Object.assign(new Error("secret endpoint/credentials"), { name, $metadata: { httpStatusCode: 404 } });
const key = `documents/${randomUUID()}`;
const fixture = (name = "blank.pdf", mimetype = "application/pdf") => {
  const buffer = readFileSync(resolve(__dirname, "../../../../test/fixtures/student-documents", name));
  return { buffer, size: buffer.length, mimetype };
};

describe("student document validation", () => {
  it.each([
    ["blank.pdf", "application/pdf"],
    ["pixel.jpg", "image/jpeg"],
    ["pixel.png", "image/png"],
  ])("accepts a structurally complete %s", (name, mime) => {
    expect(validateStudentDocumentFile(fixture(name, mime)).contentType).toBe(mime);
  });

  it.each(Array.from({ length: 9 }, (_, index) => index))("rejects a high-bit mutation at PDF header byte %i", index => {
    const file = fixture();
    file.buffer[index] |= 0x80;
    expect(() => validateStudentDocumentFile(file)).toThrow(BadRequestException);
  });

  it.each(["IHDR", "IDAT", "IEND"].flatMap(tag => Array.from({ length: 4 }, (_, index) => [tag, index] as const)))(
    "rejects a high-bit mutation at PNG %s byte %i",
    (tag, index) => {
      const file = fixture("pixel.png", "image/png");
      const offset = file.buffer.indexOf(Buffer.from(tag));
      expect(offset).toBeGreaterThanOrEqual(0);
      file.buffer[offset + index] |= 0x80;
      expect(() => validateStudentDocumentFile(file)).toThrow(BadRequestException);
    },
  );

  it.each([1, 4, 7, 8, 11])("rejects a truncated PNG chunk with %i bytes after the signature", length => {
    const buffer = fixture("pixel.png", "image/png").buffer.subarray(0, 8 + length);
    expect(() => validateStudentDocumentFile({ buffer, size: buffer.length, mimetype: "image/png" })).toThrow(BadRequestException);
  });

  it.each(["oversized chunk", "shifted boundary", "truncated CRC", "data after IEND"])("rejects PNG %s", condition => {
    let buffer = Buffer.from(fixture("pixel.png", "image/png").buffer);
    if (condition === "oversized chunk") buffer.writeUInt32BE(buffer.length, 8);
    if (condition === "shifted boundary") buffer.writeUInt32BE(12, 8);
    if (condition === "truncated CRC") buffer = buffer.subarray(0, buffer.length - 1);
    if (condition === "data after IEND") buffer = Buffer.concat([buffer, Buffer.from([0])]);
    expect(() => validateStudentDocumentFile({ buffer, size: buffer.length, mimetype: "image/png" })).toThrow(BadRequestException);
  });

  it.each(["size mismatch", "oversized", "MIME mismatch"])("preserves PNG %s validation", condition => {
    const file = fixture("pixel.png", "image/png");
    if (condition === "size mismatch") file.size--;
    if (condition === "oversized") {
      file.buffer = Buffer.concat([file.buffer, Buffer.alloc(STUDENT_DOCUMENT_MAX_BYTES)]);
      file.size = file.buffer.length;
    }
    if (condition === "MIME mismatch") file.mimetype = "image/jpeg";
    expect(() => validateStudentDocumentFile(file)).toThrow(BadRequestException);
  });

  it.each(["%PDF-1.0\n", "%PDF-1.7\r\n", "%PDF-2.0\n"])("accepts the supported PDF header %j", header => {
    const file = fixture();
    file.buffer = Buffer.concat([Buffer.from(header), file.buffer.subarray(9)]);
    file.size = file.buffer.length;
    expect(validateStudentDocumentFile(file).buffer).toEqual(file.buffer);
  });

  it.each(["missing EOF", "data after EOF"])("rejects a PDF with %s", condition => {
    const file = fixture();
    const eof = file.buffer.lastIndexOf("%%EOF");
    file.buffer = condition === "missing EOF" ? file.buffer.subarray(0, eof) : Buffer.concat([file.buffer, Buffer.from("unexpected")]);
    file.size = file.buffer.length;
    expect(() => validateStudentDocumentFile(file)).toThrow(BadRequestException);
  });

  it.each([
    ["absent", undefined],
    ["empty", { buffer: Buffer.alloc(0), size: 0, mimetype: "application/pdf" }],
    ["missing buffer", { size: 1, mimetype: "application/pdf" }],
    ["size mismatch", { ...fixture(), size: 1 }],
    ["negative size", { ...fixture(), size: -1 }],
    ["oversized", { buffer: Buffer.alloc(STUDENT_DOCUMENT_MAX_BYTES + 1), size: STUDENT_DOCUMENT_MAX_BYTES + 1, mimetype: "application/pdf" }],
    ["MIME mismatch", fixture("pixel.png", "application/pdf")],
    ["forbidden MIME", fixture("blank.pdf", "application/zip")],
    ["executable", { buffer: Buffer.from("MZ executable"), size: 13, mimetype: "application/pdf" }],
    ["truncated PDF", { buffer: Buffer.from("%PDF-1.7\n"), size: 9, mimetype: "application/pdf" }],
    ["PNG header only", { buffer: fixture("pixel.png", "image/png").buffer.subarray(0, 8), size: 8, mimetype: "image/png" }],
    ["JPEG header only", { buffer: Buffer.from([255, 216, 255, 217]), size: 4, mimetype: "image/jpeg" }],
    ["multiple files", [fixture(), fixture()]],
  ])("rejects %s", (_name, file) => {
    expect(() => validateStudentDocumentFile(file as Express.Multer.File)).toThrow(BadRequestException);
  });

  it("sanitizes errors reading a file buffer", () => {
    const file = {
      get buffer(): Buffer {
        throw new Error("private path");
      },
      size: 1,
      mimetype: "application/pdf",
    };
    expect(() => validateStudentDocumentFile(file)).toThrow(BadRequestException);
    expect(() => validateStudentDocumentFile(file)).not.toThrow("private path");
  });

  it("accepts exactly 10 MiB and exports pre-buffer multipart limits", () => {
    const buffer = Buffer.alloc(STUDENT_DOCUMENT_MAX_BYTES, 32);
    buffer.write("%PDF-1.7\n");
    buffer.write("%%EOF", buffer.length - 5);
    expect(validateStudentDocumentFile({ buffer, size: buffer.length, mimetype: "application/pdf" }).size).toBe(STUDENT_DOCUMENT_MAX_BYTES);
    expect(STUDENT_DOCUMENT_MULTIPART_LIMITS).toEqual({ fileSize: STUDENT_DOCUMENT_MAX_BYTES, files: 1 });
    expect(Object.isFrozen(STUDENT_DOCUMENT_MULTIPART_LIMITS)).toBe(true);
  });
});

describe("student document storage failures and isolation", () => {
  let send: jest.Mock;
  let service: StudentDocumentStorageService;
  let log: jest.SpyInstance;
  const successful = async (command: unknown) => {
    if (command instanceof GetBucketPolicyCommand) throw missing("NoSuchBucketPolicy");
    if (command instanceof GetBucketAclCommand || command instanceof GetObjectAclCommand) return acl;
    if (command instanceof GetObjectCommand) return { Body: Readable.from(fixture().buffer), ContentType: "application/pdf", ContentLength: fixture().size };
    return {};
  };
  beforeEach(() => {
    send = jest.fn(successful);
    service = new StudentDocumentStorageService({ getBucketName: () => "uploads", getS3Client: () => ({ send }) } as unknown as MinioService);
    log = jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("rejects invalid files before any storage I/O", async () => {
    await expect(service.uploadPrivateDocument(undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["storage/documents/a", "../x", "https://example.test/file", key + "\n", key.toUpperCase(), "contracts/" + randomUUID(), "documents/" + "0".repeat(36)])(
    "rejects foreign or malformed key %s before I/O",
    async badKey => {
      await expect(service.streamPrivateDocument(badKey)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.deletePrivateDocument(badKey)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.privateDocumentExists(badKey)).rejects.toBeInstanceOf(BadRequestException);
      expect(send).not.toHaveBeenCalled();
    },
  );
  it.each([
    { Policy: JSON.stringify({ Statement: [{ Effect: "Allow", Principal: "*", Action: "s3:GetObject" }] }) },
    { Policy: JSON.stringify({ Statement: [{ Effect: "Allow", Principal: { AWS: "owner" } }] }) },
    { Policy: "malformed" },
    {},
  ])("fails closed on unapproved or unverifiable policy %#", async response => {
    send.mockImplementation(command => (command instanceof GetBucketPolicyCommand ? Promise.resolve(response) : successful(command)));
    await expect(service.uploadPrivateDocument(fixture())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(false);
  });
  it.each([GetBucketPolicyCommand, GetBucketAclCommand])("fails closed when %p cannot be checked", async commandType => {
    send.mockImplementation(command => (command instanceof commandType ? Promise.reject(new Error("secret endpoint")) : successful(command)));
    await expect(service.ensurePrivateBucket()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret endpoint");
  });
  it("does not treat a generic policy 404 as no policy", async () => {
    send.mockImplementation(command => (command instanceof GetBucketPolicyCommand ? Promise.reject(missing("NotFound")) : successful(command)));
    await expect(service.ensurePrivateBucket()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it.each([{}, { Owner: { ID: "owner" }, Grants: [] }, { ...acl, Grants: [{ Grantee: { Type: "Group", URI: "AllUsers" }, Permission: "READ" }] }])(
    "rejects non-owner or unverifiable ACL %#",
    async response => {
      send.mockImplementation(command => (command instanceof GetBucketAclCommand ? Promise.resolve(response) : successful(command)));
      await expect(service.ensurePrivateBucket()).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );
  it("rechecks privacy after a previous successful check", async () => {
    await service.ensurePrivateBucket();
    send.mockRejectedValue(new Error("changed policy"));
    await expect(service.deletePrivateDocument(key)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it("supports the verified MinIO private ACL compatibility response", async () => {
    send.mockImplementation(command =>
      command instanceof GetBucketAclCommand
        ? Promise.resolve({ Owner: { ID: "", DisplayName: "" }, Grants: [{ Grantee: { Type: "CanonicalUser" }, Permission: "FULL_CONTROL" }] })
        : successful(command),
    );
    await expect(service.ensurePrivateBucket()).resolves.toBeUndefined();
  });
  it("rejects an unidentified canonical grant with an unidentified owner on a non-stub ACL", async () => {
    send.mockImplementation(command =>
      command instanceof GetBucketAclCommand
        ? Promise.resolve({ Owner: {}, Grants: [{ Grantee: { Type: "CanonicalUser", ID: "other" }, Permission: "FULL_CONTROL" }] })
        : successful(command),
    );
    await expect(service.ensurePrivateBucket()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it("shares concurrent checks without caching permanent readiness", async () => {
    await Promise.all(Array.from({ length: 8 }, () => service.ensurePrivateBucket()));
    expect(send.mock.calls.filter(([command]) => command instanceof HeadBucketCommand)).toHaveLength(1);
    await service.ensurePrivateBucket();
    expect(send.mock.calls.filter(([command]) => command instanceof HeadBucketCommand)).toHaveLength(2);
  });
  it("uses a fresh key and conditional write without URL/ACL/PII", async () => {
    const result = await service.uploadPrivateDocument(fixture());
    expect(Object.keys(result).sort()).toEqual(["contentType", "fileKey", "size"]);
    const put = send.mock.calls.find(([command]) => command instanceof PutObjectCommand)![0];
    expect(put.input).toMatchObject({ Bucket: "uploads-student-documents", Key: result.fileKey, IfNoneMatch: "*", ContentType: "application/pdf" });
    expect(put.input.ACL).toBeUndefined();
  });
  it("owns validated bytes while awaiting bucket I/O", async () => {
    const file = fixture();
    const result = service.uploadPrivateDocument(file);
    file.buffer.fill(0);
    await result;
    expect(send.mock.calls.find(([command]) => command instanceof PutObjectCommand)![0].input.Body).toEqual(fixture().buffer);
  });
  it("persists a recovery intent before PutObject and awaits it", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>(resolve => {
      entered = resolve;
    });
    const prepare = jest.fn(async () => {
      entered();
      await pending;
    });
    const upload = service.uploadPrivateDocument(fixture(), { beforeUpload: prepare });
    await ready;
    expect(send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(false);
    release();
    const result = await upload;
    expect(prepare).toHaveBeenCalledWith(result.fileKey);
  });
  it("does not send PutObject when durable preparation fails", async () => {
    const error = new Error("recovery journal unavailable");
    await expect(
      service.uploadPrivateDocument(fixture(), {
        beforeUpload: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
    expect(send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(false);
  });
  it("passes the same request signal to all private download SDK requests", async () => {
    const signal = new AbortController().signal;
    const { stream } = await service.streamPrivateDocument(key, signal);
    expect(send.mock.calls.every(([, options]) => options.abortSignal === signal)).toBe(true);
    stream.destroy();
  });
  it("sanitizes a cancelled GetObject request", async () => {
    const abort = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>(resolve => {
      entered = resolve;
    });
    send.mockImplementation((command, options) =>
      command instanceof GetObjectCommand
        ? new Promise((_resolve, reject) => {
            options.abortSignal.addEventListener("abort", () => reject(new Error("secret SDK endpoint")), { once: true });
            entered();
          })
        : successful(command),
    );
    const pending = service.streamPrivateDocument(key, abort.signal);
    const rejected = expect(pending).rejects.toThrow("Document storage is unavailable");
    await ready;
    abort.abort();
    await rejected;
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret SDK endpoint");
  });
  it.each(["upload", "download", "delete", "exists"])("sanitizes %s storage failure", async operation => {
    await service.ensurePrivateBucket();
    send.mockImplementation(command =>
      command instanceof HeadBucketCommand || command instanceof GetBucketPolicyCommand || command instanceof GetBucketAclCommand
        ? successful(command)
        : Promise.reject(new Error("secret endpoint")),
    );
    const call =
      operation === "upload"
        ? service.uploadPrivateDocument(fixture())
        : operation === "download"
          ? service.streamPrivateDocument(key)
          : operation === "delete"
            ? service.deletePrivateDocument(key)
            : service.privateDocumentExists(key);
    await expect(call).rejects.toThrow("Document storage is unavailable");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret endpoint");
  });
  it("handles a missing object and existence recovery", async () => {
    send.mockImplementation(command =>
      command instanceof GetObjectAclCommand || command instanceof HeadObjectCommand ? Promise.reject(missing("NoSuchKey")) : successful(command),
    );
    await expect(service.streamPrivateDocument(key)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.privateDocumentExists(key)).resolves.toBe(false);
  });
  it("rejects public object ACL before opening its body", async () => {
    send.mockImplementation(command =>
      command instanceof GetObjectAclCommand ? Promise.resolve({ ...acl, Grants: [{ Grantee: { Type: "Group" }, Permission: "READ" }] }) : successful(command),
    );
    await expect(service.streamPrivateDocument(key)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(send.mock.calls.some(([command]) => command instanceof GetObjectCommand)).toBe(false);
  });
  it("destroys a body rejected by metadata validation", async () => {
    const body = new Readable({ read() {} });
    send.mockImplementation(command => (command instanceof GetObjectCommand ? Promise.resolve({ Body: body, ContentType: "text/html", ContentLength: 1 }) : successful(command)));
    await expect(service.streamPrivateDocument(key)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(body.destroyed).toBe(true);
  });

  it.each([
    ["negative", -1],
    ["negative infinity", -Infinity],
    ["fractional", 1.5],
    ["NaN", NaN],
    ["infinity", Infinity],
    ["zero", 0],
    ["undefined", undefined],
    ["oversized", STUDENT_DOCUMENT_MAX_BYTES + 1],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s Content-Length before piping and closes upstream", async (_name, contentLength) => {
    const read = jest.fn();
    const body = new Readable({ read });
    const pipe = jest.spyOn(body, "pipe");
    const closed = new Promise(resolve => body.once("close", resolve));
    send.mockImplementation(command =>
      command instanceof GetObjectCommand ? Promise.resolve({ Body: body, ContentType: "application/pdf", ContentLength: contentLength }) : successful(command),
    );
    await expect(service.streamPrivateDocument(key)).rejects.toThrow(new ServiceUnavailableException("Document storage is unavailable"));
    await closed;
    expect(body.destroyed).toBe(true);
    expect(body.closed).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(pipe).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("Invalid object metadata");
  });

  it.each([1, STUDENT_DOCUMENT_MAX_BYTES])("streams a valid integer Content-Length of %i with exact bytes", async size => {
    const bytes = Buffer.alloc(size, 42);
    const body = Readable.from(bytes);
    send.mockImplementation(command =>
      command instanceof GetObjectCommand ? Promise.resolve({ Body: body, ContentType: "application/pdf", ContentLength: size }) : successful(command),
    );
    const result = await service.streamPrivateDocument(key);
    expect(result.size).toBe(size);
    expect(result.contentType).toBe("application/pdf");
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(body.readableEnded).toBe(true);
    expect(body.destroyed).toBe(true);
  });

  it("preserves backpressure until the consumer reads", async () => {
    let produced = 0;
    const body = new Readable({
      read() {
        const size = Math.min(16 * 1024, STUDENT_DOCUMENT_MAX_BYTES - produced);
        if (!size) return void this.push(null);
        produced += size;
        this.push(Buffer.alloc(size));
      },
    });
    send.mockImplementation(command =>
      command instanceof GetObjectCommand ? Promise.resolve({ Body: body, ContentType: "application/pdf", ContentLength: STUDENT_DOCUMENT_MAX_BYTES }) : successful(command),
    );
    const { stream } = await service.streamPrivateDocument(key);
    await new Promise(resolve => setImmediate(resolve));
    const pausedAt = produced;
    await new Promise(resolve => setImmediate(resolve));
    expect(pausedAt).toBeGreaterThan(0);
    expect(pausedAt).toBeLessThan(STUDENT_DOCUMENT_MAX_BYTES);
    expect(produced).toBe(pausedAt);
    const closed = new Promise(resolve => body.once("close", resolve));
    stream.destroy();
    await closed;
    expect(body.destroyed).toBe(true);
  });

  it("sanitizes premature upstream closure before completion", async () => {
    const body = new Readable({
      read() {
        this.destroy();
      },
    });
    send.mockImplementation(command =>
      command instanceof GetObjectCommand ? Promise.resolve({ Body: body, ContentType: "application/pdf", ContentLength: 100 }) : successful(command),
    );
    const { stream } = await service.streamPrivateDocument(key);
    await expect(
      (async () => {
        for await (const chunk of stream) void chunk;
      })(),
    ).rejects.toThrow("Document storage is unavailable");
    expect(body.destroyed).toBe(true);
  });
  it("sanitizes asynchronous stream errors and releases upstream", async () => {
    const body = new Readable({
      read() {
        this.destroy(new Error("secret endpoint"));
      },
    });
    send.mockImplementation(command =>
      command instanceof GetObjectCommand ? Promise.resolve({ Body: body, ContentType: "application/pdf", ContentLength: 100 }) : successful(command),
    );
    const { stream } = await service.streamPrivateDocument(key);
    await expect(
      (async () => {
        for await (const chunk of stream) void chunk;
      })(),
    ).rejects.toThrow("Document storage is unavailable");
    expect(body.destroyed).toBe(true);
  });
  it("releases upstream on consumer cancellation", async () => {
    const body = new Readable({ read() {} });
    send.mockImplementation(command =>
      command instanceof GetObjectCommand ? Promise.resolve({ Body: body, ContentType: "application/pdf", ContentLength: 100 }) : successful(command),
    );
    const { stream } = await service.streamPrivateDocument(key);
    stream.destroy();
    await new Promise(resolve => stream.once("close", resolve));
    expect(body.destroyed).toBe(true);
  });
});
