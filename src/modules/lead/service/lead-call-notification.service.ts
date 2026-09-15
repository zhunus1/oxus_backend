import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Job, Queue } from "bullmq";
import type { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { MailService } from "src/modules/mail/mail.service";
import { formatLeadCallNotification, LEAD_CALL_NOTIFICATION_TYPES, LEAD_CALL_REMINDER_MS } from "../domain/lead-call-notifications";
import { BackgroundRecovery } from "../infrastructure/background-recovery";

export const LEAD_CALL_NOTIFICATION_QUEUE = "lead-call-notifications";
const MAX_ATTEMPTS = 5;
// Longer than Nodemailer's default socket timeout; expired leases recover a stopped worker.
const DELIVERY_LEASE_MS = 15 * 60 * 1000;
const notificationScope = { channel: "EMAIL", type: { in: [...LEAD_CALL_NOTIFICATION_TYPES] } };

/** Dispatches committed call notifications independently of booking requests and SMTP availability. */
@Injectable()
export class LeadCallNotificationService implements OnModuleInit {
  private readonly logger = new Logger(LeadCallNotificationService.name);
  private readonly recovery = new BackgroundRecovery(
    () => this.recoverPending(),
    () => this.logger.error("Call notification recovery failed; the next pass will retry"),
  );

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(LEAD_CALL_NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.recovery.trigger();
  }

  @Cron("*/10 * * * * *", { waitForCompletion: true })
  recover(): Promise<void> {
    return this.recovery.run();
  }

  private available(now: Date): Prisma.NotificationLogWhereInput {
    return {
      ...notificationScope,
      deliveryAttempts: { lt: MAX_ATTEMPTS },
      AND: [{ OR: [{ status: "PENDING" }, { status: "SENDING", deliveryLeaseUntil: { lte: now } }] }, { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
    };
  }

  private async recoverPending(): Promise<void> {
    const now = new Date();
    await this.prisma.notificationLog.updateMany({
      where: {
        ...notificationScope,
        deliveryAttempts: { gte: MAX_ATTEMPTS },
        OR: [{ status: "PENDING" }, { status: "SENDING", deliveryLeaseUntil: { lte: now } }],
      },
      data: { status: "FAILED", deliveryLeaseUntil: null },
    });
    let afterId = 0;
    while (true) {
      const pending = await this.prisma.notificationLog.findMany({
        where: { ...this.available(now), scheduledFor: { lte: new Date(now.getTime() + 60_000) }, id: { gt: afterId } },
        select: { id: true, scheduledFor: true },
        orderBy: { id: "asc" },
        take: 100,
      });
      await Promise.all(
        pending.map(async notification => {
          try {
            await this.queue.add(
              "deliver",
              { notificationId: notification.id },
              {
                jobId: `lead-call-notification-${notification.id}`,
                delay: Math.max(0, notification.scheduledFor.getTime() - Date.now()),
                removeOnComplete: true,
                removeOnFail: true,
              },
            );
          } catch {
            this.logger.warn(`Could not enqueue call notification ${notification.id}; recovery will retry`);
          }
        }),
      );
      if (pending.length < 100) return;
      afterId = pending[pending.length - 1].id;
    }
  }

  async deliver(notificationId: number): Promise<void> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + DELIVERY_LEASE_MS);
    const claimed = await this.prisma.notificationLog.updateMany({
      where: { ...this.available(now), id: notificationId, scheduledFor: { lte: now } },
      data: { status: "SENDING", deliveryLeaseUntil: leaseUntil },
    });
    if (claimed.count !== 1) return;
    // Compare the lease on completion so an old worker cannot overwrite a newer delivery or cancellation.
    const owned = { id: notificationId, status: "SENDING", deliveryLeaseUntil: leaseUntil };
    try {
      await this.deliverClaimed(owned);
    } catch (error) {
      // A transient database read failure must not hold a live worker's lease for fifteen minutes.
      await this.prisma.notificationLog.updateMany({
        where: owned,
        data: { status: "PENDING", deliveryLeaseUntil: null, nextAttemptAt: new Date(Date.now() + 30_000) },
      });
      throw error;
    }
  }

  private async deliverClaimed(owned: { id: number; status: string; deliveryLeaseUntil: Date }): Promise<void> {
    const notificationId = owned.id;
    const notification = await this.prisma.notificationLog.findUniqueOrThrow({ where: { id: notificationId } });
    const metadata = notification.metadata as { callId?: number; startTime?: string; endTime?: string } | null;
    const call = Number.isSafeInteger(metadata?.callId)
      ? await this.prisma.leadExpertCall.findUnique({
          where: { id: metadata!.callId },
          include: {
            lead: { select: { id: true, displayName: true, deletedAt: true, assignedExpertUserId: true } },
            expertUser: { select: { email: true, timezone: true, deletedAt: true, role: { select: { code: true } } } },
          },
        })
      : null;
    const current =
      call &&
      !call.lead.deletedAt &&
      !call.expertUser.deletedAt &&
      call.expertUser.role.code === "EXPERT" &&
      call.expertUserId === notification.userId &&
      call.lead.assignedExpertUserId === notification.userId &&
      call.leadId === notification.leadId &&
      ["REQUESTED", "CONFIRMED"].includes(call.status) &&
      call.startTime > new Date() &&
      call.startTime.toISOString() === metadata?.startTime &&
      call.endTime.toISOString() === metadata?.endTime;
    if (!current) {
      await this.prisma.notificationLog.updateMany({ where: owned, data: { status: "CANCELLED", deliveryLeaseUntil: null } });
      return;
    }
    const reminder = notification.type === "LEAD_EXPERT_CALL_REMINDER";
    if (reminder && (call.status !== "CONFIRMED" || call.startTime.getTime() - Date.now() > LEAD_CALL_REMINDER_MS)) {
      // A late confirmation can still receive its reminder before the call starts.
      await this.prisma.notificationLog.updateMany({
        where: owned,
        data: { status: "PENDING", deliveryLeaseUntil: null, nextAttemptAt: new Date(Date.now() + 10_000) },
      });
      return;
    }

    const attempt = notification.deliveryAttempts + 1;
    const started = await this.prisma.notificationLog.updateMany({ where: owned, data: { deliveryAttempts: attempt } });
    if (started.count !== 1) return;
    try {
      const message = formatLeadCallNotification(
        {
          startTime: call.startTime,
          timezone: call.expertUser.timezone || "Asia/Almaty",
          leadName: call.lead.displayName,
          leadId: call.leadId,
          confirmed: call.status === "CONFIRMED",
          office: call.format === "OFFICE",
        },
        reminder,
      );
      await this.mail.sendMail(call.expertUser.email, message.subject, message.text);
      await this.prisma.notificationLog.updateMany({
        where: owned,
        data: { status: "SENT", sentAt: new Date(), content: message.text, deliveryLeaseUntil: null, nextAttemptAt: null },
      });
    } catch {
      const failed = attempt >= MAX_ATTEMPTS;
      await this.prisma.notificationLog.updateMany({
        where: owned,
        data: {
          status: failed ? "FAILED" : "PENDING",
          deliveryLeaseUntil: null,
          nextAttemptAt: failed ? null : new Date(Date.now() + 30_000 * 2 ** (attempt - 1)),
        },
      });
      if (failed) this.logger.error(`Call notification ${notificationId} failed after ${attempt} delivery attempts`);
      else this.logger.warn(`Call notification ${notificationId} will retry after delivery attempt ${attempt}`);
    }
  }
}

@Processor(LEAD_CALL_NOTIFICATION_QUEUE)
export class LeadCallNotificationProcessor extends WorkerHost {
  constructor(private readonly notifications: LeadCallNotificationService) {
    super();
  }

  process(job: Job<{ notificationId: number }>): Promise<void> {
    return this.notifications.deliver(job.data.notificationId);
  }
}
