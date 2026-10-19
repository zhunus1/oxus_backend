import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { MinioService } from "../src/common/utils/minio/minio.service";

describe("Application (e2e)", () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    else await moduleFixture?.close();
  });

  it("GET /api/v1/health checks the real PostgreSQL connection", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health").expect(200).expect("Content-Type", /json/);
    expect(response.body).toEqual({
      status: "ok",
      info: { database: { status: "up" } },
      error: {},
      details: { database: { status: "up" } },
    });
  });

  it("GET / has no starter Hello World endpoint", () => {
    return request(app.getHttpServer()).get("/").expect(404);
  });

  it("initializes the real MinIO transport and bucket", async () => {
    const minio = app.get(MinioService);
    const result = await minio.getS3Client().send(new HeadBucketCommand({ Bucket: minio.getBucketName() }));
    expect(result.$metadata.httpStatusCode).toBe(200);
  });

  it("connects the real BullMQ queue to Redis", async () => {
    const client = await app.get<Queue>(getQueueToken("mail")).client;
    await expect(client.ping()).resolves.toBe("PONG");
  });
});
