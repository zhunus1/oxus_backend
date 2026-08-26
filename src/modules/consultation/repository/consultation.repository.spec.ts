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
  MeetingStatus: { SCHEDULED: "SCHEDULED" },
}));

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("uuid", () => ({ v4: jest.fn(() => "meeting-room-id") }));

type MeetingsRepositoryContract = ConsultationRepository & {
  findPendingByConsultantProfileId(consultantProfileId: number): Promise<unknown[]>;
  findHistoryPageByConsultantProfileId(consultantProfileId: number, page: number, limit: number): Promise<{ data: unknown[]; totalItems: number }>;
};

describe("ConsultationRepository expert meeting lists", () => {
  const findMany = jest.fn();
  const count = jest.fn();
  const prisma = {
    consultation: {
      findMany,
      count,
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
});
