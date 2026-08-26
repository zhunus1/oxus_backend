import type { PrismaService } from "src/database/prisma.service";
import type { ExpertScheduleRepository } from "../repository/expert-schedule.repository";
import { ExpertScheduleService } from "./expert-schedule.service";

jest.mock("generated/prisma/enums", () => ({
  ConsultationStatus: { CANCELLED: "CANCELLED" },
  LeadExpertCallStatus: { REQUESTED: "REQUESTED", CONFIRMED: "CONFIRMED" },
}));

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("../repository/expert-schedule.repository", () => ({ ExpertScheduleRepository: class {} }));

describe("ExpertScheduleService availability", () => {
  const findConsultantProfileByUserId = jest.fn();
  const findByExpertUserId = jest.fn();
  const findConsultationsForExpertInRange = jest.fn();
  const findLeadCallsForExpertInRange = jest.fn();
  const repository = {
    findConsultantProfileByUserId,
    findByExpertUserId,
    findConsultationsForExpertInRange,
    findLeadCallsForExpertInRange,
  } as unknown as ExpertScheduleRepository;
  const service = new ExpertScheduleService(repository, {} as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    findConsultantProfileByUserId.mockResolvedValue({ id: 31, user: { timezone: "UTC" } });
    findConsultationsForExpertInRange.mockResolvedValue([]);
    findLeadCallsForExpertInRange.mockResolvedValue([]);
  });

  it("queries bookings through the end of the final requested calendar day", async () => {
    const requestedDay = new Date();
    requestedDay.setUTCDate(requestedDay.getUTCDate() + 7);
    requestedDay.setUTCHours(0, 0, 0, 0);
    const date = requestedDay.toISOString().slice(0, 10);
    const nextDay = new Date(requestedDay.getTime() + 24 * 60 * 60 * 1000);
    const jsDay = requestedDay.getUTCDay();
    const dayOfWeek = jsDay === 0 ? 7 : jsDay;
    const slotStart = new Date(requestedDay);
    slotStart.setUTCHours(10, 0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

    findByExpertUserId.mockResolvedValue([{ dayOfWeek, startMinute: 600, endMinute: 630 }]);
    findLeadCallsForExpertInRange.mockResolvedValue([{ id: 6, startTime: slotStart, endTime: slotEnd, status: "REQUESTED" }]);

    const result = await service.getAvailableSlots(23, { from: date, to: date });

    expect(findConsultationsForExpertInRange).toHaveBeenCalledWith(31, requestedDay, nextDay);
    expect(findLeadCallsForExpertInRange).toHaveBeenCalledWith(23, requestedDay, nextDay);
    expect(result).toEqual([]);
  });

  it("rejects an unbounded availability query before accessing the database", async () => {
    await expect(service.getAvailableSlots(23, { from: "2026-01-01", to: "2026-12-31" })).rejects.toThrow("Availability range cannot exceed 62 days");

    expect(findConsultantProfileByUserId).not.toHaveBeenCalled();
  });
});
