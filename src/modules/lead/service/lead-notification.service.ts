import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { PrismaService } from "src/database/prisma.service";
import { NotificationQueryDto } from "../api/dto/sales/notification-query.dto";

@Injectable()
export class LeadNotificationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("lead-notifications") private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    const pending = await this.prisma.notificationLog.findMany({
      where: { channel: "IN_APP", status: "PENDING" },
      select: { id: true, scheduledFor: true },
    });
    await Promise.all(pending.map(notification => this.schedule(notification)));
  }

  async schedule(notification: { id: number; scheduledFor: Date }) {
    await this.queue.add(
      "deliver",
      { notificationId: notification.id },
      {
        jobId: `lead-notification-${notification.id}`,
        delay: Math.max(0, notification.scheduledFor.getTime() - Date.now()),
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }

  async list(userId: number, query: NotificationQueryDto) {
    const where = {
      userId,
      channel: "IN_APP",
      status: "SENT",
      ...(query.unreadOnly ? { readAt: null } : {}),
    } as const;
    const [data, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ scheduledFor: "desc" }, { id: "desc" }],
      }),
      this.prisma.notificationLog.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  unreadCount(userId: number) {
    return this.prisma.notificationLog.count({ where: { userId, channel: "IN_APP", status: "SENT", readAt: null } }).then(count => ({ count }));
  }

  async markRead(userId: number, notificationId: number) {
    const result = await this.prisma.notificationLog.updateMany({
      where: { id: notificationId, userId, channel: "IN_APP", status: "SENT" },
      data: { readAt: new Date() },
    });
    if (result.count !== 1) throw new NotFoundException("Notification not found");
    return this.prisma.notificationLog.findUniqueOrThrow({ where: { id: notificationId } });
  }

  async markAllRead(userId: number) {
    const result = await this.prisma.notificationLog.updateMany({
      where: { userId, channel: "IN_APP", status: "SENT", readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
