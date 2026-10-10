import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { ServiceUnavailableException } from "@nestjs/common";
import { DocumentController } from "./document.controller";
import type { DocumentService } from "../service/document.service";
import type { StudentPortraitService } from "src/modules/studentportrait/service/studentportrait.service";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import type { Response } from "express";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("generated/prisma/client", () => ({ RequirementType: { PASSPORT: "PASSPORT" }, DocumentStatus: { APPROVED: "APPROVED", NEEDS_REVISION: "NEEDS_REVISION" } }));
jest.mock("../service/document.service", () => ({ DocumentService: class {} }));
jest.mock("src/modules/studentportrait/service/studentportrait.service", () => ({ StudentPortraitService: class {} }));

describe("bounded private document HTTP streaming", () => {
  afterEach(() => {
    jest.useRealTimers();
  });
  const response = () => {
    const res = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      headersSent: false,
      removeHeader: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
      destroy: jest.fn(),
    });
    res.status.mockReturnValue(res);
    res.json.mockImplementation(() => {
      res.writableEnded = true;
      res.emit("finish");
      return res;
    });
    res.destroy.mockImplementation(() => {
      res.destroyed = true;
      res.emit("close");
    });
    return res;
  };
  it("times out pending metadata, aborts its request and emits only a safe 503", async () => {
    jest.useFakeTimers();
    const res = response();
    const req = Object.assign(new EventEmitter(), { user: { id: 1 }, aborted: false });
    let signal: AbortSignal | undefined;
    const download = jest.fn(
      (_user, _id, passed: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = passed;
          passed.addEventListener("abort", () => reject(new ServiceUnavailableException("Document storage is unavailable")));
        }),
    );
    const controller = new DocumentController({ download } as unknown as DocumentService, {} as StudentPortraitService);
    const pending = controller.download(req as unknown as UserRequest, 2, res as unknown as Response);
    jest.advanceTimersByTime(30_000);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 503, message: "Document storage is unavailable" });
    expect(req.listenerCount("aborted")).toBe(0);
    expect(res.listenerCount("close")).toBe(0);
  });
  it("destroys a late response body if the client disconnected during metadata lookup", async () => {
    const res = response();
    const req = Object.assign(new EventEmitter(), { user: { id: 1 }, aborted: false });
    let resolve!: (result: unknown) => void;
    const download = jest.fn(
      () =>
        new Promise(r => {
          resolve = r;
        }),
    );
    const controller = new DocumentController({ download } as unknown as DocumentService, {} as StudentPortraitService);
    const pending = controller.download(req as unknown as UserRequest, 2, res as unknown as Response);
    res.destroy();
    const body = new Readable({ read() {} });
    resolve({ stream: body, contentType: "application/pdf", size: 1 });
    await pending;
    expect(body.destroyed).toBe(true);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
