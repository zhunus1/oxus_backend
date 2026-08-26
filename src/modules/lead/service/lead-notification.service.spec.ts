import type { Queue } from "bullmq";
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
  const service = new LeadNotificationService(prisma, queue);

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    updateMany.mockResolvedValue({ count: 1 });
    findUniqueOrThrow.mockResolvedValue({ id: 5, status: "SENT" });
    add.mockResolvedValue(undefined);
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

  it("restores every pending delayed job when the application starts", async () => {
    const first = { id: 5, scheduledFor: new Date(Date.now() + 60_000) };
    const second = { id: 6, scheduledFor: new Date(Date.now() + 120_000) };
    findMany.mockResolvedValue([first, second]);

    await service.onModuleInit();

    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledWith("deliver", { notificationId: 5 }, expect.objectContaining({ jobId: "lead-notification-5" }));
    expect(add).toHaveBeenCalledWith("deliver", { notificationId: 6 }, expect.objectContaining({ jobId: "lead-notification-6" }));
  });
});
