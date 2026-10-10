import { InternalServerErrorException, Logger } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { AuditLogService } from "./audit-log.service";
import type { AuditLogRepository } from "../repository/audit-log.repository";

jest.mock("generated/prisma/client", () => ({ Prisma: { PrismaClientKnownRequestError: jest.requireActual("@prisma/client/runtime/client").PrismaClientKnownRequestError } }));
jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("AuditLogService transaction error propagation", () => {
  const create = jest.fn();
  const service = new AuditLogService({ create } as unknown as AuditLogRepository);
  const conflict = new Prisma.PrismaClientKnownRequestError("Injected serialization conflict", { code: "P2034", clientVersion: "test" });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("preserves the original P2034 for the transaction caller without retrying", async () => {
    const txCreate = jest.fn().mockRejectedValue(conflict);
    const tx = { auditLog: { create: txCreate } } as unknown as Prisma.TransactionClient;
    await expect(service.log(1, "DOCUMENT_REVIEW", "Document", 2, undefined, tx)).rejects.toBe(conflict);
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([new Error("Unknown audit failure"), new Prisma.PrismaClientKnownRequestError("Other Prisma error", { code: "P2003", clientVersion: "test" })])(
    "keeps non-conflict transaction failures as 500: %s",
    async error => {
      const tx = { auditLog: { create: jest.fn().mockRejectedValue(error) } } as unknown as Prisma.TransactionClient;
      await expect(service.log(1, "DOCUMENT_REVIEW", "Document", 2, undefined, tx)).rejects.toBeInstanceOf(InternalServerErrorException);
    },
  );

  it("preserves the non-transaction P2034 response", async () => {
    create.mockRejectedValue(conflict);
    await expect(service.log(1, "OTHER_ACTION", "Document", 2)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
