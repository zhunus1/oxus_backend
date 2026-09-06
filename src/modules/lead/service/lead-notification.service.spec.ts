import type { Queue } from "bullmq";
import { Logger } from "@nestjs/common";
import type { PrismaService } from "src/database/prisma.service";
import { LeadNotificationService } from "./lead-notification.service";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("LeadNotificationService", () => {
  const findMany = jest.fn();
  const count = jest.fn();
  const updateMany = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const prisma = {
    notificationLog: { findMany, count, updateMany, findUniqueOrThrow },
  } as unknown as PrismaService;
  const add = jest.fn();
  const queue = { add } as unknown as Queue;
  let service: LeadNotificationService;

  beforeEach(() => {
    service = new LeadNotificationService(prisma, queue);
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    updateMany.mockResolvedValue({ count: 1 });
    findUniqueOrThrow.mockResolvedValue({ id: 5, status: "SENT" });
    add.mockResolvedValue({ getState: jest.fn().mockResolvedValue("delayed") });
  });

  it("lists only delivered in-app notifications belonging to the current user", async () => {
    await service.list(17, { page: 1, limit: 20, unreadOnly: true });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 17, channel: "IN_APP", status: "SENT", readAt: null },
      }),
    );
  });

  it("cannot mark another user's or a still-pending notification as read", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(service.markRead(17, 5)).rejects.toThrow("Notification not found");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 5, userId: 17, channel: "IN_APP", status: "SENT" },
      data: { readAt: expect.any(Date) },
    });
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("restores pending reminders near their due time when the application starts", async () => {
    const first = { id: 5, scheduledFor: new Date(Date.now() + 60_000) };
    const second = { id: 6, scheduledFor: new Date(Date.now() + 120_000) };
    findMany.mockResolvedValue([first, second]);

    service.onModuleInit();
    await service.recover();

    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledWith("deliver", { notificationId: 5 }, expect.objectContaining({ jobId: "lead-notification-5" }));
    expect(add).toHaveBeenCalledWith("deliver", { notificationId: 6 }, expect.objectContaining({ jobId: "lead-notification-6" }));
  });

  it("keeps committed reminders recoverable when enqueueing fails", async () => {
    const warning = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    try {
      findMany.mockResolvedValue([{ id: 5, scheduledFor: new Date() }]);
      add.mockRejectedValue(new Error("Redis unavailable"));
      await expect(service.schedule()).resolves.toBeUndefined();
      await service.recover();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("notification 5"));
      expect(updateMany).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it("retries failed jobs retained by an older deployment", async () => {
    const retry = jest.fn();
    add.mockResolvedValue({ getState: jest.fn().mockResolvedValue("failed"), retry });
    findMany.mockResolvedValue([{ id: 5, scheduledFor: new Date() }]);
    await service.schedule();
    await service.recover();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("recovers more than one batch without loading the entire reminder history", async () => {
    const batch = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, scheduledFor: new Date() }));
    findMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([{ id: 150, scheduledFor: new Date() }]);
    await service.recover();
    expect(add).toHaveBeenCalledTimes(101);
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: { channel: "IN_APP", status: "PENDING", scheduledFor: { lte: expect.any(Date) }, id: { gt: 100 } },
      select: { id: true, scheduledFor: true },
      orderBy: { id: "asc" },
      take: 100,
    });
  });
});
