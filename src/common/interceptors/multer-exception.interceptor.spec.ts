import { Controller, ExecutionContext, INestApplication, Post, UseInterceptors } from "@nestjs/common";
import { FileInterceptor, NoFilesInterceptor } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { createRequire } from "node:module";
import multer, { MulterError } from "multer";
import request from "supertest";
import { lastValueFrom, throwError } from "rxjs";
import { MulterExceptionInterceptor } from "./multer-exception.interceptor";

// Exercise the dependency's callback error path without a crash-inducing payload.
jest.mock("append-field", () => {
  const append = jest.requireActual<(body: object, name: string, value: string) => void>("append-field");
  return (body: object, name: string, value: string) => {
    if (name === "syntheticParserFailure") throw new TypeError("synthetic internal diagnostic");
    append(body, name, value);
  };
});

let operations = 0;
@Controller()
class ParserController {
  @Post("file")
  @UseInterceptors(MulterExceptionInterceptor, FileInterceptor("file"))
  file() {
    operations++;
    return { ok: true };
  }

  @Post("fields")
  @UseInterceptors(MulterExceptionInterceptor, NoFilesInterceptor())
  fields() {
    operations++;
    return { ok: true };
  }
}

describe("Multer dependency error compatibility", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [ParserController] }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it("Nest and the application resolve the same fixed parser", () => {
    const nestRequire = createRequire(require.resolve("@nestjs/platform-express/package.json"));
    expect(nestRequire("multer")).toBe(multer);
    expect(nestRequire("multer/package.json").version).toBe("2.4.0");
  });

  for (const route of ["file", "fields"]) {
    for (const fileFirst of [false, true]) {
      it(`${route}: append-field exception becomes a safe 400 (${fileFirst ? "file" : "fields"} first)`, async () => {
        const before = operations;
        const req = request(app.getHttpServer()).post(`/${route}`);
        if (route === "file" && fileFirst) req.attach("file", Buffer.from("small"), "small.txt");
        req.field("syntheticParserFailure", "small");
        if (route === "file" && !fileFirst) req.attach("file", Buffer.from("small"), "small.txt");
        const response = await req.expect(400);
        expect(response.body).toEqual({ statusCode: 400, message: "Invalid multipart input", error: "Bad Request" });
        expect(operations).toBe(before);
        await request(app.getHttpServer()).post(`/${route}`).field("ordinary", "small").expect(201);
      });
    }
  }

  it("renamed unexpected-file error preserves HTTP 400 and the prior public message", async () => {
    const before = operations;
    const response = await request(app.getHttpServer()).post("/file").attach("other", Buffer.from("small"), "small.txt").expect(400);
    expect(response.body.message).toBe("Unexpected field - other");
    expect(operations).toBe(before);
  });

  for (const code of ["INVALID_FIELD_NAME", "LIMIT_FIELD_NESTING", "LIMIT_FIELD_ARRAY_INDEX", "STREAM_DESTROYED"]) {
    it(`${code} has a safe public response and retains its diagnostic cause`, async () => {
      const error = new MulterError(code as MulterError["code"], "internal field");
      const response = new MulterExceptionInterceptor().intercept({} as ExecutionContext, { handle: () => throwError(() => error) });
      await expect(lastValueFrom(response)).rejects.toMatchObject({ cause: error, status: 400, message: "Invalid multipart input" });
    });
  }

  for (const error of [new Error("business failure"), new MulterError("LIMIT_FILE_SIZE"), new MulterError("LIMIT_FIELD_COUNT")]) {
    it(`leaves ${error.message} to existing Nest handling and diagnostics`, async () => {
      const response = new MulterExceptionInterceptor().intercept({} as ExecutionContext, { handle: () => throwError(() => error) });
      await expect(lastValueFrom(response)).rejects.toBe(error);
    });
  }
});
