import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Job, Queue } from "bullmq";
import { PrismaService } from "src/database/prisma.service";
import { BackgroundRecovery } from "src/modules/lead/infrastructure/background-recovery";
import { MailService } from "src/modules/mail/mail.service";
import { CONTRACT_EMAIL_TYPES } from "../domain/contract-emails";
import { CONTRACT_INCLUDE } from "../repository/contract.repository";
import { PdfService } from "./pdf.service";

export const CONTRACT_NOTIFICATION_QUEUE = "contract-notifications";

/** Restores committed email intents after queue/SMTP outages without repeating contract signing. */
@Injectable()
export class ContractNotificationService implements OnModuleInit {
  private readonly logger = new Logger(ContractNotificationService.name);
  private readonly recovery = new BackgroundRecovery(
    () => this.recoverPending(),
    () => this.logger.error("Contract email recovery failed; the next scheduled pass will retry"),
  );

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(CONTRACT_NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly mail: MailService,
    private readonly pdf: PdfService,
  ) {}

  /** Recovers persisted email intents on application startup. */
  onModuleInit() {
    this.enqueue();
  }

  /** Wakes background dispatch after commit without making signing depend on Redis availability. */
  enqueue(): void {
    this.recovery.trigger();
  }

  /** Restores pending jobs, including exhausted retries and jobs lost with Redis. */
  @Cron("0 * * * * *", { waitForCompletion: true })
  recover(): Promise<void> {
    return this.recovery.run();
  }

  /** Reads bounded batches and uses stable IDs to coalesce dispatch across application instances. */
  private async recoverPending(): Promise<void> {
    let afterId = 0;
    const dueBy = new Date();
    while (true) {
      const pending = await this.prisma.notificationLog.findMany({
        where: { channel: "EMAIL", type: { in: [...CONTRACT_EMAIL_TYPES] }, status: "PENDING", scheduledFor: { lte: dueBy }, id: { gt: afterId } },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 100,
      });
      await Promise.all(
        pending.map(async ({ id }) => {
          try {
            const job = await this.queue.add(
              "deliver",
              { notificationId: id },
              {
                jobId: `contract-email-${id}`,
                attempts: 3,
                backoff: { type: "exponential", delay: 5000 },
                removeOnComplete: true,
                removeOnFail: true,
              },
            );
            if ((await job.getState()) === "failed") await job.retry();
          } catch {
            this.logger.warn(`Could not enqueue contract email ${id}; recovery will retry`);
          }
        }),
      );
      if (pending.length < 100) return;
      afterId = pending[pending.length - 1].id;
    }
  }

  /** Sends one recipient's email, recording success only after SMTP accepts it (at-least-once delivery). */
  async deliver(notificationId: number): Promise<void> {
    const notification = await this.prisma.notificationLog.findUnique({ where: { id: notificationId } });
    if (!notification || notification.channel !== "EMAIL" || notification.status !== "PENDING" || !CONTRACT_EMAIL_TYPES.some(type => type === notification.type)) return;
    const metadata = notification.metadata;
    const contractId = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata.contractId : undefined;
    const contract = typeof contractId === "string" ? await this.prisma.contract.findUnique({ where: { id: contractId }, include: CONTRACT_INCLUDE }) : null;
    const ready = notification.type === "CONTRACT_READY";
    const recipient =
      contract && (contract.studentId === notification.userId ? contract.student : !ready && contract.signedByUserId === notification.userId ? contract.signedByUser : null);
    if (!contract || !recipient || (ready ? contract.status !== "PENDING_STUDENT" : !["SIGNED", "PAID"].includes(contract.status))) {
      await this.prisma.notificationLog.update({ where: { id: notificationId }, data: { status: "CANCELLED" } });
      return;
    }
    if (ready) {
      await this.mail.sendMail(
        recipient.email,
        "Ваш договор готов к подписанию — AcademicApply",
        "Договор готов. Войдите в личный кабинет и подпишите его в разделе «Профиль».",
        `<p>Здравствуйте, <strong>${this.escapeHtml(recipient.firstname)}</strong>!</p>
         <p>Ваш договор об оказании консалтинговых услуг с ТОО «OXUS GLOBAL STUDENT MOBILITY» готов к подписанию.</p>
         <p>Пожалуйста, войдите в <a href="${this.escapeHtml(process.env.FRONTEND_URL ?? "https://oxusedu.com")}/profile">личный кабинет</a> и ознакомьтесь с договором в разделе «Профиль».</p>`,
      );
    } else {
      const buffer = await this.pdf.generatePdf(contract);
      await this.mail.sendMail(
        recipient.email,
        `Договор №${contract.contractNumber} подписан — Oxusedu`,
        "Договор подписан обеими сторонами. Копия во вложении.",
        `<p>Здравствуйте, <strong>${this.escapeHtml(recipient.firstname)}</strong>!</p><p>Договор №<strong>${this.escapeHtml(contract.contractNumber)}</strong> успешно подписан обеими сторонами. Копия прилагается.</p>`,
        [{ filename: `Договор_${contract.contractNumber}.pdf`, content: buffer, contentType: "application/pdf" }],
      );
    }
    await this.prisma.notificationLog.update({ where: { id: notificationId }, data: { status: "SENT", sentAt: new Date() } });
  }

  /** Escapes dynamic text before embedding it in notification HTML. */
  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  }
}

/** Runs durable contract mail jobs; thrown delivery errors remain retryable in BullMQ. */
@Processor(CONTRACT_NOTIFICATION_QUEUE)
export class ContractNotificationProcessor extends WorkerHost {
  constructor(private readonly notifications: ContractNotificationService) {
    super();
  }

  /** Processes only the notification ID; the database supplies the current contract and recipient. */
  async process(job: Job<{ notificationId: number }>): Promise<void> {
    await this.notifications.deliver(job.data.notificationId);
  }
}
