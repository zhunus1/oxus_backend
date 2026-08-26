import type { Job } from "bullmq";
import type { PrismaService } from "src/database/prisma.service";
import type { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import { LeadNotificationProcessor } from "./lead-notification.processor";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("LeadNotificationProcessor", () => {
  const updateMany = jest.fn();
  const findUnique = jest.fn();
  const prisma = {
    notificationLog: { updateMany, findUnique },
  } as unknown as PrismaService;
  const emitNotification = jest.fn();
  const realtime = { emitNotification } as unknown as LeadRealtimeGateway;
  const processor = new LeadNotificationProcessor(prisma, realtime);
  const job = { data: { notificationId: 5 } } as Job<{ notificationId: number }>;

  beforeEach(() => jest.clearAllMocks());

  it("delivers a due notification once and emits the committed database row", async () => {
    const notification = { id: 5, userId: 17, status: "SENT" };
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue(notification);

    await expect(processor.process(job)).resolves.toEqual(notification);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, status: "PENDING", scheduledFor: { lte: expect.any(Date) } },
        data: { status: "SENT", sentAt: expect.any(Date) },
      }),
    );
    expect(emitNotification).toHaveBeenCalledWith(17, notification);
  });

  it("does nothing for a cancelled or already delivered notification", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(processor.process(job)).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(emitNotification).not.toHaveBeenCalled();
  });
});
