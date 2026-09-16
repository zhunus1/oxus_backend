import { BadRequestException, ConflictException } from "@nestjs/common";
import type { LeadNotificationService } from "./lead-notification.service";
import type { LeadIngestionService } from "./lead-ingestion.service";
import type { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import type { SalesLeadRepository } from "../repository/sales-lead.repository";
import { SalesLeadService } from "./sales-lead.service";

jest.mock("generated/prisma/client", () => ({
  LeadStatus: { NEW: "NEW", CALL_SCHEDULED: "CALL_SCHEDULED", RECALL: "RECALL", REJECTED: "REJECTED" },
  LeadCallbackStatus: { SCHEDULED: "SCHEDULED", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED" },
  LeadExpertCallStatus: { REQUESTED: "REQUESTED", CONFIRMED: "CONFIRMED", DECLINED: "DECLINED", CANCELLED: "CANCELLED" },
  MeetingStatus: { SCHEDULED: "SCHEDULED", CANCELLED: "CANCELLED" },
}));

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("SalesLeadService", () => {
  const accept = jest.fn();
  const findOwnedById = jest.fn();
  const createCallback = jest.fn();
  const updateCallback = jest.fn();
  const repo = {
    accept,
    findOwnedById,
    createCallback,
    updateCallback,
  } as unknown as SalesLeadRepository;
  const emitLeadAccepted = jest.fn();
  const emitLeadUpdated = jest.fn();
  const emitExpertCallRemoved = jest.fn();
  const realtime = {
    emitLeadAccepted,
    emitLeadUpdated,
    emitExpertCallRemoved,
  } as unknown as LeadRealtimeGateway;
  const schedule = jest.fn();
  const notifications = { schedule } as unknown as LeadNotificationService;
  const service = new SalesLeadService(repo, {} as LeadIngestionService, realtime, notifications);

  beforeEach(() => jest.clearAllMocks());

  it("returns a conflict when another manager has already accepted the lead", async () => {
    accept.mockResolvedValue(null);

    await expect(service.accept(17, 8)).rejects.toBeInstanceOf(ConflictException);
    expect(emitLeadAccepted).not.toHaveBeenCalled();
  });

  it("requires callback timestamps to use 15-minute increments", async () => {
    findOwnedById.mockResolvedValue({ id: 8 });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    future.setUTCMinutes(7, 0, 0);

    await expect(service.createCallback(17, 8, { scheduledFor: future.toISOString() })).rejects.toBeInstanceOf(BadRequestException);
    expect(createCallback).not.toHaveBeenCalled();
  });

  it("notifies an expert when a scheduled call is replaced by a callback", async () => {
    findOwnedById.mockResolvedValue({ id: 8 });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    future.setUTCMinutes(15, 0, 0);
    createCallback.mockResolvedValue({
      lead: { id: 8 },
      callback: { id: 4 },
      notification: { id: 9, scheduledFor: future },
      cancelledExpertCalls: [{ id: 6, expertUserId: 23 }],
    });

    const result = await service.createCallback(17, 8, { scheduledFor: future.toISOString() });

    expect(emitExpertCallRemoved).toHaveBeenCalledWith(23, 6);
    expect(schedule).toHaveBeenCalled();
    expect(result).toEqual({ lead: { id: 8 }, callback: { id: 4 } });
    expect(result).not.toHaveProperty("notification");
    expect(result).not.toHaveProperty("cancelledExpertCalls");
  });

  it("does not allow a finalized callback to be changed again", async () => {
    findOwnedById.mockResolvedValue({ id: 8 });
    updateCallback.mockResolvedValue({ kind: "not_editable" });

    await expect(service.updateCallback(17, 8, 4, { comment: "Changed too late" })).rejects.toBeInstanceOf(ConflictException);
    expect(emitLeadUpdated).not.toHaveBeenCalled();
  });

  it("passes a reason-only update to persistence and refreshes the card without scheduling a new reminder", async () => {
    findOwnedById.mockResolvedValue({ id: 8 });
    const lead = { id: 8, callbackReason: "FOLLOW_UP" };
    const callback = { id: 4, reason: "FOLLOW_UP" };
    updateCallback.mockResolvedValue({ kind: "updated", lead, callback, notification: null });

    await expect(service.updateCallback(17, 8, 4, { reason: "FOLLOW_UP" })).resolves.toEqual({ lead, callback });
    expect(updateCallback).toHaveBeenCalledWith(4, 8, 17, expect.objectContaining({ reason: "FOLLOW_UP" }));
    expect(emitLeadUpdated).toHaveBeenCalledWith(17, lead);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("returns a conflict instead of a 500 after an exhausted serialization retry", async () => {
    findOwnedById.mockResolvedValue({ id: 8 });
    updateCallback.mockRejectedValue(new ConflictException("The lead changed concurrently"));

    await expect(service.updateCallback(17, 8, 4, { comment: "Concurrent edit" })).rejects.toBeInstanceOf(ConflictException);
  });
});
