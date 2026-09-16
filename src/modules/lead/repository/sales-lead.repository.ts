import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LeadCallbackReason, LeadCallbackStatus, LeadExpertCallStatus, LeadStatus, MeetingStatus, Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { SalesLeadQueryDto } from "../api/dto/sales/sales-lead-query.dto";
import { leadTransaction } from "../domain/lead-transaction";
import { leadStatusUpdate } from "../domain/lead-status";
import { LEAD_ACTIVITY } from "../domain/lead.constants";

const salesManagerSelect = {
  id: true,
  firstname: true,
  lastname: true,
} as const;

const salesLeadListInclude = {
  originSource: { select: { id: true, code: true, name: true } },
  assignedSalesManager: { select: salesManagerSelect },
  callbacks: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
  },
  expertCalls: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    include: {
      expertUser: { select: salesManagerSelect },
    },
  },
  submissions: {
    orderBy: [{ receivedAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: { id: true, metrics: true, receivedAt: true },
  },
} satisfies Prisma.LeadInclude;

const salesLeadDetailInclude = {
  ...salesLeadListInclude,
  createdByUser: { select: salesManagerSelect },
  submissions: {
    orderBy: [{ receivedAt: "desc" as const }, { id: "desc" as const }],
    include: { source: { select: { id: true, code: true, name: true } } },
  },
} satisfies Prisma.LeadInclude;

/** Persists Sales lead transitions atomically and scopes reads to manager visibility. */
@Injectable()
export class SalesLeadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Includes unassigned leads only in the NEW queue; all other statuses belong to the manager. */
  private visibleWhere(managerId: number, status: LeadStatus): Prisma.LeadWhereInput {
    if (status === LeadStatus.NEW) {
      return {
        status,
        OR: [{ assignedSalesManagerId: null }, { assignedSalesManagerId: managerId }],
      };
    }

    return { status, assignedSalesManagerId: managerId };
  }

  /** Paginates visible leads with deterministic latest snapshots and safe contact or ID search. */
  async list(managerId: number, query: SalesLeadQueryDto) {
    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...this.visibleWhere(managerId, query.status),
    };

    if (query.source) where.originSource = { code: query.source };

    const search = query.search?.trim();
    if (search) {
      const numericId = /^\d+$/.test(search) ? Number(search) : NaN;
      // Lead IDs are PostgreSQL int4; unformatted phone numbers are often larger.
      const id = Number.isSafeInteger(numericId) && numericId > 0 && numericId <= 2_147_483_647 ? numericId : null;
      const phoneDigits = search.replace(/\D/g, "");
      const phoneSearch = phoneDigits.length >= 3 ? phoneDigits : search;
      where.AND = [
        {
          OR: [
            { displayName: { contains: search, mode: "insensitive" } },
            { phoneNumber: { contains: phoneSearch } },
            { email: { contains: search, mode: "insensitive" } },
            ...(id != null ? [{ id }] : []),
          ],
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: salesLeadListInclude,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { data, total };
  }

  /** Counts visible leads by status in one query and returns zero for empty statuses. */
  async summary(managerId: number) {
    const statuses = [
      LeadStatus.NEW,
      LeadStatus.CALL_SCHEDULED,
      LeadStatus.RECALL,
      LeadStatus.REJECTED,
      LeadStatus.OFFICE_INVITED,
      LeadStatus.CONTRACT_PENDING,
      LeadStatus.CONVERTED,
    ];
    const counts = await this.prisma.lead.groupBy({
      by: ["status"],
      where: {
        deletedAt: null,
        OR: [{ assignedSalesManagerId: managerId }, { status: LeadStatus.NEW, assignedSalesManagerId: null }],
      },
      _count: { _all: true },
    });
    const summary = Object.fromEntries(statuses.map(status => [status, 0])) as Record<LeadStatus, number>;
    for (const row of counts) summary[row.status] = row._count._all;
    return summary;
  }

  /** Loads a card only when it is unassigned and new, or owned by this manager. */
  findVisibleById(leadId: number, managerId: number) {
    return this.prisma.lead.findFirst({
      where: {
        id: leadId,
        deletedAt: null,
        OR: [{ status: LeadStatus.NEW, assignedSalesManagerId: null }, { assignedSalesManagerId: managerId }],
      },
      include: salesLeadDetailInclude,
    });
  }

  /** Checks ownership using only the lead ID, without loading questionnaire history. */
  findOwnedById(leadId: number, managerId: number) {
    return this.prisma.lead.findFirst({
      where: { id: leadId, assignedSalesManagerId: managerId, deletedAt: null },
      select: { id: true },
    });
  }

  /** Claims an unassigned NEW lead with one conditional update; losing a race returns null. */
  async accept(leadId: number, managerId: number) {
    return this.prisma.$transaction(async tx => {
      const result = await tx.lead.updateMany({
        where: {
          id: leadId,
          status: LeadStatus.NEW,
          assignedSalesManagerId: null,
          deletedAt: null,
        },
        data: { assignedSalesManagerId: managerId, acceptedAt: new Date() },
      });

      if (result.count !== 1) return null;

      await tx.leadActivity.create({
        data: { leadId, actorUserId: managerId, type: LEAD_ACTIVITY.ACCEPTED },
      });

      return tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: salesLeadDetailInclude });
    });
  }

  /** Schedules a callback and reminder while cancelling previous callbacks and consultations atomically. */
  async createCallback(leadId: number, managerId: number, scheduledFor: Date, comment?: string, reason?: LeadCallbackReason) {
    return leadTransaction(this.prisma, async tx => {
      const owned = await this.requireMutableOwned(tx, leadId, managerId);
      const callbackReason = reason ?? owned.callbackReason;
      const cancelledExpertCalls = await this.cancelActiveExpertCalls(tx, leadId, managerId, "CALLBACK_SCHEDULED");
      await tx.leadCallback.updateMany({
        where: { leadId, status: LeadCallbackStatus.SCHEDULED },
        data: { status: LeadCallbackStatus.CANCELLED, cancelledAt: new Date() },
      });
      await tx.notificationLog.updateMany({
        where: { leadId, userId: managerId, type: "LEAD_CALLBACK_REMINDER", status: "PENDING" },
        data: { status: "CANCELLED" },
      });

      const callback = await tx.leadCallback.create({
        data: { leadId, salesManagerId: managerId, scheduledFor, comment, reason: callbackReason },
      });
      const notification = await tx.notificationLog.create({
        data: {
          userId: managerId,
          leadId,
          channel: "IN_APP",
          type: "LEAD_CALLBACK_REMINDER",
          status: "PENDING",
          content: "",
          metadata: { callbackId: callback.id, params: { leadName: owned.displayName ?? null } },
          scheduledFor,
        },
      });
      const lead = await tx.lead.update({
        where: { id: leadId },
        data: { ...leadStatusUpdate(owned.status, LeadStatus.RECALL), callbackReason, rejectedAt: null, rejectionReason: null },
        include: salesLeadDetailInclude,
      });
      await tx.leadActivity.create({
        data: {
          leadId,
          actorUserId: managerId,
          type: LEAD_ACTIVITY.CALLBACK_SCHEDULED,
          metadata: { callbackId: callback.id, scheduledFor: scheduledFor.toISOString() },
        },
      });

      return { lead, callback, notification, cancelledExpertCalls };
    });
  }

  /** Edits an active callback; comment and reason changes preserve the existing reminder. */
  async updateCallback(
    callbackId: number,
    leadId: number,
    managerId: number,
    data: { scheduledFor?: Date; status?: LeadCallbackStatus; comment?: string; reason?: LeadCallbackReason },
  ) {
    return leadTransaction(this.prisma, async tx => {
      const owned = await this.requireMutableOwned(tx, leadId, managerId);
      const existing = await tx.leadCallback.findFirst({
        where: { id: callbackId, leadId, salesManagerId: managerId },
      });
      if (!existing) return { kind: "not_found" as const };
      if (existing.status !== LeadCallbackStatus.SCHEDULED) {
        return { kind: "not_editable" as const };
      }

      const status = data.status ?? existing.status;
      const scheduledFor = data.scheduledFor ?? existing.scheduledFor;
      const callback = await tx.leadCallback.update({
        where: { id: callbackId },
        data: {
          scheduledFor,
          comment: data.comment,
          ...(data.reason !== undefined ? { reason: data.reason } : {}),
          status,
          completedAt: status === LeadCallbackStatus.COMPLETED ? new Date() : null,
          cancelledAt: status === LeadCallbackStatus.CANCELLED ? new Date() : null,
        },
      });

      const reminderChanged = status !== LeadCallbackStatus.SCHEDULED || scheduledFor.getTime() !== existing.scheduledFor.getTime();
      if (reminderChanged)
        await tx.notificationLog.updateMany({
          where: { leadId, userId: managerId, type: "LEAD_CALLBACK_REMINDER", status: "PENDING" },
          data: { status: "CANCELLED" },
        });

      const notification =
        reminderChanged && status === LeadCallbackStatus.SCHEDULED
          ? await tx.notificationLog.create({
              data: {
                userId: managerId,
                leadId,
                channel: "IN_APP",
                type: "LEAD_CALLBACK_REMINDER",
                status: "PENDING",
                content: "",
                metadata: { callbackId, params: { leadName: owned.displayName ?? null } },
                scheduledFor,
              },
            })
          : null;

      await tx.leadActivity.create({
        data: {
          leadId,
          actorUserId: managerId,
          type: LEAD_ACTIVITY.CALLBACK_UPDATED,
          metadata: { callbackId, status, scheduledFor: scheduledFor.toISOString(), ...(data.reason !== undefined ? { reason: data.reason } : {}) },
        },
      });

      const lead =
        status === LeadCallbackStatus.SCHEDULED && data.reason === undefined
          ? await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: salesLeadDetailInclude })
          : await tx.lead.update({
              where: { id: leadId },
              data: {
                ...(status !== LeadCallbackStatus.SCHEDULED ? leadStatusUpdate(owned.status, owned.assignedExpertUserId ? LeadStatus.RECALL : LeadStatus.NEW) : {}),
                ...(data.reason !== undefined ? { callbackReason: data.reason } : {}),
              },
              include: salesLeadDetailInclude,
            });

      return { kind: "updated" as const, callback, notification, lead };
    });
  }

  /** Closes an owned lead and cancels its active consultations, callbacks, and pending notifications. */
  async reject(leadId: number, managerId: number, reason: string) {
    return leadTransaction(this.prisma, async tx => {
      const owned = await this.requireMutableOwned(tx, leadId, managerId);
      await tx.leadCallback.updateMany({
        where: { leadId, status: LeadCallbackStatus.SCHEDULED },
        data: { status: LeadCallbackStatus.CANCELLED, cancelledAt: new Date() },
      });
      const cancelledExpertCalls = await this.cancelActiveExpertCalls(tx, leadId, managerId, "LEAD_REJECTED");
      await tx.notificationLog.updateMany({
        where: { leadId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });

      const lead = await tx.lead.update({
        where: { id: leadId },
        data: { ...leadStatusUpdate(owned.status, LeadStatus.REJECTED), rejectedAt: new Date(), rejectionReason: reason },
        include: salesLeadDetailInclude,
      });
      await tx.leadActivity.create({
        data: { leadId, actorUserId: managerId, type: LEAD_ACTIVITY.REJECTED, metadata: { reason } },
      });
      return { lead, cancelledExpertCalls };
    });
  }

  /** Rechecks ownership inside the transaction and prevents changes after contract preparation. */
  private async requireMutableOwned(tx: Prisma.TransactionClient, leadId: number, managerId: number) {
    const lead = await tx.lead.findFirst({ where: { id: leadId, assignedSalesManagerId: managerId, deletedAt: null } });
    if (!lead) throw new NotFoundException("Lead not found");
    if (lead.contractId) throw new ConflictException("Lead is already in the contract process");
    return lead;
  }

  /** Cancels active lead calls and linked meetings, recording an activity for each call. */
  private async cancelActiveExpertCalls(tx: Prisma.TransactionClient, leadId: number, actorUserId: number, reason: string) {
    const activeCalls = await tx.leadExpertCall.findMany({
      where: { leadId, status: { in: [LeadExpertCallStatus.REQUESTED, LeadExpertCallStatus.CONFIRMED] } },
      select: { id: true, expertUserId: true, meetingId: true },
    });
    if (activeCalls.length === 0) return activeCalls;

    const callIds = activeCalls.map(call => call.id);
    await tx.leadExpertCall.updateMany({
      where: { id: { in: callIds } },
      data: { status: LeadExpertCallStatus.CANCELLED },
    });

    const meetingIds = activeCalls.flatMap(call => (call.meetingId ? [call.meetingId] : []));
    if (meetingIds.length) {
      await tx.meeting.updateMany({ where: { id: { in: meetingIds } }, data: { status: MeetingStatus.CANCELLED } });
    }

    await tx.leadActivity.createMany({
      data: activeCalls.map(call => ({
        leadId,
        actorUserId,
        type: LEAD_ACTIVITY.EXPERT_CALL_CANCELLED,
        metadata: { callId: call.id, reason },
      })),
    });
    return activeCalls;
  }

  /** Returns ordered activity history after the service has checked access to the lead. */
  activities(leadId: number) {
    return this.prisma.leadActivity.findMany({
      where: { leadId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { actorUser: { select: salesManagerSelect } },
    });
  }

  /** Lists enabled lead sources for Sales filtering and manual entry. */
  sources() {
    return this.prisma.leadSource.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  }
}

export { salesLeadDetailInclude, salesLeadListInclude, salesManagerSelect };
