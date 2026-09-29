import { BadRequestException, ConflictException, Injectable, NotFoundException, StreamableFile } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { PrismaService } from "src/database/prisma.service";
import { leadTransaction } from "src/modules/lead/domain/lead-transaction";
import { ownedContract } from "../domain/manual-contract-confirmation";
import { assertContractAccess, assertStudentContractRead } from "../domain/contract-access";

/** Paper contracts contain personal data; use a separate private bucket and authenticated downloads. */
@Injectable()
export class ContractScanService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.bucket = `${config.getOrThrow<string>("AWS_BUCKET_NAME")}-contracts`;
    this.client = new S3Client({
      region: "us-east-1",
      endpoint: config.getOrThrow<string>("AWS_MINIO_ENDPOINT"),
      forcePathStyle: true,
      credentials: { accessKeyId: config.getOrThrow<string>("AWS_ACCESS_KEY_ID"), secretAccessKey: config.getOrThrow<string>("AWS_SECRET_ACCESS_KEY") },
    });
  }

  async upload(id: string, actorId: number, file: Express.Multer.File, isAdmin = false) {
    const signature = file?.buffer?.subarray(0, 8);
    const mime =
      signature?.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : signature?.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
          ? "image/jpeg"
          : signature?.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : null;
    if (!mime || mime !== file.mimetype || file.buffer.length > 10 * 1024 * 1024) throw new BadRequestException("Upload a PDF, JPEG or PNG scan up to 10 MB");
    const assertSigned = async (tx: Parameters<typeof ownedContract>[0]) => {
      const result = await ownedContract(tx, id, actorId, isAdmin);
      if (!["SIGNED", "PAID"].includes(result.contract.status)) throw new ConflictException("Attach scans after contract confirmation");
      return result.contract;
    };
    await assertSigned(this.prisma);
    await this.ensureBucket();
    const key = `${id}/${randomUUID()}`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: file.buffer, ContentType: mime }));
    // Recheck ownership after external I/O; never perform object-store writes inside a retrying transaction.
    return leadTransaction(this.prisma, async tx => {
      const contract = await assertSigned(tx);
      await tx.auditLog.create({
        data: {
          userId: actorId,
          entityType: "User",
          entityId: contract.studentId,
          action: "CONTRACT_SCAN_UPLOADED",
          details: { contractId: id, previousKey: contract.scanFileKey, key },
        },
      });
      await tx.contract.update({ where: { id }, data: { scanFileKey: key } });
      return { contractId: id, hasScan: true };
    });
  }

  async download(id: string, actorId: number) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) throw new NotFoundException("Contract not found");
    if (contract.studentId !== actorId) {
      await assertContractAccess(this.prisma, id, actorId);
    } else await assertStudentContractRead(this.prisma, actorId, id);
    if (!contract.scanFileKey) throw new NotFoundException("Contract scan has not been uploaded");
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: contract.scanFileKey }));
    if (!result.Body) throw new NotFoundException("Contract scan not found");
    return new StreamableFile(Buffer.from(await result.Body.transformToByteArray()), {
      type: result.ContentType ?? "application/octet-stream",
      disposition: 'attachment; filename="contract-scan"',
    });
  }

  private async ensureBucket() {
    if (this.bucketReady) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (error.$metadata?.httpStatusCode !== 404 && error.name !== "NotFound") throw error;
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (error) {
        if (error.name !== "BucketAlreadyOwnedByYou") throw error;
      }
    }
    this.bucketReady = true;
  }
}
