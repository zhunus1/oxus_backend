import { BadRequestException } from "@nestjs/common";
import type { Queue } from "bullmq";
import type { SmsService } from "src/modules/sms/sms.service";
import type { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import type { ConsultationRepository } from "../repository/consultation.repository";
import { ConsultationService } from "./consultation.service";

jest.mock("generated/prisma/enums", () => ({
  ConsultationStatus: {
    REQUESTED: "REQUESTED",
    CONFIRMED: "CONFIRMED",
    DONE: "DONE",
    CANCELLED: "CANCELLED",
  },
}));

jest.mock("../repository/consultation.repository", () => ({ ConsultationRepository: class {} }));
jest.mock("src/modules/user-journey/user-journey-log.service", () => ({ UserJourneyLogService: class {} }));
jest.mock("src/modules/sms/sms.service", () => ({ SmsService: class {} }));

describe("ConsultationService expert meeting lists", () => {
  const findConsultantProfileByUserId = jest.fn();
  const findByConsultantProfileId = jest.fn();
  const findPendingByConsultantProfileId = jest.fn();
  const findHistoryPageByConsultantProfileId = jest.fn();
  const findPortraitByUserId = jest.fn();
  const findStudentPackage = jest.fn();
  const findConsultantProfileWithUserById = jest.fn();
  const findExpertScheduleByUserIdAndDay = jest.fn();
  const findOverlappingConsultation = jest.fn();
  const findOverlappingLeadExpertCall = jest.fn();
  const create = jest.fn();
  const createIfExpertAvailable = jest.fn();

  const repository = {
    findConsultantProfileByUserId,
    findByConsultantProfileId,
    findPendingByConsultantProfileId,
    findHistoryPageByConsultantProfileId,
    findPortraitByUserId,
    findStudentPackage,
    findConsultantProfileWithUserById,
    findExpertScheduleByUserIdAndDay,
    findOverlappingConsultation,
    findOverlappingLeadExpertCall,
    create,
    createIfExpertAvailable,
  } as unknown as ConsultationRepository;

  const service = new ConsultationService(repository, {} as Queue, {} as UserJourneyLogService, {} as SmsService);

  const meeting = {
    id: 101,
    startTime: new Date("2026-09-01T10:00:00.000Z"),
    endTime: new Date("2026-09-01T11:00:00.000Z"),
    consultant: { user: { timezone: "UTC" } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findConsultantProfileByUserId.mockResolvedValue({ id: 42 });
    findPortraitByUserId.mockResolvedValue({ consultantProfileId: 42 });
    findStudentPackage.mockResolvedValue(null);
    findConsultantProfileWithUserById.mockResolvedValue({ id: 42, user: { id: 23, timezone: "UTC" } });
    findExpertScheduleByUserIdAndDay.mockResolvedValue([{ startMinute: 0, endMinute: 1440 }]);
    findOverlappingConsultation.mockResolvedValue(null);
    findOverlappingLeadExpertCall.mockResolvedValue(null);
    createIfExpertAvailable.mockResolvedValue({ id: 101 });
  });

  it("returns pending requests from the dedicated unpaginated repository query", async () => {
    findPendingByConsultantProfileId.mockResolvedValue([meeting]);

    const result = await service.findMyPendingExpertMeetings(7);

    expect(findPendingByConsultantProfileId).toHaveBeenCalledWith(42);
    expect(findByConsultantProfileId).not.toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({
        id: 101,
        startTimeLocal: "01/09/2026, 10:00",
        endTimeLocal: "01/09/2026, 11:00",
      }),
    ]);
  });

  it("returns localized history rows with pagination metadata", async () => {
    findHistoryPageByConsultantProfileId.mockResolvedValue({ data: [meeting], totalItems: 19 });

    const result = await service.findMyExpertMeetingHistory(7, { page: 2, limit: 9 });

    expect(findHistoryPageByConsultantProfileId).toHaveBeenCalledWith(42, 2, 9);
    expect(result.meta).toEqual({
      page: 2,
      limit: 9,
      totalItems: 19,
      totalPages: 3,
    });
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        id: 101,
        startTimeLocal: "01/09/2026, 10:00",
        endTimeLocal: "01/09/2026, 11:00",
      }),
    );
  });

  it("rejects a student consultation when a Sales call already occupies the expert slot", async () => {
    const startTime = new Date();
    startTime.setUTCDate(startTime.getUTCDate() + 2);
    startTime.setUTCHours(10, 0, 0, 0);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
    createIfExpertAvailable.mockResolvedValue(null);

    await expect(service.book(7, { startTime: startTime.toISOString(), endTime: endTime.toISOString() })).rejects.toBeInstanceOf(BadRequestException);

    expect(createIfExpertAvailable).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 7,
        consultantId: 42,
        expertUserId: 23,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a consultation that crosses the expert's local calendar day", async () => {
    const startTime = new Date();
    startTime.setUTCDate(startTime.getUTCDate() + 2);
    startTime.setUTCHours(23, 30, 0, 0);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

    await expect(service.book(7, { startTime: startTime.toISOString(), endTime: endTime.toISOString() })).rejects.toThrow(
      "A consultation must start and end on the same local day",
    );

    expect(findExpertScheduleByUserIdAndDay).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
