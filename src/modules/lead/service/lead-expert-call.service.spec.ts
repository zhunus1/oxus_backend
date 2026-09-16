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
    emitExpertLeadUpdated: jest.fn(),
    emitExpertCallRequested,
    emitExpertCallUpdated,
    emitLeadUpdated,
    emitNotification,
  } as unknown as LeadRealtimeGateway;

  beforeEach(() => jest.clearAllMocks());

  describe("preview conflict codes", () => {
    const startTime = new Date();
    startTime.setUTCDate(startTime.getUTCDate() + 2);
    startTime.setUTCHours(10, 0, 0, 0);
    const dto = { expertUserId: 23, format: "ONLINE" as const, startTime: startTime.toISOString(), endTime: new Date(startTime.getTime() + 1800_000).toISOString() };
    const leadFindFirst = jest.fn();
    const callFindFirst = jest.fn();
    const consultationFindFirst = jest.fn();
    const createInvitation = jest.fn();
    const prisma = {
      lead: { findFirst: leadFindFirst },
      user: { findFirst: jest.fn().mockResolvedValue({ firstname: "Expert", lastname: "Name", timezone: "UTC", consultantProfile: { id: 31 } }) },
      expertSchedule: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      consultation: { findFirst: consultationFindFirst },
      leadExpertCall: { findFirst: callFindFirst },
      leadMeetingInvitation: { create: createInvitation },
    };
    const service = new LeadExpertCallService(prisma as unknown as PrismaService, realtime);

    beforeEach(() => {
      leadFindFirst.mockResolvedValue({ id: 8, submissions: [] });
      callFindFirst.mockResolvedValue(null);
      consultationFindFirst.mockResolvedValue(null);
      createInvitation.mockResolvedValue({ id: "invitation-1", expiresAt: startTime });
    });

    it.each([
      [{ id: 6, leadId: 8 }, null, "LEAD_MEETING_ALREADY_SCHEDULED"],
      [{ id: 7, leadId: 9 }, null, "EXPERT_SLOT_UNAVAILABLE"],
      [null, { id: 10 }, "EXPERT_SLOT_UNAVAILABLE"],
    ])("distinguishes a saved meeting from another booking: %j / %j", async (call, consultation, code) => {
      callFindFirst.mockResolvedValue(call);
      consultationFindFirst.mockResolvedValue(consultation);
      await expect(service.preview(17, 8, dto)).rejects.toMatchObject({
        status: 409,
        response: {
          statusCode: 409,
          error: "Conflict",
          code,
          message: "This expert slot is already booked",
        },
      });
      expect(createInvitation).not.toHaveBeenCalled();
      expect(callFindFirst).toHaveBeenCalledTimes(1);
    });

    it("identifies a lead already in the contract process", async () => {
      leadFindFirst.mockResolvedValue({ id: 8, contractId: "contract-1" });
      await expect(service.preview(17, 8, dto)).rejects.toMatchObject({ status: 409, response: { code: "LEAD_CONTRACT_IN_PROGRESS", message: "Lead is already being converted" } });
      expect(callFindFirst).not.toHaveBeenCalled();
      expect(createInvitation).not.toHaveBeenCalled();
    });

    it("checks ownership before disclosing any booking conflict", async () => {
      leadFindFirst.mockResolvedValue(null);
      await expect(service.preview(17, 8, dto)).rejects.toMatchObject({ status: 404 });
      expect(leadFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 8, assignedSalesManagerId: 17, deletedAt: null } }));
      expect(callFindFirst).not.toHaveBeenCalled();
      expect(createInvitation).not.toHaveBeenCalled();
    });

    it("still creates a preview for a free configured slot", async () => {
      await expect(service.preview(17, 8, dto)).resolves.toMatchObject({
        invitationId: "invitation-1",
        timezone: "UTC",
        messages: { ru: expect.any(String), kk: expect.any(String) },
      });
      expect(createInvitation).toHaveBeenCalledTimes(1);
    });
  });

  it("returns the confirmed Shymkent office address and permits deployment overrides", () => {
    const previous = process.env.SALES_OFFICE_SHYMKENT_ADDRESS;
    try {
      delete process.env.SALES_OFFICE_SHYMKENT_ADDRESS;
      const service = new LeadExpertCallService({} as PrismaService, realtime);
      expect(service.offices().find(office => office.code === "shymkent")).toEqual({
        code: "shymkent",
        city: "Шымкент",
        address: "г. Шымкент, ул. Байтерекова 2Б",
        testAddress: false,
      });
      process.env.SALES_OFFICE_SHYMKENT_ADDRESS = "Configured address";
      expect(service.offices().find(office => office.code === "shymkent")?.address).toBe("Configured address");
    } finally {
      if (previous === undefined) delete process.env.SALES_OFFICE_SHYMKENT_ADDRESS;
      else process.env.SALES_OFFICE_SHYMKENT_ADDRESS = previous;
    }
  });

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
      updatedAt: new Date(),
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
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
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
    expect(tx.notificationLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ userId: 23, channel: "EMAIL", type: "LEAD_EXPERT_CALL_ASSIGNED", status: "PENDING" }),
        expect.objectContaining({ userId: 23, channel: "EMAIL", type: "LEAD_EXPERT_CALL_REMINDER", scheduledFor: new Date(startTime.getTime() - 600_000) }),
      ]),
      skipDuplicates: true,
    });
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
    expect(tx.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "LEAD_EXPERT_CALL_RESPONSE",
        content: "",
        metadata: { callId: 6, params: { response: "CONFIRMED" } },
      }),
    });
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

    expect(tx.lead.update).toHaveBeenCalledWith({ where: { id: 8 }, data: { status: "NEW", statusChangedAt: expect.any(Date) } });
    expect(tx.leadExpertCall.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 6 },
        data: expect.objectContaining({ status: "DECLINED", responseComment: "Busy" }),
      }),
    );
    expect(emitLeadUpdated).toHaveBeenCalledWith(17, updated.lead);
    expect(tx.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "LEAD_EXPERT_CALL_RESPONSE",
        content: "",
        metadata: { callId: 6, params: { response: "DECLINED" } },
      }),
    });
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
