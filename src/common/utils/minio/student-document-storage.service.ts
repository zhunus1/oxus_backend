import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetBucketAclCommand,
  GetBucketPolicyCommand,
  GetObjectAclCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { GetBucketAclCommandOutput } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { MinioService } from "./minio.service";
import { isStudentDocumentMime, STUDENT_DOCUMENT_MAX_BYTES, validateStudentDocumentFile } from "./student-document-file";

export const STUDENT_DOCUMENT_KEY_PATTERN = /^documents\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

@Injectable()
export class StudentDocumentStorageService {
  private readonly logger = new Logger(StudentDocumentStorageService.name);
  private bucketCheck?: Promise<void>;

  constructor(private readonly minio: MinioService) {}

  private get bucket(): string {
    const base = this.minio.getBucketName();
    const bucket = `${base}-student-documents`;
    if (!base || bucket.length > 63 || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) || bucket.includes("..")) throw this.failure("configuration");
    return bucket;
  }

  private failure(operation: string): ServiceUnavailableException {
    // Never log SDK messages/stack/input: these can contain endpoints, keys or credentials.
    this.logger.error(`Student document storage operation failed: ${operation}`);
    return new ServiceUnavailableException("Document storage is unavailable");
  }

  private assertKey(key: string): void {
    if (typeof key !== "string" || key.length !== 46 || !STUDENT_DOCUMENT_KEY_PATTERN.test(key)) throw new BadRequestException("Invalid document storage key");
  }

  private assertPrivateAcl(acl: Pick<GetBucketAclCommandOutput, "Owner" | "Grants">): void {
    // MinIO returns an empty Owner and exactly one canonical FULL_CONTROL grant:
    // its ACL API is a compatibility stub; non-private ACL writes are unsupported.
    // Accept only this exact stub shape, or an explicitly owner-only S3 ACL.
    const minioPrivateAcl =
      acl.Owner &&
      !acl.Owner.ID &&
      !acl.Owner.DisplayName &&
      acl.Grants?.length === 1 &&
      acl.Grants[0].Permission === "FULL_CONTROL" &&
      acl.Grants[0].Grantee?.Type === "CanonicalUser" &&
      !acl.Grants[0].Grantee.ID &&
      !acl.Grants[0].Grantee.DisplayName &&
      !acl.Grants[0].Grantee.URI;
    if (minioPrivateAcl) return;
    if (!acl.Owner?.ID || !acl.Grants?.length) throw new Error("Unverifiable ACL");
    if (acl.Grants.some(grant => grant.Grantee?.Type !== "CanonicalUser" || grant.Grantee.ID !== acl.Owner?.ID || grant.Permission !== "FULL_CONTROL")) {
      throw new Error("Non-owner ACL");
    }
  }

  /** Concurrent callers share only the current check; later operations always reverify policy/ACL. */
  async ensurePrivateBucket(): Promise<void> {
    if (this.bucketCheck) return this.bucketCheck;
    const check = this.verifyBucket();
    this.bucketCheck = check;
    try {
      await check;
    } finally {
      if (this.bucketCheck === check) this.bucketCheck = undefined;
    }
  }

  private async verifyBucket(): Promise<void> {
    try {
      const Bucket = this.bucket;
      const client = this.minio.getS3Client();
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch (error) {
        if (error.$metadata?.httpStatusCode !== 404) throw error;
        try {
          await client.send(new CreateBucketCommand({ Bucket }));
        } catch (error) {
          if (error.name !== "BucketAlreadyOwnedByYou") throw error;
        }
      }
      try {
        const { Policy } = await client.send(new GetBucketPolicyCommand({ Bucket }));
        const policy = JSON.parse(Policy ?? "null") as { Statement?: { Effect?: string }[] } | null;
        // Deliberately conservative: reject all grants, including conditional/authenticated grants.
        if (!policy || !Array.isArray(policy.Statement) || policy.Statement.some(statement => statement?.Effect !== "Deny")) throw new Error("Unverifiable policy");
      } catch (error) {
        // AccessDenied, unsupported API, malformed output and generic 404 are not evidence of privacy.
        if (error.name !== "NoSuchBucketPolicy" || error.$metadata?.httpStatusCode !== 404) throw error;
      }
      this.assertPrivateAcl(await client.send(new GetBucketAclCommand({ Bucket })));
    } catch {
      throw this.failure("bucket privacy verification");
    }
  }

  async uploadPrivateDocument(file: Pick<Express.Multer.File, "buffer" | "size" | "mimetype"> | undefined) {
    const validated = validateStudentDocumentFile(file);
    // Own the bytes across asynchronous I/O; callers cannot mutate the validated buffer mid-upload.
    const body = Buffer.from(validated.buffer);
    await this.ensurePrivateBucket();
    const fileKey = `documents/${randomUUID()}`;
    try {
      await this.minio.getS3Client().send(new PutObjectCommand({ Bucket: this.bucket, Key: fileKey, Body: body, ContentType: validated.contentType, IfNoneMatch: "*" }));
      return { fileKey, contentType: validated.contentType, size: validated.size };
    } catch {
      throw this.failure("upload");
    }
  }

  /** Caller owns the returned stream and must destroy it if the consumer disconnects. */
  async streamPrivateDocument(key: string) {
    this.assertKey(key);
    await this.ensurePrivateBucket();
    let body: Readable | undefined;
    try {
      const client = this.minio.getS3Client();
      this.assertPrivateAcl(await client.send(new GetObjectAclCommand({ Bucket: this.bucket, Key: key })));
      const result = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (result.Body instanceof Readable) body = result.Body;
      const size = result.ContentLength;
      if (!body || !isStudentDocumentMime(result.ContentType) || typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > STUDENT_DOCUMENT_MAX_BYTES)
        throw new Error("Invalid object metadata");
      const stream = new PassThrough();
      body.once("error", () => stream.destroy(this.failure("stream")));
      body.once("close", () => {
        if (!body?.readableEnded && !stream.destroyed) stream.destroy(this.failure("incomplete stream"));
      });
      stream.once("close", () => body?.destroy());
      body.pipe(stream);
      return { stream, contentType: result.ContentType, size };
    } catch (error) {
      body?.destroy();
      if (error.name === "NoSuchKey" || error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) throw new NotFoundException("Document file not found");
      throw this.failure("download");
    }
  }

  async deletePrivateDocument(key: string): Promise<void> {
    this.assertKey(key);
    await this.ensurePrivateBucket();
    try {
      await this.minio.getS3Client().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      throw this.failure("delete");
    }
  }

  async privateDocumentExists(key: string): Promise<boolean> {
    this.assertKey(key);
    await this.ensurePrivateBucket();
    try {
      await this.minio.getS3Client().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404) return false;
      throw this.failure("existence check");
    }
  }
}
