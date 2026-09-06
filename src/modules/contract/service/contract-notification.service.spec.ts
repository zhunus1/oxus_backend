import type { PrismaService } from "src/database/prisma.service";
import type { MailService } from "src/modules/mail/mail.service";
import type { PdfService } from "./pdf.service";
import type { Queue } from "bullmq";
import { ContractNotificationService } from "./contract-notification.service";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("../repository/contract.repository", () => ({ CONTRACT_INCLUDE: {} }));

describe("Contract notification recovery", () => {
  const findMany = jest.fn(),
    findUnique = jest.fn(),
    update = jest.fn(),
    findContract = jest.fn(),
    add = jest.fn(),
    sendMail = jest.fn();
  const prisma = { notificationLog: { findMany, findUnique, update }, contract: { findUnique: findContract } } as unknown as PrismaService;
  let service: ContractNotificationService;
  beforeEach(() => {
    jest.resetAllMocks();
    service = new ContractNotificationService(prisma, { add } as unknown as Queue, { sendMail } as unknown as MailService, {} as PdfService);
    add.mockResolvedValue({ getState: async () => "waiting" });
  });

  it("recovers in bounded batches and revives retained failed jobs", async () => {
    findMany.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))).mockResolvedValueOnce([{ id: 101 }]);
    const retry = jest.fn();
    add.mockResolvedValueOnce({ getState: async () => "failed", retry });
    await service.recover();
    expect(add).toHaveBeenCalledTimes(101);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 100, where: expect.objectContaining({ id: { gt: 100 }, channel: "EMAIL", type: { in: ["CONTRACT_READY", "CONTRACT_SIGNED_COPY"] } }) }),
    );
  });

  it("does not lose pending intent when Redis is unavailable", async () => {
    findMany.mockResolvedValue([{ id: 1 }]);
    add.mockRejectedValue(new Error("Redis offline"));
    await expect(service.recover()).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    add.mockResolvedValue({ getState: async () => "waiting" });
    await service.recover();
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("does not make enqueue wait for a stalled Redis request", async () => {
    let resolveJob!: (value: object) => void;
    findMany.mockResolvedValue([{ id: 1 }]);
    add.mockReturnValue(
      new Promise(resolve => {
        resolveJob = resolve;
      }),
    );
    expect(service.enqueue()).toBeUndefined();
    await Promise.resolve();
    resolveJob({ getState: async () => "waiting" });
    await service.recover();
  });

  it.each([
    null,
    { channel: "IN_APP", status: "PENDING", type: "CONTRACT_READY" },
    { channel: "EMAIL", status: "SENT", type: "CONTRACT_READY" },
    { channel: "EMAIL", status: "PENDING", type: "OTHER" },
  ])("ignores unrelated or already delivered notifications", async row => {
    findUnique.mockResolvedValue(row);
    await service.deliver(1);
    expect(findContract).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("cancels malformed metadata without sending or retrying forever", async () => {
    findUnique.mockResolvedValue({ channel: "EMAIL", status: "PENDING", type: "CONTRACT_READY", metadata: { contractId: 17 } });
    await service.deliver(1);
    expect(update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: "CANCELLED" } });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("refuses to send a contract to a recipient outside its participants", async () => {
    findUnique.mockResolvedValue({ channel: "EMAIL", status: "PENDING", type: "CONTRACT_READY", userId: 99, metadata: { contractId: "contract" } });
    findContract.mockResolvedValue({ studentId: 17, student: { email: "student@example.test" }, status: "PENDING_STUDENT" });
    await service.deliver(1);
    expect(update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: "CANCELLED" } });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
