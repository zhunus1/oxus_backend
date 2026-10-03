import { NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { ExpressSubmissionDto } from "../api/dto/express-submission.dto";
import type { LeadIngestionRepository } from "../repository/lead-ingestion.repository";
import { LandingCalculatorAdapter } from "./landing-calculator.adapter";
import { LeadIngestionService } from "./lead-ingestion.service";
import { LegacyContactFormAdapter } from "./legacy-contact-form.adapter";
import { OfficeManualAdapter } from "./office-manual.adapter";
import { ExpressAdapter } from "./express.adapter";

jest.mock("generated/prisma/client", () => ({ Prisma: {} }));
jest.mock("../repository/lead-ingestion.repository", () => ({ LeadIngestionRepository: class {} }));

describe("LeadIngestionService", () => {
  const findSourceByCode = jest.fn();
  const findByExternalSubmission = jest.fn();
  const createLeadWithSubmission = jest.fn();
  const isUniqueConstraintError = jest.fn();
  const countCountries = jest.fn();
  const repository = {
    findSourceByCode,
    findByExternalSubmission,
    createLeadWithSubmission,
    isUniqueConstraintError,
    countCountries,
  } as unknown as LeadIngestionRepository;
  const service = new LeadIngestionService(repository, new LandingCalculatorAdapter(), new OfficeManualAdapter(), new LegacyContactFormAdapter(), new ExpressAdapter(repository));

  const expressPayload: ExpressSubmissionDto = {
    submissionId: "1bec4c5e-177d-4d1c-b8dd-4a580507523f",
    locale: "ru",
    firstName: "Алихан",
    lastName: "Әлиев",
    phone: "+77774821933",
    schoolName: "Школа № 125",
    grade: 10,
    countryIds: [1, 2],
    studyFields: ["IT", "ENGINEERING"],
  };

  const payload = {
    submissionId: "fba4498b-3fa5-40ba-9967-365b0c3edb62",
    quizVersion: "2026-08-26",
    submittedAt: "2026-08-26T18:41:07.221Z",
    role: "parent" as const,
    locale: "kk" as const,
    name: "Аружан Сейдахмет",
    phone: "+7 777 482 19 33",
    score: 935,
    percent: 93,
    universities: 50,
    answers: [{ question: "Из какого вы города?", answer: "Алматы" }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findSourceByCode.mockResolvedValue({ id: 2, code: "landing-calculator", isActive: true });
    findByExternalSubmission.mockResolvedValue(null);
    createLeadWithSubmission.mockResolvedValue({ id: 101 });
    isUniqueConstraintError.mockReturnValue(false);
    countCountries.mockResolvedValue(2);
  });

  it("returns the existing lead for the same source submission without creating a duplicate", async () => {
    findByExternalSubmission.mockResolvedValue({ lead: { id: 91 } });

    await expect(service.ingestLanding(payload)).resolves.toEqual({ lead: { id: 91 }, created: false });

    expect(findByExternalSubmission).toHaveBeenCalledWith(2, payload.submissionId);
    expect(createLeadWithSubmission).not.toHaveBeenCalled();
  });

  it("stores the exact source payload and preserves frontend-calculated metrics", async () => {
    await expect(service.ingestLanding(payload)).resolves.toEqual({ lead: { id: 101 }, created: true });

    expect(createLeadWithSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 2,
        sourceCode: "landing-calculator",
        rawPayload: payload,
        mapping: expect.objectContaining({
          metrics: { score: 935, percent: 93, universities: 50 },
        }),
      }),
    );
  });

  it("resolves an idempotency race by loading the submission created by the winning request", async () => {
    const duplicateError = { code: "P2002" };
    createLeadWithSubmission.mockRejectedValue(duplicateError);
    isUniqueConstraintError.mockReturnValue(true);
    findByExternalSubmission.mockResolvedValueOnce(null).mockResolvedValueOnce({ lead: { id: 92 } });

    await expect(service.ingestLanding(payload)).resolves.toEqual({ lead: { id: 92 }, created: false });
    expect(findByExternalSubmission).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized source payloads before touching the database", async () => {
    const oversized = {
      ...payload,
      answers: Array.from({ length: 30 }, (_, index) => ({ question: `Question ${index}`, answer: "x".repeat(4000) })),
    };

    await expect(service.ingestLanding(oversized)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(findSourceByCode).not.toHaveBeenCalled();
  });

  it("stores an Express questionnaire without requiring calculator fields", async () => {
    findSourceByCode.mockResolvedValue({ id: 4, code: "express", isActive: true });
    await expect(service.ingestExpress(expressPayload)).resolves.toEqual({ lead: { id: 101 }, created: true });
    expect(createLeadWithSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 4, sourceCode: "express", rawPayload: expressPayload, mapping: expect.objectContaining({ schemaVersion: "express-v1" }) }),
    );
  });

  it("returns the existing Express lead on repeated or concurrent submissions", async () => {
    findSourceByCode.mockResolvedValue({ id: 4, code: "express", isActive: true });
    findByExternalSubmission.mockResolvedValueOnce({ lead: { id: 91 } });
    await expect(service.ingestExpress(expressPayload)).resolves.toEqual({ lead: { id: 91 }, created: false });
    expect(createLeadWithSubmission).not.toHaveBeenCalled();
    createLeadWithSubmission.mockRejectedValue({ code: "P2002" });
    isUniqueConstraintError.mockReturnValue(true);
    findByExternalSubmission.mockResolvedValueOnce(null).mockResolvedValueOnce({ lead: { id: 91 } });
    await expect(service.ingestExpress(expressPayload)).resolves.toEqual({ lead: { id: 91 }, created: false });
    expect(findByExternalSubmission).toHaveBeenLastCalledWith(4, expressPayload.submissionId);
  });

  it.each([null, { id: 4, code: "express", isActive: false }])("rejects Express when the source is unavailable (%j)", async source => {
    findSourceByCode.mockResolvedValue(source);
    await expect(service.ingestExpress(expressPayload)).rejects.toBeInstanceOf(NotFoundException);
    expect(countCountries).not.toHaveBeenCalled();
    expect(createLeadWithSubmission).not.toHaveBeenCalled();
  });

  it("rejects oversized Express payloads before touching the database", async () => {
    await expect(service.ingestExpress({ ...expressPayload, schoolName: "x".repeat(100_000) })).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(findSourceByCode).not.toHaveBeenCalled();
    expect(countCountries).not.toHaveBeenCalled();
  });
});
