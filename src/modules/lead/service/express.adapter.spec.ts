import { BadRequestException } from "@nestjs/common";
import { ExpressSubmissionDto } from "../api/dto/express-submission.dto";
import type { LeadIngestionRepository } from "../repository/lead-ingestion.repository";
import { ExpressAdapter } from "./express.adapter";

jest.mock("../repository/lead-ingestion.repository", () => ({ LeadIngestionRepository: class {} }));

describe("ExpressAdapter", () => {
  const countCountries = jest.fn();
  const adapter = new ExpressAdapter({ countCountries } as unknown as LeadIngestionRepository);
  const payload: ExpressSubmissionDto = {
    submissionId: "1bec4c5e-177d-4d1c-b8dd-4a580507523f",
    submittedAt: "2026-10-03T09:00:00.000Z",
    locale: "kk",
    firstName: "  Алихан  ",
    lastName: "  Әлиев  ",
    middleName: "  Ерланұлы  ",
    phone: "+7 (777) 482-19-33",
    schoolName: "  Школа № 125  ",
    grade: 10,
    countryIds: [1, 2],
    studyFields: ["IT", "ENGINEERING"],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    countCountries.mockResolvedValue(2);
  });

  it("normalizes contacts and keeps all structured student answers", async () => {
    const result = await adapter.map(payload);
    expect(result.normalized).toEqual({
      displayName: "Әлиев Алихан Ерланұлы",
      firstName: "Алихан",
      lastName: "Әлиев",
      phoneNumber: "+77774821933",
      role: "student",
      preferredLanguage: "kk",
    });
    expect(result.normalizedPayload).toEqual({
      ...result.normalized,
      middleName: "Ерланұлы",
      schoolName: "Школа № 125",
      grade: 10,
      countryIds: [1, 2],
      studyFields: ["IT", "ENGINEERING"],
    });
    expect(result.externalSubmissionId).toBe(payload.submissionId);
    expect(result.schemaVersion).toBe("express-v1");
    expect(result.submittedAt).toEqual(new Date(payload.submittedAt!));
    expect(result.metrics).toBeUndefined();
  });

  it.each([undefined, null, "", "   "])("supports an optional middle name (%j)", async middleName => {
    const result = await adapter.map({ ...payload, middleName, submittedAt: undefined });
    expect(result.normalized.displayName).toBe("Әлиев Алихан");
    expect(result.normalizedPayload.middleName).toBeNull();
    expect(result.submittedAt).toBeUndefined();
  });

  it.each(["firstName", "lastName", "schoolName"])("rejects whitespace-only %s", async field => {
    await expect(adapter.map({ ...payload, [field]: "   " })).rejects.toBeInstanceOf(BadRequestException);
    expect(countCountries).not.toHaveBeenCalled();
  });

  it("rejects invalid phones before querying countries", async () => {
    await expect(adapter.map({ ...payload, phone: "@telegram" })).rejects.toBeInstanceOf(BadRequestException);
    expect(countCountries).not.toHaveBeenCalled();
  });

  it("rejects unknown country IDs", async () => {
    countCountries.mockResolvedValue(1);
    await expect(adapter.map(payload)).rejects.toThrow("Unknown country IDs");
  });

  it.each([
    { score: 935, percent: 12, universities: 50 },
    { score: 0, percent: 0, universities: 0 },
    { score: 1000, percent: 100, universities: 10000 },
  ])("preserves frontend metrics exactly: %j", async metrics => {
    expect((await adapter.map({ ...payload, ...metrics })).metrics).toEqual(metrics);
  });

  it.each([{ score: 935 }, { score: 935, percent: 93 }, { percent: 93, universities: 50 }, { score: 935, universities: 50 }])(
    "rejects incomplete metrics before database access: %j",
    async metrics => {
      await expect(adapter.map({ ...payload, ...metrics })).rejects.toBeInstanceOf(BadRequestException);
      expect(countCountries).not.toHaveBeenCalled();
    },
  );
});
