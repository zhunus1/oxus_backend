import { leadTransaction } from "../domain/lead-transaction";
import { assertLeadOfficeCity } from "../domain/lead-office";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LeadCallbackStatus, LeadExpertCallStatus, LeadStatus, MeetingStatus, Prisma } from "generated/prisma/client";
import { v4 as uuidv4 } from "uuid";
import { MEETING_BOOKING_MIN_LEAD_HOURS, MEETING_BOOKING_MIN_LEAD_MS } from "src/common/constants/booking.constants";
import { getLocalDateParts } from "src/common/helpers/timezone";
import { lockExpertBookings } from "src/common/database/expert-booking-lock";
import { PrismaService } from "src/database/prisma.service";
import { CreateLeadExpertCallDto } from "../api/dto/sales/create-lead-expert-call.dto";
import { ExpertLeadCallQueryDto } from "../api/dto/sales/expert-lead-call-query.dto";
import { RespondLeadExpertCallDto } from "../api/dto/sales/respond-lead-expert-call.dto";
import { SalesExpertQueryDto } from "../api/dto/sales/sales-expert-query.dto";
import { UpdateLeadExpertCallDto } from "../api/dto/sales/update-lead-expert-call.dto";
import { LEAD_ACTIVITY } from "../domain/lead.constants";
import { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import { PreviewLeadMeetingDto } from "../api/dto/sales/sales-v2.dto";
import { assertLeadBookingTime } from "../domain/lead-booking";
import { scheduleLeadCallNotifications } from "../domain/lead-call-notifications";

const leadCallInclude = {
  lead: {
    select: {
      id: true,
      displayName: true,
      phoneNumber: true,
      email: true,
      role: true,
      preferredLanguage: true,
      status: true,
    },
  },
  salesManager: { select: { id: true, firstname: true, lastname: true } },
  expertUser: { select: { id: true, firstname: true, lastname: true, timezone: true } },
  meeting: true,
} as const;

/** Manages legacy calls and v2 consultation previews with transactional booking checks. */
@Injectable()
export class LeadExpertCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: LeadRealtimeGateway,
  ) {}

  /** Returns supported office locations, using configured addresses when available. */
  offices() {
    return [
      { code: "almaty", city: "Алматы", address: process.env.SALES_OFFICE_ALMATY_ADDRESS || "г. Алматы, ул. Навои 30/1, 1 этаж, офис 460, ЖК Taymas", testAddress: false },
      {
        code: "shymkent",
        city: "Шымкент",
        address: process.env.SALES_OFFICE_SHYMKENT_ADDRESS || "г. Шымкент, ул. Байтерекова 2Б",
        testAddress: false,
      },
    ];
  }

  /** Validates a proposed consultation and creates a stable invitation link without reserving the slot. */
  async preview(managerId: number, leadId: number, dto: PreviewLeadMeetingDto) {
    const { startTime, endTime } = this.parseTimes(dto.startTime, dto.endTime);
    const [lead, expert] = await Promise.all([
      this.prisma.lead.findFirst({
        where: { id: leadId, assignedSalesManagerId: managerId, deletedAt: null },
        include: { submissions: { take: 1, orderBy: [{ receivedAt: "desc" }, { id: "desc" }] } },
      }),
      this.prisma.user.findFirst({
        where: { id: dto.expertUserId, role: { code: "EXPERT" }, deletedAt: null, consultantProfile: { isActive: true } },
        select: { firstname: true, lastname: true, timezone: true, consultantProfile: { select: { id: true } } },
      }),
    ]);
    if (!lead || !expert?.consultantProfile) throw new NotFoundException("Lead or expert not found");
    if (lead.contractId) throw new ConflictException("Lead is already being converted");
    assertLeadBookingTime(startTime, endTime, expert.timezone);
    const office = dto.format === "OFFICE" ? this.offices().find(o => o.code === dto.officeCode) : null;
    if (dto.format === "OFFICE" && !office) throw new BadRequestException("Office consultations are available only in Almaty and Shymkent; select an office");
    if (office) assertLeadOfficeCity(lead.submissions[0], office.code);
    if (dto.format === "ONLINE" && dto.officeCode) throw new BadRequestException("Online consultations cannot have an office");
    await this.assertConfiguredSlot(this.prisma, dto.expertUserId, expert.timezone, startTime, endTime);
    await this.assertSlotAvailable(this.prisma, dto.expertUserId, expert.consultantProfile.id, startTime, endTime);
    const invitation = await this.prisma.leadMeetingInvitation.create({
      data: {
        leadId,
        salesManagerId: managerId,
        roomName: uuidv4(),
        booking: { ...dto, officeAddress: office?.address ?? null },
        expiresAt: new Date(Math.min(Date.now() + 86400_000, startTime.getTime())),
      },
    });
    const guestUrl = dto.format === "ONLINE" ? `${(process.env.FRONTEND_URL || "https://oxusedu.com").replace(/\/$/, "")}/lead-meetings/${invitation.id}` : null;
    const name = `${expert.firstname} ${expert.lastname}`.trim();
    const date = (locale: string) => startTime.toLocaleDateString(locale, { timeZone: expert.timezone, year: "numeric", month: "long", day: "numeric", weekday: "long" });
    const time = (value: Date) => value.toLocaleTimeString("ru-RU", { timeZone: expert.timezone, hour: "2-digit", minute: "2-digit" });
    const ru = `Добрый день! Консультация с экспертом ${name}: ${date("ru-RU")}, ${time(startTime)}–${time(endTime)} (${expert.timezone}).\n${office ? `Наш адрес: ${office.address}` : `Ссылка на видеовстречу: ${guestUrl}`}`;
    const kk = `Қайырлы күн! ${name} сарапшысымен кеңес: ${date("kk-KZ")}, ${time(startTime)}–${time(endTime)} (${expert.timezone}).\n${office ? `Мекенжайымыз: ${office.address}` : `Бейнеқоңырау сілтемесі: ${guestUrl}`}`;
    return { invitationId: invitation.id, expiresAt: invitation.expiresAt, guestUrl, office, timezone: expert.timezone, messages: { ru, kk }, copyText: `${kk}\n\n${ru}` };
  }

  /** Revalidates and books a preview, returning the existing call on an authorized retry. */
  async savePreview(managerId: number, leadId: number, invitationId: string) {
    const invitation = await this.prisma.leadMeetingInvitation.findFirst({
      where: { id: invitationId, leadId, salesManagerId: managerId, lead: { assignedSalesManagerId: managerId, deletedAt: null } },
      include: { call: { include: leadCallInclude } },
    });
    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.call) return invitation.call;
    if (invitation.cancelledAt || invitation.expiresAt <= new Date()) throw new ConflictException("Invitation is no longer available");
    const booking = invitation.booking as unknown as PreviewLeadMeetingDto & { officeAddress: string | null };
    try {
      return await this.create(managerId, leadId, booking, { invitationId, ...booking });
    } catch (error) {
      if (error instanceof ConflictException) {
        const existing = await this.prisma.leadExpertCall.findFirst({
          where: { invitationId, leadId, salesManagerId: managerId, lead: { assignedSalesManagerId: managerId, deletedAt: null } },
          include: leadCallInclude,
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  /** Cancels an owned unused preview under the same row lock used during booking. */
  async cancelPreview(managerId: number, leadId: number, invitationId: string) {
    const result = await leadTransaction(this.prisma, async tx => {
      await tx.$queryRaw`SELECT "id" FROM "LeadMeetingInvitation" WHERE "id" = ${invitationId} FOR UPDATE`;
      return tx.leadMeetingInvitation.updateMany({
        where: { id: invitationId, leadId, salesManagerId: managerId, call: null, lead: { assignedSalesManagerId: managerId, deletedAt: null } },
        data: { cancelledAt: new Date() },
      });
    });
    if (!result.count) throw new ConflictException("Invitation does not exist or has already been booked");
    return { cancelled: true };
  }

  /** Serializes expert bookings and atomically replaces callbacks with a consultation request. */
  async create(managerId: number, leadId: number, dto: CreateLeadExpertCallDto, booking?: PreviewLeadMeetingDto & { invitationId: string; officeAddress: string | null }) {
    const { startTime, endTime } = this.parseTimes(dto.startTime, dto.endTime);
    const call = await leadTransaction(this.prisma, async tx => {
      const lead = await tx.lead.findFirst({
        where: { id: leadId, assignedSalesManagerId: managerId, deletedAt: null },
        include: { submissions: { take: 1, orderBy: [{ receivedAt: "desc" }, { id: "desc" }] } },
      });
      if (!lead) throw new NotFoundException("Lead not found");
      if (lead.contractId) throw new ConflictException("Lead is already being converted");
      if (booking) {
        // Saving and cancelling a preview must serialize on the same invitation.
        await tx.$queryRaw`SELECT "id" FROM "LeadMeetingInvitation" WHERE "id" = ${booking.invitationId} FOR UPDATE`;
        const invitation = await tx.leadMeetingInvitation.findFirst({
          where: { id: booking.invitationId, leadId, salesManagerId: managerId, cancelledAt: null, expiresAt: { gt: new Date() }, call: null },
        });
        if (!invitation) throw new ConflictException("Invitation is no longer available");
      }

      const expert = await tx.user.findFirst({
        where: { id: dto.expertUserId, deletedAt: null, role: { code: "EXPERT" } },
        include: { consultantProfile: true },
      });
      if (!expert?.consultantProfile || (booking && !expert.consultantProfile.isActive)) throw new NotFoundException("Expert not found");
      if (booking?.format === "OFFICE") assertLeadOfficeCity(lead.submissions?.[0], booking.officeCode!);
      if (booking) assertLeadBookingTime(startTime, endTime, expert.timezone);

      await lockExpertBookings(tx, expert.id);
      await this.assertConfiguredSlot(tx, expert.id, expert.timezone, startTime, endTime);
      await this.assertSlotAvailable(tx, expert.id, expert.consultantProfile.id, startTime, endTime);

      const existing = await tx.leadExpertCall.findFirst({
        where: { leadId, status: { in: [LeadExpertCallStatus.REQUESTED, LeadExpertCallStatus.CONFIRMED] } },
      });
      if (existing) throw new ConflictException("Lead already has an active expert call");

      await tx.leadCallback.updateMany({
        where: { leadId, status: LeadCallbackStatus.SCHEDULED },
        data: { status: LeadCallbackStatus.CANCELLED, cancelledAt: new Date() },
      });
      await tx.notificationLog.updateMany({
        where: { leadId, userId: managerId, type: "LEAD_CALLBACK_REMINDER", status: "PENDING" },
        data: { status: "CANCELLED" },
      });

      await tx.lead.update({
        where: { id: leadId },
        data: {
          status: booking?.format === "OFFICE" ? LeadStatus.OFFICE_INVITED : LeadStatus.CALL_SCHEDULED,
          assignedExpertUserId: expert.id,
          expertStartedAt: null,
          callbackReason: null,
          rejectedAt: null,
          rejectionReason: null,
        },
      });
      const created = await tx.leadExpertCall.create({
        data: {
          leadId,
          salesManagerId: managerId,
          expertUserId: expert.id,
          startTime,
          endTime,
          comment: dto.comment?.trim(),
          ...(booking ? { format: booking.format, officeCode: booking.officeCode, officeAddress: booking.officeAddress, invitationId: booking.invitationId } : {}),
        },
        include: leadCallInclude,
      });
      await tx.leadActivity.create({
        data: {
          leadId,
          actorUserId: managerId,
          type: LEAD_ACTIVITY.EXPERT_CALL_REQUESTED,
          metadata: { callId: created.id, expertUserId: expert.id, startTime: startTime.toISOString(), endTime: endTime.toISOString() },
        },
      });
      const notification = await tx.notificationLog.create({
        data: {
          userId: expert.id,
          leadId,
          channel: "IN_APP",
          type: "LEAD_EXPERT_CALL_REQUEST",
          status: "SENT",
          content: "Новый запрос на созвон с лидом",
          metadata: { callId: created.id },
          scheduledFor: new Date(),
          sentAt: new Date(),
        },
      });
      await scheduleLeadCallNotifications(tx, created);
      return { created, notification, previousExpertUserId: lead.assignedExpertUserId };
    });

    if (call.previousExpertUserId && call.previousExpertUserId !== call.created.expertUserId) this.realtime.emitExpertLeadUpdated(call.previousExpertUserId, leadId);
    this.realtime.emitExpertCallRequested(call.created.expertUserId, call.created);
    this.realtime.emitNotification(call.created.expertUserId, call.notification);
    this.realtime.emitLeadUpdated(managerId, call.created.lead);
    this.realtime.emitExpertLeadUpdated(call.created.expertUserId, leadId);
    return call.created;
  }

  /** Paginates the expert call history, excluding soft-deleted leads. */
  async listForExpert(expertUserId: number, query: ExpertLeadCallQueryDto) {
    await this.requireExpert(expertUserId);
    const where: Prisma.LeadExpertCallWhereInput = { expertUserId, lead: { deletedAt: null } };
    if (query.status) where.status = query.status;

    const orderBy: Prisma.LeadExpertCallOrderByWithRelationInput[] =
      query.status === LeadExpertCallStatus.REQUESTED ? [{ startTime: "asc" }, { id: "asc" }] : [{ startTime: "desc" }, { id: "desc" }];
    const [data, total] = await Promise.all([
      this.prisma.leadExpertCall.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy,
        include: leadCallInclude,
      }),
      this.prisma.leadExpertCall.count({ where }),
    ]);

    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  /** Lists pending requests whose leads are still assigned to this expert. */
  async pendingForExpert(expertUserId: number) {
    await this.requireExpert(expertUserId);
    return this.prisma.leadExpertCall.findMany({
      where: { expertUserId, status: LeadExpertCallStatus.REQUESTED, lead: { assignedExpertUserId: expertUserId, deletedAt: null } },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      include: leadCallInclude,
    });
  }

  /** Paginates active experts and exposes both user and consultant-profile identifiers. */
  async listExperts(query: SalesExpertQueryDto) {
    const where: Prisma.ConsultantProfileWhereInput = {
      isActive: true,
      user: {
        deletedAt: null,
        role: { code: "EXPERT" },
        ...(query.search?.trim()
          ? {
              OR: [{ firstname: { contains: query.search.trim(), mode: "insensitive" as const } }, { lastname: { contains: query.search.trim(), mode: "insensitive" as const } }],
            }
          : {}),
      },
    };
    const [rows, total] = await Promise.all([
      this.prisma.consultantProfile.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ user: { lastname: "asc" } }, { user: { firstname: "asc" } }],
        select: {
          id: true,
          rating: true,
          bio: true,
          user: { select: { id: true, firstname: true, lastname: true, timezone: true } },
        },
      }),
      this.prisma.consultantProfile.count({ where }),
    ]);
    return {
      data: rows.map(profile => ({
        consultantProfileId: profile.id,
        expertUserId: profile.user.id,
        firstname: profile.user.firstname,
        lastname: profile.user.lastname,
        timezone: profile.user.timezone,
        rating: profile.rating,
        bio: profile.bio,
      })),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  /** Edits a pending request for its current Sales owner; v2 rescheduling requires a new preview. */
  async update(managerId: number, leadId: number, callId: number, dto: UpdateLeadExpertCallDto) {
    if (dto.expertUserId == null && dto.startTime == null && dto.endTime == null && dto.comment == null) {
      throw new BadRequestException("At least one field must be provided");
    }

    const result = await leadTransaction(this.prisma, async tx => {
      const existing = await tx.leadExpertCall.findFirst({
        where: { id: callId, leadId, salesManagerId: managerId, lead: { assignedSalesManagerId: managerId, deletedAt: null } },
      });
      if (!existing) throw new NotFoundException("Lead expert call not found");
      if (existing.status !== LeadExpertCallStatus.REQUESTED) {
        throw new ConflictException("Only a pending expert call can be updated");
      }

      const expertUserId = dto.expertUserId ?? existing.expertUserId;
      const startValue = dto.startTime ?? existing.startTime.toISOString();
      const endValue = dto.endTime ?? existing.endTime.toISOString();
      const scheduleChanged = dto.expertUserId != null || dto.startTime != null || dto.endTime != null;
      if (existing.invitationId && scheduleChanged) throw new ConflictException("Use the follow-up flow and create a new invitation to reschedule a v2 meeting");

      if (scheduleChanged) {
        const { startTime, endTime } = this.parseTimes(startValue, endValue);
        const expert = await tx.user.findFirst({
          where: { id: expertUserId, deletedAt: null, role: { code: "EXPERT" } },
          include: { consultantProfile: true },
        });
        if (!expert?.consultantProfile) throw new NotFoundException("Expert not found");

        await lockExpertBookings(tx, expert.id);
        await this.assertConfiguredSlot(tx, expert.id, expert.timezone, startTime, endTime);
        await this.assertSlotAvailable(tx, expert.id, expert.consultantProfile.id, startTime, endTime, callId);
      }

      const updated = await tx.leadExpertCall.update({
        where: { id: callId },
        data: {
          expertUserId,
          startTime: dto.startTime ? new Date(dto.startTime) : undefined,
          endTime: dto.endTime ? new Date(dto.endTime) : undefined,
          comment: dto.comment == null ? undefined : dto.comment.trim(),
        },
        include: leadCallInclude,
      });

      if (expertUserId !== existing.expertUserId) await tx.lead.update({ where: { id: leadId }, data: { assignedExpertUserId: expertUserId, expertStartedAt: null } });

      await tx.leadActivity.create({
        data: {
          leadId,
          actorUserId: managerId,
          type: LEAD_ACTIVITY.EXPERT_CALL_UPDATED,
          metadata: {
            callId,
            previousExpertUserId: existing.expertUserId,
            expertUserId,
            startTime: updated.startTime.toISOString(),
            endTime: updated.endTime.toISOString(),
          },
        },
      });

      const notification =
        expertUserId !== existing.expertUserId
          ? await tx.notificationLog.create({
              data: {
                userId: expertUserId,
                leadId,
                channel: "IN_APP",
                type: "LEAD_EXPERT_CALL_REQUEST",
                status: "SENT",
                content: "Новый запрос на созвон с лидом",
                metadata: { callId },
                scheduledFor: new Date(),
                sentAt: new Date(),
              },
            })
          : null;

      if (expertUserId !== existing.expertUserId || updated.startTime.getTime() !== existing.startTime.getTime() || updated.endTime.getTime() !== existing.endTime.getTime()) {
        await scheduleLeadCallNotifications(tx, updated);
      }
      return { updated, previousExpertUserId: existing.expertUserId, notification };
    });

    this.realtime.emitExpertLeadUpdated(result.updated.expertUserId, leadId);
    if (result.previousExpertUserId !== result.updated.expertUserId) {
      this.realtime.emitExpertLeadUpdated(result.previousExpertUserId, leadId);
      this.realtime.emitExpertCallRemoved(result.previousExpertUserId, callId);
    }
    if (result.notification) this.realtime.emitNotification(result.updated.expertUserId, result.notification);
    this.realtime.emitExpertCallUpdated(result.updated.expertUserId, managerId, result.updated);
    return result.updated;
  }

  /** Returns an expert-owned call while hiding soft-deleted leads. */
  async detailForExpert(expertUserId: number, callId: number) {
    const call = await this.prisma.leadExpertCall.findFirst({
      where: { id: callId, expertUserId, lead: { deletedAt: null } },
      include: leadCallInclude,
    });
    if (!call) throw new NotFoundException("Lead expert call not found");
    return call;
  }

  /** Confirms or declines a current request atomically; only online confirmations create a meeting. */
  async respond(expertUserId: number, callId: number, dto: RespondLeadExpertCallDto) {
    const result = await leadTransaction(this.prisma, async tx => {
      const call = await tx.leadExpertCall.findFirst({
        where: { id: callId, expertUserId, lead: { assignedExpertUserId: expertUserId, deletedAt: null } },
        include: { expertUser: { include: { consultantProfile: true } }, lead: true, invitation: true },
      });
      if (!call) throw new NotFoundException("Lead expert call not found");
      if (call.status !== LeadExpertCallStatus.REQUESTED) {
        throw new ConflictException("Only a pending expert call can be answered");
      }

      const now = new Date();
      if (dto.action === "confirm") {
        if (call.startTime <= now) {
          throw new ConflictException("A past expert call cannot be confirmed");
        }

        const consultantProfileId = call.expertUser.consultantProfile?.id;
        if (!consultantProfileId) throw new NotFoundException("ConsultantProfile not found");

        const meeting =
          call.format === "OFFICE"
            ? null
            : await tx.meeting.create({
                data: {
                  roomName: call.invitation?.roomName ?? uuidv4(),
                  expertId: consultantProfileId,
                  startTime: call.startTime,
                  endTime: call.endTime,
                  status: MeetingStatus.SCHEDULED,
                },
              });
        const updated = await tx.leadExpertCall.update({
          where: { id: call.id },
          data: {
            status: LeadExpertCallStatus.CONFIRMED,
            responseComment: dto.comment?.trim(),
            respondedAt: now,
            meetingId: meeting?.id,
          },
          include: leadCallInclude,
        });
        await tx.leadActivity.create({
          data: {
            leadId: call.leadId,
            actorUserId: expertUserId,
            type: LEAD_ACTIVITY.EXPERT_CALL_CONFIRMED,
            metadata: { callId: call.id, meetingId: meeting?.id ?? null },
          },
        });
        const notification = await this.createManagerNotification(tx, call.salesManagerId, call.leadId, "Эксперт подтвердил созвон", call.id);
        return { updated, notification };
      }

      await tx.lead.update({ where: { id: call.leadId }, data: call.invitationId ? { status: LeadStatus.RECALL, callbackReason: "FOLLOW_UP" } : { status: LeadStatus.NEW } });
      const updated = await tx.leadExpertCall.update({
        where: { id: call.id },
        data: {
          status: LeadExpertCallStatus.DECLINED,
          responseComment: dto.comment?.trim(),
          respondedAt: now,
        },
        include: leadCallInclude,
      });
      await tx.leadActivity.create({
        data: {
          leadId: call.leadId,
          actorUserId: expertUserId,
          type: LEAD_ACTIVITY.EXPERT_CALL_DECLINED,
          metadata: { callId: call.id, comment: dto.comment?.trim() ?? null },
        },
      });
      const notification = await this.createManagerNotification(tx, call.salesManagerId, call.leadId, "Эксперт отклонил запрос на созвон", call.id);
      return { updated, notification };
    });

    this.realtime.emitExpertCallUpdated(expertUserId, result.updated.salesManagerId, result.updated);
    this.realtime.emitNotification(result.updated.salesManagerId, result.notification);
    this.realtime.emitLeadUpdated(result.updated.salesManagerId, result.updated.lead);
    this.realtime.emitExpertLeadUpdated(expertUserId, result.updated.leadId);
    return result.updated;
  }

  /** Validates the chronological interval and the minimum four-hour booking notice. */
  private parseTimes(startValue: string, endValue: string) {
    const startTime = new Date(startValue);
    const endTime = new Date(endValue);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || startTime >= endTime) {
      throw new BadRequestException("startTime must be earlier than endTime");
    }
    if (startTime.getTime() < Date.now() + MEETING_BOOKING_MIN_LEAD_MS) {
      throw new BadRequestException(`Meetings must be booked at least ${MEETING_BOOKING_MIN_LEAD_HOURS} hours in advance`);
    }
    return { startTime, endTime };
  }

  /** Requires the complete consultation interval to fit an expert schedule on one local day. */
  private async assertConfiguredSlot(tx: Prisma.TransactionClient, expertUserId: number, timezone: string, startTime: Date, endTime: Date) {
    const localStart = getLocalDateParts(startTime, timezone || "Asia/Almaty");
    const localEnd = getLocalDateParts(endTime, timezone || "Asia/Almaty");
    if (localStart.year !== localEnd.year || localStart.month !== localEnd.month || localStart.day !== localEnd.day) {
      throw new BadRequestException("Expert call must start and end on the same local day");
    }

    const slot = await tx.expertSchedule.findFirst({
      where: {
        expertId: expertUserId,
        dayOfWeek: localStart.dayOfWeek,
        startMinute: { lte: localStart.minuteOfDay },
        endMinute: { gte: localEnd.minuteOfDay },
      },
    });
    if (!slot) throw new BadRequestException("Selected time is outside the expert schedule");
  }

  /** Rejects overlaps with consultations or active lead calls while the expert booking lock is held. */
  private async assertSlotAvailable(tx: Prisma.TransactionClient, expertUserId: number, consultantProfileId: number, startTime: Date, endTime: Date, excludeCallId?: number) {
    const consultation = await tx.consultation.findFirst({
      select: { id: true },
      where: {
        consultantProfileId,
        status: { not: "CANCELLED" },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
    });
    const leadCall = await tx.leadExpertCall.findFirst({
      select: { id: true },
      where: {
        expertUserId,
        ...(excludeCallId == null ? {} : { id: { not: excludeCallId } }),
        status: { in: [LeadExpertCallStatus.REQUESTED, LeadExpertCallStatus.CONFIRMED] },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
    });
    if (consultation || leadCall) throw new ConflictException("This expert slot is already booked");
  }

  /** Rejects missing, deleted, or non-expert users before listing requests. */
  private async requireExpert(userId: number) {
    const expert = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null, role: { code: "EXPERT" } }, select: { id: true } });
    if (!expert) throw new NotFoundException("Expert not found");
  }

  /** Persists a delivered in-app response notification inside the call transaction. */
  private createManagerNotification(tx: Prisma.TransactionClient, managerId: number, leadId: number, content: string, callId: number) {
    const now = new Date();
    return tx.notificationLog.create({
      data: {
        userId: managerId,
        leadId,
        channel: "IN_APP",
        type: "LEAD_EXPERT_CALL_RESPONSE",
        status: "SENT",
        content,
        metadata: { callId },
        scheduledFor: now,
        sentAt: now,
      },
    });
  }
}
