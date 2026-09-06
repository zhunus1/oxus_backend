import { BackgroundRecovery } from "../infrastructure/background-recovery";
import { Cron } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { PrismaService } from "src/database/prisma.service";
import { NotificationQueryDto } from "../api/dto/sales/notification-query.dto";

/** Schedules persistent in-app reminders and restores due jobs after queue outages. */
@Injectable()
export class LeadNotificationService implements OnModuleInit {
  private readonly logger = new Logger(LeadNotificationService.name);
  private readonly recovery = new BackgroundRecovery(
    () => this.recoverPending(),
    () => this.logger.error("Reminder recovery failed; the next scheduled pass will retry"),
  );

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("lead-notifications") private readonly queue: Queue,
  ) {}

  /** Starts recovery of due reminders when the module becomes available. */
  onModuleInit() {
    this.recovery.trigger();
  }

  /** Requeues due reminders from the database in bounded batches after queue outages. */
  @Cron("0 * * * * *", { waitForCompletion: true })
  recover(): Promise<void> {
    return this.recovery.run();
  }

  /** Dispatches due persisted reminders in bounded batches; queue reconnects never hold an HTTP request. */
  private async recoverPending() {
    const dueBy = new Date(Date.now() + 60_000);
    let afterId = 0;
    while (true) {
      const pending = await this.prisma.notificationLog.findMany({
        where: { channel: "IN_APP", status: "PENDING", scheduledFor: { lte: dueBy }, id: { gt: afterId } },
        select: { id: true, scheduledFor: true },
        orderBy: { id: "asc" },
        take: 100,
      });
      await Promise.all(pending.map(notification => this.enqueueReminder(notification)));
      if (pending.length < 100) return;
      afterId = pending[pending.length - 1].id;
    }
  }

  /** Wakes background delivery after the reminder transaction commits; the database supplies the current state. */
  async schedule(): Promise<void> {
    this.recovery.trigger();
  }

  /** Enqueues a persisted reminder, retrying retained failed jobs from older deployments. */
  private async enqueueReminder(notification: { id: number; scheduledFor: Date }) {
    try {
      const job = await this.queue.add(
        "deliver",
        { notificationId: notification.id },
        {
          jobId: `lead-notification-${notification.id}`,
          delay: Math.max(0, notification.scheduledFor.getTime() - Date.now()),
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      // Older deployments retained failed jobs, so adding the same ID alone cannot revive them.
      if ((await job.getState()) === "failed") await job.retry();
    } catch {
      this.logger.warn(`Could not enqueue lead notification ${notification.id}; recovery will retry`);
    }
  }

  /** Returns the user notification history, optionally including pending reminders. */
  async list(userId: number, query: NotificationQueryDto) {
    const where = {
      userId,
      channel: "IN_APP",
      status: query.includeScheduled ? { in: ["SENT", "PENDING"] } : "SENT",
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

  /** Counts delivered unread in-app notifications for this user. */
  unreadCount(userId: number) {
    return this.prisma.notificationLog.count({ where: { userId, channel: "IN_APP", status: "SENT", readAt: null } }).then(count => ({ count }));
  }

  /** Marks a delivered notification as read only for its recipient. */
  async markRead(userId: number, notificationId: number) {
    const result = await this.prisma.notificationLog.updateMany({
      where: { id: notificationId, userId, channel: "IN_APP", status: "SENT" },
      data: { readAt: new Date() },
    });
    if (result.count !== 1) throw new NotFoundException("Notification not found");
    return this.prisma.notificationLog.findUniqueOrThrow({ where: { id: notificationId } });
  }

  /** Marks all delivered unread notifications for the recipient in one update. */
  async markAllRead(userId: number) {
    const result = await this.prisma.notificationLog.updateMany({
      where: { userId, channel: "IN_APP", status: "SENT", readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
