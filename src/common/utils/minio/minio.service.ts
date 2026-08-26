import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, PutBucketPolicyCommand } from "@aws-sdk/client-s3";
import { HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class MinioService implements OnModuleInit {
  private static bucketInitialized = false;
  private s3Client: S3Client;
  private bucketName: string;
  private minioEndpoint: string;
  private readonly logger = new Logger(MinioService.name);

  async onModuleInit() {
    if (!MinioService.bucketInitialized) {
      MinioService.bucketInitialized = true;

      if (!this.bucketName) {
        this.logger.error("AWS_S3_BUCKET_NAME (или AWS_BUCKET_NAME) не задан в .env");
        throw new Error("Minio bucket name is not configured");
      }

      try {
        await this.ensureBucketExists();
        this.logger.log(`✅ Bucket '${this.bucketName}' is ready.`);
      } catch (err) {
        this.logger.error(`❌ Failed to ensure bucket exists: ${err.message}`);
      }
    }
  }

  constructor(private readonly configService: ConfigService) {
    this.bucketName = this.configService.get<string>("AWS_BUCKET_NAME")!;

    this.s3Client = new S3Client({
      region: "us-east-1",
      endpoint: this.configService.get<string>("AWS_MINIO_ENDPOINT")!,
      credentials: {
        accessKeyId: this.configService.get<string>("AWS_ACCESS_KEY_ID")!,
        secretAccessKey: this.configService.get<string>("AWS_SECRET_ACCESS_KEY")!,
      },
      forcePathStyle: true,
    });

    this.minioEndpoint = this.configService.get<string>("AWS_MINIO_PUBLIC_URL") || "http://localhost:9000";
  }
  private async ensureBucketExists(): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      this.logger.log(`Bucket '${this.bucketName}' already exists. ${new Date().toString()}`);
    } catch (err) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        this.logger.warn(`Bucket '${this.bucketName}' not found. Creating...`);
        await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
        this.logger.log(`Bucket '${this.bucketName}' created.`);

        const publicPolicy = {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["s3:GetObject"],
              Resource: [`arn:aws:s3:::${this.bucketName}/*`],
              Principal: "*",
            },
          ],
        };
        await this.s3Client.send(
          new PutBucketPolicyCommand({
            Bucket: this.bucketName,
            Policy: JSON.stringify(publicPolicy),
          }),
        );

        this.logger.log(`Public read policy applied to bucket '${this.bucketName}'.`);
      } else {
        throw err;
      }
    }
  }

  async uploadFile(dirName: string, buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    const fileKey = `${dirName}/${filename}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      Body: buffer,
      ContentType: mimeType,
    });

    await this.s3Client.send(command);

    return `${this.minioEndpoint}/${this.bucketName}/${fileKey}`;
  }
  async deleteUnusedObjectsFromMinio(prefix: string, usedKeys: Set<string>): Promise<void> {
    const listed = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      }),
    );

    if (!listed.Contents || listed.Contents.length === 0) {
      this.logger.log(`ℹ️ No files found in folder "${prefix}".`);
      return;
    }

    let deletedCount = 0;

    for (const object of listed.Contents) {
      const key = object.Key!;
      if (!usedKeys.has(key)) {
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          }),
        );
        deletedCount++;
        this.logger.log(`🗑️ Deleted unused file: ${key}`);
      }
    }

    this.logger.log(`✅ Cleanup complete. Deleted ${deletedCount} unused images from '${prefix}'.`);
  }
  getBucketName(): string {
    return this.bucketName;
  }

  async deleteOldObjects(prefix: string, olderThanDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    let token: string | undefined = undefined;
    let deletedCount = 0;

    do {
      const listed = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );

      const contents = listed.Contents ?? [];
      for (const obj of contents) {
        const key = obj.Key;
        const lastModified = obj.LastModified;

        if (!key || !lastModified) continue;

        if (lastModified < cutoff) {
          await this.s3Client.send(
            new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: key,
            }),
          );
          deletedCount++;
          this.logger.log(`🗑️ Deleted old export: ${key}`);
        }
      }

      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);

    this.logger.log(`✅ Old exports cleanup complete. Deleted ${deletedCount} objects for prefix='${prefix}'.`);
  }
}
