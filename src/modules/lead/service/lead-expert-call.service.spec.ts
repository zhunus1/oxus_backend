import { ConflictException } from "@nestjs/common";
import { LeadExpertCallStatus } from "generated/prisma/client";
import type { PrismaService } from "src/database/prisma.service";
import type { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import { LeadExpertCallService } from "./lead-expert-call.service";

jest.mock("generated/prisma/client", () => ({
  LeadStatus: { NEW: "NEW", CALL_SCHEDULED: "CALL_SCHEDULED" },
  LeadCallbackStatus: { SCHEDULED: "SCHEDULED", CANCELLED: "CANCELLED" },
  LeadExpertCallStatus: { REQUESTED: "REQUESTED", CONFIRMED: "CONFIRMED", DECLINED: "DECLINED", CANCELLED: "CANCELLED" },
  MeetingStatus: { SCHEDULED: "SCHEDULED" },
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}));

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("uuid", () => ({ v4: jest.fn(() => "lead-meeting-room") }));

describe("LeadExpertCallService", () => {
  const emitExpertCallRequested = jest.fn();
  const emitExpertCallUpdated = jest.fn();
  const emitLeadUpdated = jest.fn();
  const emitNotification = jest.fn();
  const realtime = {
    emitExpertCallRequested,
    emitExpertCallUpdated,
    emitLeadUpdated,
    emitNotification,
  } as unknown as LeadRealtimeGateway;

  beforeEach(() => jest.clearAllMocks());

  it("creates an expert request inside a configured availability block", async () => {
    const startTime = new Date();
    startTime.setUTCDate(startTime.getUTCDate() + 2);
    startTime.setUTCHours(10, 0, 0, 0);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
    const createdCall = {
      id: 6,
      leadId: 8,
      salesManagerId: 17,
      expertUserId: 23,
      startTime,
      endTime,
      lead: { id: 8, status: "CALL_SCHEDULED" },
    };
    const notification = { id: 11, userId: 23 };
    const leadCallFindFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      lead: {
        findFirst: jest.fn().mockResolvedValue({ id: 8 }),
        update: jest.fn().mockResolvedValue({ id: 8 }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 23, timezone: "UTC", consultantProfile: { id: 31 } }),
      },
      expertSchedule: { findFirst: jest.fn().mockResolvedValue({ id: 4 }) },
      consultation: { findFirst: jest.fn().mockResolvedValue(null) },
      leadExpertCall: {
        findFirst: leadCallFindFirst,
        create: jest.fn().mockResolvedValue(createdCall),
      },
      leadCallback: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      notificationLog: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue(notification),
      },
      leadActivity: { create: jest.fn().mockResolvedValue({ id: 5 }) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async operation => operation(tx)),
    } as unknown as PrismaService;
    const service = new LeadExpertCallService(prisma, realtime);

    const result = await service.create(17, 8, {
      expertUserId: 23,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      comment: "  Parent consultation  ",
    });

    expect(tx.expertSchedule.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        expertId: 23,
        startMinute: { lte: 600 },
        endMinute: { gte: 630 },
      }),
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.leadExpertCall.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: 8,
          salesManagerId: 17,
          expertUserId: 23,
          comment: "Parent consultation",
        }),
      }),
    );
    expect(emitExpertCallRequested).toHaveBeenCalledWith(23, createdCall);
    expect(emitNotification).toHaveBeenCalledWith(23, notification);
    expect(result).toBe(createdCall);
  });

  it("creates the Meeting only after the expert confirms", async () => {
    const startTime = new Date();
    startTime.setUTCDate(startTime.getUTCDate() + 2);
    startTime.setUTCHours(10, 0, 0, 0);
    const call = {
      id: 6,
      leadId: 8,
      salesManagerId: 17,
      expertUserId: 23,
      status: "REQUESTED",
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
      expertUser: { consultantProfile: { id: 31 } },
      lead: { id: 8 },
    };
    const updated = { ...call, status: "CONFIRMED", meetingId: "meeting-1" };
    const notification = { id: 12, userId: 17 };
    const tx = {
      leadExpertCall: {
        findFirst: jest.fn().mockResolvedValue(call),
        update: jest.fn().mockResolvedValue(updated),
      },
      meeting: { create: jest.fn().mockResolvedValue({ id: "meeting-1" }) },
      leadActivity: { create: jest.fn().mockResolvedValue({ id: 7 }) },
      notificationLog: { create: jest.fn().mockResolvedValue(notification) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async operation => operation(tx)),
    } as unknown as PrismaService;
    const service = new LeadExpertCallService(prisma, realtime);

    const result = await service.respond(23, 6, { action: "confirm" });

    expect(tx.meeting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roomName: "lead-meeting-room",
        expertId: 31,
        startTime: call.startTime,
        endTime: call.endTime,
      }),
    });
    expect(emitExpertCallUpdated).toHaveBeenCalledWith(23, 17, updated);
    expect(emitNotification).toHaveBeenCalledWith(17, notification);
    expect(result).toBe(updated);
  });

  it("does not create a Meeting when an expert confirms an already expired call", async () => {
    const call = {
      id: 6,
      leadId: 8,
      salesManagerId: 17,
      expertUserId: 23,
      status: "REQUESTED",
      startTime: new Date(Date.now() - 60 * 60 * 1000),
      endTime: new Date(Date.now() - 30 * 60 * 1000),
      expertUser: { consultantProfile: { id: 31 } },
      lead: { id: 8 },
    };
    const tx = {
      leadExpertCall: {
        findFirst: jest.fn().mockResolvedValue(call),
        update: jest.fn(),
      },
      meeting: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async operation => operation(tx)),
    } as unknown as PrismaService;
    const service = new LeadExpertCallService(prisma, realtime);

    await expect(service.respond(23, 6, { action: "confirm" })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.meeting.create).not.toHaveBeenCalled();
    expect(tx.leadExpertCall.update).not.toHaveBeenCalled();
  });

  it("returns a declined call to the responsible manager's NEW queue", async () => {
    const call = {
      id: 6,
      leadId: 8,
      salesManagerId: 17,
      expertUserId: 23,
      status: "REQUESTED",
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endTime: new Date(Date.now() + 25 * 60 * 60 * 1000),
      expertUser: { consultantProfile: { id: 31 } },
      lead: { id: 8, assignedSalesManagerId: 17 },
    };
    const updated = { ...call, status: "DECLINED", lead: { ...call.lead, status: "NEW" } };
    const notification = { id: 12, userId: 17 };
    const tx = {
      lead: { update: jest.fn().mockResolvedValue({ id: 8, status: "NEW" }) },
      leadExpertCall: {
        findFirst: jest.fn().mockResolvedValue(call),
        update: jest.fn().mockResolvedValue(updated),
      },
      leadActivity: { create: jest.fn().mockResolvedValue({ id: 7 }) },
      notificationLog: { create: jest.fn().mockResolvedValue(notification) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async operation => operation(tx)),
    } as unknown as PrismaService;
    const service = new LeadExpertCallService(prisma, realtime);

    await service.respond(23, 6, { action: "decline", comment: "  Busy  " });

    expect(tx.lead.update).toHaveBeenCalledWith({ where: { id: 8 }, data: { status: "NEW" } });
    expect(tx.leadExpertCall.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 6 },
        data: expect.objectContaining({ status: "DECLINED", responseComment: "Busy" }),
      }),
    );
    expect(emitLeadUpdated).toHaveBeenCalledWith(17, updated.lead);
  });

  it("sorts pending calls chronologically but history from newest to oldest", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 23 }) },
      leadExpertCall: { findMany, count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new LeadExpertCallService(prisma, realtime);

    await service.listForExpert(23, { status: LeadExpertCallStatus.REQUESTED, page: 1, limit: 20 });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ startTime: "asc" }, { id: "asc" }] }));

    await service.listForExpert(23, { page: 1, limit: 20 });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ startTime: "desc" }, { id: "desc" }] }));
  });
});
