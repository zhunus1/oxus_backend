import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand, PutBucketPolicyCommand } from "@aws-sdk/client-s3";

const bucketName = process.env.AWS_BUCKET_NAME!;
const endpoint = process.env.AWS_MINIO_ENDPOINT!;
const publicUrl = process.env.AWS_MINIO_PUBLIC_URL || "http://localhost:9000";

const s3Client = new S3Client({
  region: "us-east-1",
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
});

async function ensureBucketExists() {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (err: any) {
    if (err.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));

      const publicPolicy = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
            Principal: "*",
          },
        ],
      };

      await s3Client.send(
        new PutBucketPolicyCommand({
          Bucket: bucketName,
          Policy: JSON.stringify(publicPolicy),
        }),
      );
    } else {
      throw err;
    }
  }
}

export async function uploadSeedFile(dirName: string, buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  await ensureBucketExists();

  const fileKey = `${dirName}/${filename}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      Body: buffer,
      ContentType: mimeType,
    }),
  );

  return `${publicUrl}/${bucketName}/${fileKey}`;
}
