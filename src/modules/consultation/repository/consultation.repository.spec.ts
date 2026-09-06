import { ConsultationStatus } from "generated/prisma/client";
import type { PrismaService } from "src/database/prisma.service";
import { ConsultationRepository } from "./consultation.repository";

jest.mock("generated/prisma/client", () => ({
  ConsultationStatus: {
    REQUESTED: "REQUESTED",
    CONFIRMED: "CONFIRMED",
    DONE: "DONE",
    CANCELLED: "CANCELLED",
  },
  LeadExpertCallStatus: {
    REQUESTED: "REQUESTED",
    CONFIRMED: "CONFIRMED",
  },
  MeetingStatus: { SCHEDULED: "SCHEDULED" },
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}));

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("uuid", () => ({ v4: jest.fn(() => "meeting-room-id") }));

type MeetingsRepositoryContract = ConsultationRepository & {
  findPendingByConsultantProfileId(consultantProfileId: number): Promise<unknown[]>;
  findHistoryPageByConsultantProfileId(consultantProfileId: number, page: number, limit: number): Promise<{ data: unknown[]; totalItems: number }>;
};

describe("ConsultationRepository expert meeting lists", () => {
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const count = jest.fn();
  const prisma = {
    consultation: {
      findMany,
      count,
    },
    leadExpertCall: {
      findFirst,
    },
  } as unknown as PrismaService;

  const repository = new ConsultationRepository(prisma) as MeetingsRepositoryContract;

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
  });

  it("loads every pending request independently from the paginated meeting history", async () => {
    await repository.findPendingByConsultantProfileId(42);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          consultantProfileId: 42,
          status: ConsultationStatus.REQUESTED,
        },
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
      }),
    );

    const query = findMany.mock.calls[0]?.[0];
    expect(query).not.toHaveProperty("skip");
    expect(query).not.toHaveProperty("take");
  });

  it("paginates non-pending meetings and returns the total history size", async () => {
    const pageRows = [{ id: 11 }, { id: 10 }];
    findMany.mockResolvedValue(pageRows);
    count.mockResolvedValue(12);

    const result = await repository.findHistoryPageByConsultantProfileId(42, 2, 10);

    const historyWhere = {
      consultantProfileId: 42,
      status: { not: ConsultationStatus.REQUESTED },
    };
    expect(count).toHaveBeenCalledWith({ where: historyWhere });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: historyWhere,
        skip: 10,
        take: 10,
        orderBy: [{ startTime: "desc" }, { id: "desc" }],
      }),
    );
    expect(result).toEqual({ data: pageRows, totalItems: 12 });
  });

  it("serializes reservations and refuses to create a consultation over a Sales call", async () => {
    const transactionClient = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      consultation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      leadExpertCall: {
        findFirst: jest.fn().mockResolvedValue({ id: 6 }),
      },
      studentPackage: { update: jest.fn() },
    };
    const transactionalPrisma = {
      $transaction: jest.fn().mockImplementation(async operation => operation(transactionClient)),
    } as unknown as PrismaService;
    const transactionalRepository = new ConsultationRepository(transactionalPrisma);

    const result = await transactionalRepository.createIfExpertAvailable({
      clientId: 7,
      consultantId: 42,
      expertUserId: 23,
      startTime: "2026-09-01T10:00:00.000Z",
      endTime: "2026-09-01T10:30:00.000Z",
      status: ConsultationStatus.REQUESTED,
    });

    expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transactionClient.leadExpertCall.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: expect.objectContaining({
        expertUserId: 23,
        status: { in: ["REQUESTED", "CONFIRMED"] },
      }),
    });
    expect(result).toBeNull();
    expect(transactionClient.consultation.create).not.toHaveBeenCalled();
  });

  it("creates the consultation and consumes its package slot in one transaction", async () => {
    const created = { id: 101 };
    const transactionClient = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      consultation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
      leadExpertCall: { findFirst: jest.fn().mockResolvedValue(null) },
      studentPackage: { update: jest.fn().mockResolvedValue({ id: 9, usedSlots: 1 }) },
    };
    const transactionalPrisma = {
      $transaction: jest.fn().mockImplementation(async operation => operation(transactionClient)),
    } as unknown as PrismaService;
    const transactionalRepository = new ConsultationRepository(transactionalPrisma);

    await expect(
      transactionalRepository.createIfExpertAvailable({
        clientId: 7,
        consultantId: 42,
        expertUserId: 23,
        packageId: 9,
        startTime: "2026-09-01T10:00:00.000Z",
        endTime: "2026-09-01T10:30:00.000Z",
        status: ConsultationStatus.REQUESTED,
      }),
    ).resolves.toBe(created);

    expect(transactionClient.studentPackage.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { usedSlots: { increment: 1 } },
    });
  });
});
