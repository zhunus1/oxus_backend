import { LeadCallbackStatus, LeadStatus } from "generated/prisma/client";
import type { PrismaService } from "src/database/prisma.service";
import { SalesLeadRepository } from "./sales-lead.repository";

jest.mock("generated/prisma/client", () => ({
  LeadStatus: { NEW: "NEW", CALL_SCHEDULED: "CALL_SCHEDULED", RECALL: "RECALL", REJECTED: "REJECTED" },
  LeadCallbackStatus: { SCHEDULED: "SCHEDULED", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED" },
  LeadExpertCallStatus: { REQUESTED: "REQUESTED", CONFIRMED: "CONFIRMED", DECLINED: "DECLINED", CANCELLED: "CANCELLED" },
  MeetingStatus: { SCHEDULED: "SCHEDULED", CANCELLED: "CANCELLED" },
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}));

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("SalesLeadRepository visibility and acceptance", () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    lead: { findMany, count },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
  const repository = new SalesLeadRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
  });

  it("shows only unassigned or own leads in the NEW queue", async () => {
    await repository.list(17, { status: LeadStatus.NEW, page: 1, limit: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: LeadStatus.NEW,
          OR: [{ assignedSalesManagerId: null }, { assignedSalesManagerId: 17 }],
        }),
      }),
    );
  });

  it("shows only the current manager's non-new leads", async () => {
    await repository.list(17, { status: LeadStatus.RECALL, page: 1, limit: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: LeadStatus.RECALL,
          assignedSalesManagerId: 17,
        }),
      }),
    );
  });

  it("searches normalized phones even when the manager enters formatted digits", async () => {
    await repository.list(17, { status: LeadStatus.NEW, search: "+7 777", page: 1, limit: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: expect.arrayContaining([{ phoneNumber: { contains: "7777" } }]),
            },
          ],
        }),
      }),
    );
  });

  it("claims a lead with one conditional update and loses cleanly on a race", async () => {
    const tx = {
      lead: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      leadActivity: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async operation => operation(tx));

    await expect(repository.accept(8, 17)).resolves.toBeNull();
    expect(tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 8, status: LeadStatus.NEW, assignedSalesManagerId: null, deletedAt: null },
      data: { assignedSalesManagerId: 17, acceptedAt: expect.any(Date) },
    });
    expect(tx.leadActivity.create).not.toHaveBeenCalled();
  });

  it("returns a finalized callback to NEW while retaining ownership", async () => {
    const scheduledFor = new Date("2026-09-01T10:00:00.000Z");
    const callback = { id: 4, status: "COMPLETED", scheduledFor };
    const lead = { id: 8, assignedSalesManagerId: 17, status: "NEW" };
    const tx = {
      leadCallback: {
        findFirst: jest.fn().mockResolvedValue({ id: 4, status: "SCHEDULED", scheduledFor }),
        update: jest.fn().mockResolvedValue(callback),
      },
      notificationLog: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      leadActivity: { create: jest.fn().mockResolvedValue({ id: 12 }) },
      lead: { findFirst: jest.fn().mockResolvedValue(lead), update: jest.fn().mockResolvedValue(lead) },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async operation => operation(tx));

    const result = await repository.updateCallback(4, 8, 17, { status: LeadCallbackStatus.COMPLETED });

    expect(tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8 },
        data: { status: LeadStatus.NEW },
      }),
    );
    expect(result).toEqual({ kind: "updated", callback, notification: null, lead });
  });

  it("does not mutate a completed callback", async () => {
    const tx = {
      lead: { findFirst: jest.fn().mockResolvedValue({ id: 8, assignedSalesManagerId: 17 }) },
      leadCallback: {
        findFirst: jest.fn().mockResolvedValue({ id: 4, status: "COMPLETED" }),
        update: jest.fn(),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async operation => operation(tx));

    await expect(repository.updateCallback(4, 8, 17, { comment: "again" })).resolves.toEqual({ kind: "not_editable" });
    expect(tx.leadCallback.update).not.toHaveBeenCalled();
  });
});
