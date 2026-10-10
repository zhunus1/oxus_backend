import { Controller, Get, Req, Res, UseGuards, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { Response } from "express";
import { PrismaService } from "src/database/prisma.service";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { corsOptions, validateCorsOrigin } from "./cors-origin";

describe("validateCorsOrigin", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOrigins = process.env.CORS_ORIGINS;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = originalOrigins;
  });

  it("allows an explicitly configured browser origin", () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = "https://test.oxusedu.com";
    const callback = jest.fn();
    validateCorsOrigin("https://test.oxusedu.com", callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it("fails closed for browser origins when production has no allow-list", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ORIGINS;
    const callback = jest.fn();
    validateCorsOrigin("https://attacker.example", callback);
    expect(callback).toHaveBeenCalledWith(expect.any(Error), false);
  });

  it("allows requests without an Origin header for server-to-server clients", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ORIGINS;
    const callback = jest.fn();
    validateCorsOrigin(undefined, callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });
});

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

const origin = "https://crm.example.test";
const bytes = Buffer.from("%PDF-1.7\n%%EOF\n");
const findUnique = jest.fn();

@Controller("file")
@UseGuards(JwtAuthGuard)
class CorsFileController {
  @Get()
  download(@Req() req: UserRequest, @Res() res: Response) {
    if (!req.user.id) throw new Error("Authenticated actor required");
    return res.type("application/pdf").attachment("document-901.pdf").send(bytes);
  }
}

describe("configured CORS middleware and unchanged JWT selection", () => {
  let app: INestApplication;
  const previous = { NODE_ENV: process.env.NODE_ENV, CORS_ORIGINS: process.env.CORS_ORIGINS, JWT_SECRET: process.env.JWT_SECRET };
  const jwt = new JwtService();
  const secret = "local-cors-regression-synthetic-secret";
  const token = (id: number, expiresIn: number = 300) => jwt.sign({ id, sub: id, roleCode: "ADMIN" }, { secret, expiresIn });

  beforeAll(async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = origin;
    process.env.JWT_SECRET = secret;
    const mod = await Test.createTestingModule({
      controllers: [CorsFileController],
      providers: [JwtAuthGuard, { provide: JwtService, useValue: jwt }, { provide: PrismaService, useValue: { user: { findUnique } } }],
    }).compile();
    app = mod.createNestApplication({ logger: false });
    app.enableCors(corsOptions);
    app.use(cookieParser());
    await app.listen(0, "127.0.0.1");
  });

  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockResolvedValue({ deletedAt: null, role: { code: "ADMIN", deletedAt: null, permissions: [] } });
  });

  afterAll(async () => {
    await app?.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("exposes only Content-Disposition for an allowed credentialed binary request", async () => {
    const out = await request(app.getHttpServer())
      .get("/file")
      .set("Origin", origin)
      .set("Authorization", `Bearer ${token(11)}`)
      .expect(200);
    expect(out.headers["access-control-allow-origin"]).toBe(origin);
    expect(out.headers["access-control-allow-credentials"]).toBe("true");
    expect(out.headers["access-control-expose-headers"]).toBe("Content-Disposition");
    expect(out.headers["content-disposition"]).toBe('attachment; filename="document-901.pdf"');
    expect(out.headers["content-type"]).toBe("application/pdf");
    expect(Number(out.headers["content-length"])).toBe(bytes.length);
    expect(out.body).toEqual(bytes);
  });

  it("preserves exact Authorization preflight methods/headers and credentials without wildcard", async () => {
    const out = await request(app.getHttpServer())
      .options("/file")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization")
      .expect(204);
    expect(out.headers["access-control-allow-origin"]).toBe(origin);
    expect(out.headers["access-control-allow-credentials"]).toBe("true");
    expect(out.headers["access-control-allow-methods"]).toBe("GET,POST,PATCH,PUT,DELETE,OPTIONS");
    expect(out.headers["access-control-allow-headers"]).toBe("Content-Type,Authorization");
    expect(out.headers["access-control-expose-headers"]).toBe("Content-Disposition");
    expect(out.headers.vary).toContain("Origin");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects unlisted origins before authentication and returns no CORS permission headers", async () => {
    const out = await request(app.getHttpServer())
      .get("/file")
      .set("Origin", "https://unapproved.example.test")
      .set("Authorization", `Bearer ${token(11)}`)
      .expect(500);
    expect(out.headers["access-control-allow-origin"]).toBeUndefined();
    expect(out.headers["access-control-expose-headers"]).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("retains origin-free Bearer requests without synthesizing wildcard allow-origin", async () => {
    const out = await request(app.getHttpServer())
      .get("/file")
      .set("Authorization", `Bearer ${token(11)}`)
      .expect(200);
    expect(out.headers["access-control-allow-origin"]).toBeUndefined();
    expect(findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 11 } }));
  });

  it("keeps missing-JWT requests unauthorized even when CORS allows the origin", async () => {
    const out = await request(app.getHttpServer()).get("/file").set("Origin", origin).expect(401);
    expect(out.headers["access-control-expose-headers"]).toBe("Content-Disposition");
    expect(out.headers["content-disposition"]).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("continues to accept cookie-only authentication", async () => {
    await request(app.getHttpServer())
      .get("/file")
      .set("Origin", origin)
      .set("Cookie", `accessToken=${token(22)}`)
      .expect(200);
    expect(findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 22 } }));
  });

  it("preserves access-cookie priority over a different-account Bearer", async () => {
    await request(app.getHttpServer())
      .get("/file")
      .set("Origin", origin)
      .set("Cookie", `accessToken=${token(22)}`)
      .set("Authorization", `Bearer ${token(11)}`)
      .expect(200);
    expect(findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 22 } }));
  });

  it("does not fall back to valid Bearer when an access cookie is expired", async () => {
    await request(app.getHttpServer())
      .get("/file")
      .set("Origin", origin)
      .set("Cookie", `accessToken=${token(22, -10)}`)
      .set("Authorization", `Bearer ${token(11)}`)
      .expect(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("still rejects a disabled current DB role despite a valid ADMIN claim", async () => {
    findUnique.mockResolvedValue({ deletedAt: null, role: { code: "ADMIN", deletedAt: new Date(), permissions: [] } });
    await request(app.getHttpServer())
      .get("/file")
      .set("Origin", origin)
      .set("Authorization", `Bearer ${token(11)}`)
      .expect(403);
  });
});
