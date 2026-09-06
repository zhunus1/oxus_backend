import { ConflictException } from "@nestjs/common";
import type { PrismaService } from "src/database/prisma.service";
import { leadTransaction } from "./lead-transaction";

jest.mock("generated/prisma/client", () => ({ Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } } }));
jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("leadTransaction", () => {
  it.each(["P2034", "P2002"])("retries a rolled-back %s conflict and returns the committed result", async code => {
    const tx = {};
    const operation = jest.fn().mockRejectedValueOnce({ code }).mockResolvedValue("committed");
    const $transaction = jest.fn().mockImplementation(fn => fn(tx));
    await expect(leadTransaction({ $transaction } as unknown as PrismaService, operation)).resolves.toBe("committed");
    expect(operation).toHaveBeenCalledTimes(2);
    expect($transaction).toHaveBeenLastCalledWith(operation, { isolationLevel: "Serializable" });
  });

  it.each(["P2034", "P2002"])("bounds %s retries and returns HTTP 409 on exhaustion", async code => {
    const $transaction = jest.fn().mockRejectedValue({ code });
    await expect(leadTransaction({ $transaction } as unknown as PrismaService, jest.fn())).rejects.toBeInstanceOf(ConflictException);
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it.each([new Error("Connection failed"), new ConflictException("Contract already exists"), null])(
    "preserves non-retryable errors without rerunning the operation",
    async error => {
      const $transaction = jest.fn().mockRejectedValue(error);
      await expect(leadTransaction({ $transaction } as unknown as PrismaService, jest.fn())).rejects.toBe(error);
      expect($transaction).toHaveBeenCalledTimes(1);
    },
  );
});
