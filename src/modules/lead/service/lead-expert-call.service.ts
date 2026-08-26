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

const leadCallInclude = {
  lead: {
    select: {
      id: true,
      displayName: true,
      role: true,
      preferredLanguage: true,
      status: true,
    },
  },
  salesManager: { select: { id: true, firstname: true, lastname: true } },
  expertUser: { select: { id: true, firstname: true, lastname: true, timezone: true } },
  meeting: true,
} as const;

@Injectable()
export class LeadExpertCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: LeadRealtimeGateway,
  ) {}

  async create(managerId: number, leadId: number, dto: CreateLeadExpertCallDto) {
    const { startTime, endTime } = this.parseTimes(dto.startTime, dto.endTime);
    const call = await this.runSerializable(async tx => {
      const lead = await tx.lead.findFirst({
        where: { id: leadId, assignedSalesManagerId: managerId, deletedAt: null },
      });
      if (!lead) throw new NotFoundException("Lead not found");

      const expert = await tx.user.findFirst({
        where: { id: dto.expertUserId, deletedAt: null, role: { code: "EXPERT" } },
        include: { consultantProfile: true },
      });
      if (!expert?.consultantProfile) throw new NotFoundException("Expert not found");

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
        data: { status: LeadStatus.CALL_SCHEDULED, rejectedAt: null, rejectionReason: null },
      });
      const created = await tx.leadExpertCall.create({
        data: {
          leadId,
          salesManagerId: managerId,
          expertUserId: expert.id,
          startTime,
          endTime,
          comment: dto.comment?.trim(),
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
      return { created, notification };
    });

    this.realtime.emitExpertCallRequested(call.created.expertUserId, call.created);
    this.realtime.emitNotification(call.created.expertUserId, call.notification);
    this.realtime.emitLeadUpdated(managerId, call.created.lead);
    return call.created;
  }

  async listForExpert(expertUserId: number, query: ExpertLeadCallQueryDto) {
    await this.requireExpert(expertUserId);
    const where: Prisma.LeadExpertCallWhereInput = { expertUserId };
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

  async pendingForExpert(expertUserId: number) {
    await this.requireExpert(expertUserId);
    return this.prisma.leadExpertCall.findMany({
      where: { expertUserId, status: LeadExpertCallStatus.REQUESTED },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      include: leadCallInclude,
    });
  }

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

  async update(managerId: number, leadId: number, callId: number, dto: UpdateLeadExpertCallDto) {
    if (dto.expertUserId == null && dto.startTime == null && dto.endTime == null && dto.comment == null) {
      throw new BadRequestException("At least one field must be provided");
    }

    const result = await this.runSerializable(async tx => {
      const existing = await tx.leadExpertCall.findFirst({
        where: { id: callId, leadId, salesManagerId: managerId },
      });
      if (!existing) throw new NotFoundException("Lead expert call not found");
      if (existing.status !== LeadExpertCallStatus.REQUESTED) {
        throw new ConflictException("Only a pending expert call can be updated");
      }

      const expertUserId = dto.expertUserId ?? existing.expertUserId;
      const startValue = dto.startTime ?? existing.startTime.toISOString();
      const endValue = dto.endTime ?? existing.endTime.toISOString();
      const scheduleChanged = dto.expertUserId != null || dto.startTime != null || dto.endTime != null;

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

      return { updated, previousExpertUserId: existing.expertUserId, notification };
    });

    if (result.previousExpertUserId !== result.updated.expertUserId) {
      this.realtime.emitExpertCallRemoved(result.previousExpertUserId, callId);
    }
    if (result.notification) this.realtime.emitNotification(result.updated.expertUserId, result.notification);
    this.realtime.emitExpertCallUpdated(result.updated.expertUserId, managerId, result.updated);
    return result.updated;
  }

  async detailForExpert(expertUserId: number, callId: number) {
    const call = await this.prisma.leadExpertCall.findFirst({
      where: { id: callId, expertUserId },
      include: leadCallInclude,
    });
    if (!call) throw new NotFoundException("Lead expert call not found");
    return call;
  }

  async respond(expertUserId: number, callId: number, dto: RespondLeadExpertCallDto) {
    const result = await this.runSerializable(async tx => {
      const call = await tx.leadExpertCall.findFirst({
        where: { id: callId, expertUserId },
        include: { expertUser: { include: { consultantProfile: true } }, lead: true },
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

        const meeting = await tx.meeting.create({
          data: {
            roomName: uuidv4(),
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
            meetingId: meeting.id,
          },
          include: leadCallInclude,
        });
        await tx.leadActivity.create({
          data: {
            leadId: call.leadId,
            actorUserId: expertUserId,
            type: LEAD_ACTIVITY.EXPERT_CALL_CONFIRMED,
            metadata: { callId: call.id, meetingId: meeting.id },
          },
        });
        const notification = await this.createManagerNotification(tx, call.salesManagerId, call.leadId, "Эксперт подтвердил созвон", call.id);
        return { updated, notification };
      }

      await tx.lead.update({ where: { id: call.leadId }, data: { status: LeadStatus.NEW } });
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
    return result.updated;
  }

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

  private async assertSlotAvailable(tx: Prisma.TransactionClient, expertUserId: number, consultantProfileId: number, startTime: Date, endTime: Date, excludeCallId?: number) {
    const [consultation, leadCall] = await Promise.all([
      tx.consultation.findFirst({
        where: {
          consultantProfileId,
          status: { not: "CANCELLED" },
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      }),
      tx.leadExpertCall.findFirst({
        where: {
          expertUserId,
          ...(excludeCallId == null ? {} : { id: { not: excludeCallId } }),
          status: { in: [LeadExpertCallStatus.REQUESTED, LeadExpertCallStatus.CONFIRMED] },
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      }),
    ]);
    if (consultation || leadCall) throw new ConflictException("This expert slot is already booked");
  }

  private async requireExpert(userId: number) {
    const expert = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null, role: { code: "EXPERT" } }, select: { id: true } });
    if (!expert) throw new NotFoundException("Expert not found");
  }

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

  private async runSerializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
        if (code === "P2034" && attempt < 3) continue;
        if (code === "P2002") throw new ConflictException("Lead or expert slot was reserved concurrently");
        throw error;
      }
    }
    throw new ConflictException("Could not reserve the selected slot");
  }
}
