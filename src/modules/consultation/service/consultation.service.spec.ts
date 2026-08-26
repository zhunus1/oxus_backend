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

  const repository = {
    findConsultantProfileByUserId,
    findByConsultantProfileId,
    findPendingByConsultantProfileId,
    findHistoryPageByConsultantProfileId,
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
});
