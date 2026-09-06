import { BackgroundRecovery } from "../infrastructure/background-recovery";
import { BadRequestException, Injectable, Logger, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Cron } from "@nestjs/schedule";
import { Queue, Job } from "bullmq";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import { PrismaService } from "src/database/prisma.service";
import { MailService } from "src/modules/mail/mail.service";
import { AcceptStudentInvitationDto } from "../api/dto/sales/sales-v2.dto";

/** Delivers and redeems one-use student activation invitations with versioned queue retries. */
@Injectable()
export class LeadStudentInvitationService {
  private readonly logger = new Logger(LeadStudentInvitationService.name);
  private readonly recovery = new BackgroundRecovery(
    () => this.recoverPending(),
    () => this.logger.error("Invitation recovery failed; the next scheduled pass will retry"),
  );
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    @InjectQueue("lead-invitations") private readonly queue: Queue,
  ) {}

  /** Wakes background delivery after commit without making the request wait for Redis. */
  async enqueue(): Promise<void> {
    this.recovery.trigger();
  }

  /** Queues a version loaded from the persisted invitation so superseded jobs remain harmless. */
  private async enqueueVersion(id: string, deliveryVersion: number) {
    try {
      await this.queue.add(
        "invite",
        { invitationId: id, deliveryVersion },
        { jobId: `lead-invitation-${id}-v${deliveryVersion}`, attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: true },
      );
    } catch {
      this.logger.error("Invitation queue unavailable; scheduled recovery will retry");
    }
  }

  /** Scans unsent valid invitations in bounded batches and requeues each current delivery version. */
  @Cron("0 */5 * * * *", { waitForCompletion: true })
  recover(): Promise<void> {
    return this.recovery.run();
  }

  /** Loads current pending generations in bounded batches for background delivery. */
  private async recoverPending() {
    let cursor: string | undefined;
    while (true) {
      const pending = await this.prisma.leadStudentInvitation.findMany({
        where: { sentAt: null, acceptedAt: null, expiresAt: { gt: new Date() }, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true, deliveryVersion: true },
        take: 100,
        orderBy: { id: "asc" },
      });
      await Promise.all(pending.map(item => this.enqueueVersion(item.id, item.deliveryVersion)));
      if (pending.length < 100) return;
      cursor = pending[pending.length - 1].id;
    }
  }

  /** Sends a valid invitation and records delivery only if its version has not changed during sending. */
  async send(id: string, deliveryVersion?: number) {
    const invitation = await this.prisma.leadStudentInvitation.findUnique({ where: { id }, include: { user: { select: { email: true, deletedAt: true } } } });
    if (!invitation || invitation.sentAt || invitation.acceptedAt || invitation.expiresAt <= new Date() || invitation.user.deletedAt) return;
    if (deliveryVersion !== undefined && deliveryVersion !== invitation.deliveryVersion) return;
    const token = await this.jwt.signAsync(
      { invitationId: id, purpose: "lead-student-invitation", exp: Math.floor(invitation.expiresAt.getTime() / 1000) },
      { secret: `${this.config.getOrThrow<string>("JWT_SECRET")}:lead-student-invitation`, audience: "lead-student-invitation" },
    );
    const link = `${(this.config.get<string>("FRONTEND_URL") ?? "https://oxusedu.com").replace(/\/$/, "")}/activate-account?token=${encodeURIComponent(token)}`;
    await this.mail.sendMail(
      invitation.user.email,
      "Ваш аккаунт OXUS",
      `Установите пароль для входа: ${link}`,
      `<p>Ваш аккаунт OXUS готов. <a href="${link.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Установите пароль</a> для входа. Ссылка действует 7 дней.</p>`,
    );
    await this.prisma.leadStudentInvitation.updateMany({
      where: { id, deliveryVersion: invitation.deliveryVersion, acceptedAt: null, sentAt: null },
      data: { sentAt: new Date() },
    });
  }

  /** Checks assigned-expert access and rotates the delivery version without losing a concurrent resend. */
  async resend(expertId: number, leadId: number) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, assignedExpertUserId: expertId, deletedAt: null },
      select: { contract: { select: { studentId: true } } },
    });
    if (!lead?.contract) throw new NotFoundException("Lead contract not found");
    const invitation = await this.prisma.leadStudentInvitation.findUnique({ where: { userId: lead.contract.studentId } });
    if (!invitation || invitation.acceptedAt) throw new ConflictException("Student already has account access");
    if (invitation.sentAt && invitation.sentAt.getTime() > Date.now() - 60_000) throw new ConflictException("Please wait before resending");
    const updated = await this.prisma.leadStudentInvitation.updateMany({
      where: { id: invitation.id, deliveryVersion: invitation.deliveryVersion, acceptedAt: null },
      data: { expiresAt: new Date(Date.now() + 7 * 86400_000), sentAt: null, deliveryVersion: { increment: 1 } },
    });
    if (!updated.count) throw new ConflictException("Invitation changed; refresh and retry");
    await this.enqueue();
    return { queued: true };
  }

  /** Validates the activation capability and sets the password with one atomic invitation consumption. */
  async accept(dto: AcceptStudentInvitationDto) {
    let payload: { invitationId: string; purpose: string };
    try {
      payload = await this.jwt.verifyAsync(dto.token, {
        secret: `${this.config.getOrThrow<string>("JWT_SECRET")}:lead-student-invitation`,
        audience: "lead-student-invitation",
        algorithms: ["HS256"],
      });
      if (payload.purpose !== "lead-student-invitation" || typeof payload.invitationId !== "string") throw new Error();
    } catch {
      throw new BadRequestException("Invalid or expired invitation");
    }
    if (Buffer.byteLength(dto.password, "utf8") > 72) throw new BadRequestException("Password exceeds 72 bytes");
    const password = await bcrypt.hash(dto.password, 12);
    await this.prisma.$transaction(async tx => {
      const invitation = await tx.leadStudentInvitation.findUnique({ where: { id: payload.invitationId }, include: { user: { select: { deletedAt: true } } } });
      if (!invitation || invitation.user.deletedAt) throw new BadRequestException("Invalid or expired invitation");
      const result = await tx.leadStudentInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
      if (!result.count) throw new BadRequestException("Invalid or expired invitation");
      await tx.user.update({ where: { id: invitation.userId }, data: { password } });
    });
    return { activated: true };
  }
}

/** Dispatches activation jobs with their delivery generation to ignore superseded work. */
@Processor("lead-invitations")
export class LeadStudentInvitationProcessor extends WorkerHost {
  constructor(private readonly invitations: LeadStudentInvitationService) {
    super();
  }
  /** Passes the queued generation to delivery, treating pre-versioned jobs as generation one. */
  async process(job: Job<{ invitationId: string; deliveryVersion?: number }>) {
    // Jobs queued before generation tracking belong to the original invitation.
    await this.invitations.send(job.data.invitationId, job.data.deliveryVersion ?? 1);
  }
}
