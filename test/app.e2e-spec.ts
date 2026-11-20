import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { MinioService } from "../src/common/utils/minio/minio.service";
import { PrismaService } from "../src/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import axios from "axios";

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

  it("keeps Wazzup disabled by default for valid ADMIN and Sales requests without external API calls", async () => {
    expect(process.env.WAZZUP_ENABLED).toBeUndefined();
    const prisma = app.get(PrismaService);
    const jwt = new JwtService();
    const permission = "SALES_LEADS_MANAGE_OWN";
    await prisma.permission.upsert({ where: { code: permission }, create: { code: permission, name: permission }, update: {} });
    const actors: { id: number }[] = [];
    for (const code of ["ADMIN", "SALES_MANAGER"]) {
      const permissions = code === "SALES_MANAGER" ? { permissions: { connect: { code: permission } } } : {};
      await prisma.role.upsert({ where: { code }, create: { code, name: code, ...permissions }, update: permissions });
      actors.push(
        await prisma.user.create({ data: { firstname: "Disabled", lastname: "Fixture", email: `${randomUUID()}@example.test`, password: "unused", role: { connect: { code } } } }),
      );
    }
    const source = await prisma.leadSource.create({ data: { code: randomUUID(), name: "Disabled Wazzup fixture" } });
    const lead = await prisma.lead.create({ data: { originSourceId: source.id, assignedSalesManagerId: actors[1].id, acceptedAt: new Date(), phoneNumber: "+12025550100" } });
    const external = jest.spyOn(axios, "request").mockRejectedValue(new Error("Unexpected external API call"));
    try {
      for (const actor of actors) {
        const token = jwt.sign({ sub: actor.id }, { secret: process.env.JWT_SECRET });
        for (const path of ["iframe", `leads/${lead.id}/iframe`]) {
          const result = await request(app.getHttpServer()).post(`/api/v1/integrations/wazzup/${path}`).set("Authorization", `Bearer ${token}`).expect(503);
          expect(result.body).toEqual({ code: "WAZZUP_NOT_CONFIGURED", message: "Wazzup is not configured" });
          expect(result.body.url).toBeUndefined();
        }
      }
      const token = jwt.sign({ sub: actors[0].id }, { secret: process.env.JWT_SECRET });
      await request(app.getHttpServer()).get("/api/v1/integrations/wazzup/channels").set("Authorization", `Bearer ${token}`).expect(503);
      expect(external).not.toHaveBeenCalled();
    } finally {
      external.mockRestore();
    }
  });
});
