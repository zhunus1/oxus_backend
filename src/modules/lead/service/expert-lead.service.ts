import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LeadStatus, Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { ExpertLeadQueryDto } from "../api/dto/sales/expert-lead-query.dto";
import { ExpertFollowUpDto, ExpertQuestionnaireDto } from "../api/dto/sales/sales-v2.dto";
import { leadTransaction } from "../domain/lead-transaction";
import { leadStatusUpdate } from "../domain/lead-status";
import { salesLeadDetailInclude, salesLeadListInclude } from "../repository/sales-lead.repository";
import { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";

const tabStatuses: Record<ExpertLeadQueryDto["tab"], LeadStatus[]> = {
  NEW: ["CALL_SCHEDULED", "OFFICE_INVITED"],
  FOLLOW_UP: ["RECALL"],
  CONTRACTS: ["CONTRACT_PENDING", "CONVERTED"],
  ARCHIVE: ["REJECTED", "NEW"],
};
/** Handles assigned Expert cards, consultation outcomes, and incremental questionnaire snapshots. */
@Injectable()
export class ExpertLeadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: LeadRealtimeGateway,
  ) {}

  /** Paginates the expert assigned leads by workflow tab without exposing other experts cards. */
  async list(expertId: number, query: ExpertLeadQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.LeadWhereInput = {
      assignedExpertUserId: expertId,
      deletedAt: null,
      status: { in: tabStatuses[query.tab] },
      ...(query.source ? { originSource: { code: query.source } } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: "insensitive" } },
              { phoneNumber: { contains: search.replace(/[^\d+]/g, "") || search } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: salesLeadListInclude,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: query.tab === "NEW" ? [{ statusChangedAt: "desc" }, { id: "desc" }] : [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  /** Aggregates assigned lead statuses into the Expert tab counters. */
  async summary(expertId: number) {
    const groups = await this.prisma.lead.groupBy({ by: ["status"], where: { assignedExpertUserId: expertId, deletedAt: null }, _count: { _all: true } });
    return Object.fromEntries(
      Object.entries(tabStatuses).map(([tab, statuses]) => [tab, groups.filter(g => statuses.includes(g.status)).reduce((sum, g) => sum + g._count._all, 0)]),
    );
  }

  /** Loads an assigned card with its questionnaire, consultation history, and contract summary. */
  async detail(expertId: number, leadId: number) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, assignedExpertUserId: expertId, deletedAt: null },
      include: {
        ...salesLeadDetailInclude,
        expertCalls: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { expertUser: { select: { id: true, firstname: true, lastname: true } } } },
        activities: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        contract: { select: { id: true, status: true, studentId: true, subscriptionTier: true, price: true, currency: true } },
      },
    });
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  /** Idempotently marks work on an assigned consultation lead; it does not claim a lead or confirm a meeting. */
  async start(expertId: number, leadId: number) {
    const result = await this.prisma.lead.updateMany({
      where: { id: leadId, assignedExpertUserId: expertId, deletedAt: null, expertStartedAt: null, status: { in: tabStatuses.NEW } },
      data: { expertStartedAt: new Date() },
    });
    if (result.count) this.realtime.emitExpertLeadUpdated(expertId, leadId);
    return this.detail(expertId, leadId);
  }

  /** Merges validated questionnaire fields atomically and clears answers hidden by disabled options. */
  async saveQuestionnaire(expertId: number, leadId: number, dto: ExpertQuestionnaireDto) {
    const lead = await leadTransaction(this.prisma, async tx => {
      const existing = await this.owned(tx, expertId, leadId);
      if (
        dto.birthDate &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(dto.birthDate) || new Date(dto.birthDate).toISOString().slice(0, 10) !== dto.birthDate || new Date(dto.birthDate) >= new Date())
      )
        throw new BadRequestException("Birth date must be a past calendar date");
      if (dto.citizenshipCountryId && !(await tx.country.findUnique({ where: { id: dto.citizenshipCountryId }, select: { id: true } })))
        throw new BadRequestException("Unknown citizenship country");
      const previous = (existing.expertQuestionnaire ?? {}) as Prisma.JsonObject;
      const answers = { ...previous, ...JSON.parse(JSON.stringify(dto)), version: "expert-v2" };
      if (answers.nonEnglishStudy === false) answers.studyLanguages = [];
      if (answers.specialConditions === false) answers.specialConditionsComment = null;
      await tx.leadActivity.create({ data: { leadId, actorUserId: expertId, type: "EXPERT_QUESTIONNAIRE_SAVED" } });
      return tx.lead.update({ where: { id: leadId }, data: { expertQuestionnaire: answers } });
    });
    this.changed(lead);
    return lead;
  }

  /** Records the consultation outcome and returns the lead to Sales while retaining its expert. */
  async followUp(expertId: number, leadId: number, dto: ExpertFollowUpDto) {
    const result = await leadTransaction(this.prisma, async tx => {
      const lead = await this.owned(tx, expertId, leadId);
      if (!["CALL_SCHEDULED", "OFFICE_INVITED"].includes(lead.status)) throw new ConflictException("Lead is not awaiting a consultation outcome");
      const call = await tx.leadExpertCall.findFirst({ where: { leadId, expertUserId: expertId, status: { in: ["REQUESTED", "CONFIRMED"] } }, orderBy: { createdAt: "desc" } });
      if (!call) throw new ConflictException("No active consultation");
      if (dto.reason !== "RESCHEDULED" && call.startTime > new Date()) throw new ConflictException("Consultation has not started yet");
      if (dto.reason === "FOLLOW_UP" && call.status !== "CONFIRMED") throw new ConflictException("Confirm the consultation before recording its outcome");
      await tx.leadExpertCall.update({
        where: { id: call.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          outcome: dto.reason,
          responseComment: dto.comment?.trim(),
          questionnaire: lead.expertQuestionnaire ?? Prisma.JsonNull,
        },
      });
      if (call.meetingId) await tx.meeting.update({ where: { id: call.meetingId }, data: { status: "COMPLETED" } });
      await tx.notificationLog.updateMany({ where: { leadId, type: "LEAD_EXPERT_CALL_REQUEST", status: "PENDING" }, data: { status: "CANCELLED" } });
      const updated = await tx.lead.update({ where: { id: leadId }, data: { ...leadStatusUpdate(lead.status, "RECALL"), callbackReason: "FOLLOW_UP" } });
      await tx.leadActivity.create({
        data: { leadId, actorUserId: expertId, type: "EXPERT_FOLLOW_UP", metadata: { callId: call.id, reason: dto.reason, comment: dto.comment?.trim() ?? null } },
      });
      const notification = await tx.notificationLog.create({
        data: {
          leadId,
          userId: call.salesManagerId,
          channel: "IN_APP",
          type: "LEAD_FOLLOW_UP",
          status: "SENT",
          sentAt: new Date(),
          scheduledFor: new Date(),
          content: "",
          metadata: { leadId, reason: dto.reason, params: { leadName: lead.displayName ?? null, leadId, reason: dto.reason } },
        },
      });
      return { lead: updated, call, notification };
    });
    this.changed(result.lead);
    this.realtime.emitExpertCallRemoved(expertId, result.call.id);
    this.realtime.emitNotification(result.notification.userId, result.notification);
    return result.lead;
  }

  /** Requires a live assigned lead that has neither entered contracting nor been rejected. */
  private async owned(tx: Prisma.TransactionClient, expertId: number, leadId: number) {
    const lead = await tx.lead.findFirst({ where: { id: leadId, assignedExpertUserId: expertId, deletedAt: null } });
    if (!lead) throw new NotFoundException("Lead not found");
    if (lead.contractId || lead.status === "REJECTED") throw new ConflictException("Lead cannot be edited in its current state");
    return lead;
  }

  /** Notifies the assigned Sales manager and Expert after a lead transaction commits. */
  private changed(lead: { id: number; assignedSalesManagerId: number | null; assignedExpertUserId: number | null }) {
    if (lead.assignedSalesManagerId) this.realtime.emitLeadUpdated(lead.assignedSalesManagerId, lead);
    if (lead.assignedExpertUserId) this.realtime.emitExpertLeadUpdated(lead.assignedExpertUserId, lead.id);
  }
}
