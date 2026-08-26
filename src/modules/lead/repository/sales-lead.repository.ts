import { Injectable } from "@nestjs/common";
import { LeadCallbackStatus, LeadExpertCallStatus, LeadStatus, MeetingStatus, Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { SalesLeadQueryDto } from "../api/dto/sales/sales-lead-query.dto";
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
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  expertCalls: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    include: {
      expertUser: { select: salesManagerSelect },
    },
  },
  submissions: {
    orderBy: { receivedAt: "desc" as const },
    take: 1,
    select: { id: true, metrics: true, receivedAt: true },
  },
} as const;

const salesLeadDetailInclude = {
  ...salesLeadListInclude,
  createdByUser: { select: salesManagerSelect },
  submissions: {
    orderBy: { receivedAt: "desc" as const },
    include: { source: { select: { id: true, code: true, name: true } } },
  },
} as const;

@Injectable()
export class SalesLeadRepository {
  constructor(private readonly prisma: PrismaService) {}

  private visibleWhere(managerId: number, status: LeadStatus): Prisma.LeadWhereInput {
    if (status === LeadStatus.NEW) {
      return {
        status,
        OR: [{ assignedSalesManagerId: null }, { assignedSalesManagerId: managerId }],
      };
    }

    return { status, assignedSalesManagerId: managerId };
  }

  async list(managerId: number, query: SalesLeadQueryDto) {
    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...this.visibleWhere(managerId, query.status),
    };

    if (query.source) where.originSource = { code: query.source };

    const search = query.search?.trim();
    if (search) {
      const id = /^\d+$/.test(search) ? Number(search) : null;
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

  async summary(managerId: number) {
    const statuses = [LeadStatus.NEW, LeadStatus.CALL_SCHEDULED, LeadStatus.RECALL, LeadStatus.REJECTED];
    const counts = await Promise.all(
      statuses.map(status =>
        this.prisma.lead.count({
          where: {
            deletedAt: null,
            ...this.visibleWhere(managerId, status),
          },
        }),
      ),
    );

    return Object.fromEntries(statuses.map((status, index) => [status, counts[index]])) as Record<LeadStatus, number>;
  }

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

  findOwnedById(leadId: number, managerId: number) {
    return this.prisma.lead.findFirst({
      where: { id: leadId, assignedSalesManagerId: managerId, deletedAt: null },
      include: salesLeadDetailInclude,
    });
  }

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

  async createCallback(leadId: number, managerId: number, scheduledFor: Date, comment?: string) {
    return this.runSerializable(async tx => {
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
        data: { leadId, salesManagerId: managerId, scheduledFor, comment },
      });
      const notification = await tx.notificationLog.create({
        data: {
          userId: managerId,
          leadId,
          channel: "IN_APP",
          type: "LEAD_CALLBACK_REMINDER",
          status: "PENDING",
          content: "Пора перезвонить клиенту",
          metadata: { callbackId: callback.id },
          scheduledFor,
        },
      });
      const lead = await tx.lead.update({
        where: { id: leadId },
        data: { status: LeadStatus.RECALL, rejectedAt: null, rejectionReason: null },
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

  async updateCallback(callbackId: number, leadId: number, managerId: number, data: { scheduledFor?: Date; status?: LeadCallbackStatus; comment?: string }) {
    return this.runSerializable(async tx => {
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
          status,
          completedAt: status === LeadCallbackStatus.COMPLETED ? new Date() : null,
          cancelledAt: status === LeadCallbackStatus.CANCELLED ? new Date() : null,
        },
      });

      await tx.notificationLog.updateMany({
        where: { leadId, userId: managerId, type: "LEAD_CALLBACK_REMINDER", status: "PENDING" },
        data: { status: "CANCELLED" },
      });

      const notification =
        status === LeadCallbackStatus.SCHEDULED
          ? await tx.notificationLog.create({
              data: {
                userId: managerId,
                leadId,
                channel: "IN_APP",
                type: "LEAD_CALLBACK_REMINDER",
                status: "PENDING",
                content: "Пора перезвонить клиенту",
                metadata: { callbackId },
                scheduledFor,
              },
            })
          : null;

      await tx.leadActivity.create({
        data: {
          leadId,
          actorUserId: managerId,
          type: LEAD_ACTIVITY.CALLBACK_UPDATED,
          metadata: { callbackId, status, scheduledFor: scheduledFor.toISOString() },
        },
      });

      const lead =
        status === LeadCallbackStatus.SCHEDULED
          ? await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: salesLeadDetailInclude })
          : await tx.lead.update({
              where: { id: leadId },
              data: { status: LeadStatus.NEW },
              include: salesLeadDetailInclude,
            });

      return { kind: "updated" as const, callback, notification, lead };
    });
  }

  async reject(leadId: number, managerId: number, reason: string) {
    return this.runSerializable(async tx => {
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
        data: { status: LeadStatus.REJECTED, rejectedAt: new Date(), rejectionReason: reason },
        include: salesLeadDetailInclude,
      });
      await tx.leadActivity.create({
        data: { leadId, actorUserId: managerId, type: LEAD_ACTIVITY.REJECTED, metadata: { reason } },
      });
      return { lead, cancelledExpertCalls };
    });
  }

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

  private async runSerializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
        if ((code === "P2034" || code === "P2002") && attempt < 3) continue;
        throw error;
      }
    }
    throw new Error("Unreachable transaction retry state");
  }

  activities(leadId: number) {
    return this.prisma.leadActivity.findMany({
      where: { leadId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { actorUser: { select: salesManagerSelect } },
    });
  }

  sources() {
    return this.prisma.leadSource.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  }
}

export { salesLeadDetailInclude, salesLeadListInclude, salesManagerSelect };
