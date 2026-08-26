import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { PrismaService } from "src/database/prisma.service";
import { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";

@Processor("lead-notifications")
export class LeadNotificationProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: LeadRealtimeGateway,
  ) {
    super();
  }

  async process(job: Job<{ notificationId: number }>) {
    const now = new Date();
    const result = await this.prisma.notificationLog.updateMany({
      where: { id: job.data.notificationId, status: "PENDING", scheduledFor: { lte: now } },
      data: { status: "SENT", sentAt: now },
    });
    if (result.count !== 1) return null;

    const notification = await this.prisma.notificationLog.findUnique({ where: { id: job.data.notificationId } });
    if (notification) this.realtime.emitNotification(notification.userId, notification);
    return notification;
  }
}
