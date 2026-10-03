import { BadRequestException, Injectable } from "@nestjs/common";
import { ExpressSubmissionDto } from "../api/dto/express-submission.dto";
import { LeadSourceAdapter, LeadSourceMapping } from "../domain/lead-source-adapter";
import { LEAD_SOURCE } from "../domain/lead.constants";
import { normalizePhoneNumber } from "../domain/phone-number";
import { LeadIngestionRepository } from "../repository/lead-ingestion.repository";
import { readFrontendLeadMetrics } from "../domain/lead-metrics";

@Injectable()
export class ExpressAdapter implements LeadSourceAdapter<ExpressSubmissionDto> {
  readonly sourceCode = LEAD_SOURCE.EXPRESS;

  constructor(private readonly repo: LeadIngestionRepository) {}

  async map(payload: ExpressSubmissionDto): Promise<LeadSourceMapping> {
    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();
    const middleName = payload.middleName?.trim() || null;
    const schoolName = payload.schoolName.trim();
    if (!firstName || !lastName || !schoolName) throw new BadRequestException("First name, last name and school name must not be empty");
    const phoneNumber = normalizePhoneNumber(payload.phone);
    if (!phoneNumber) throw new BadRequestException("phone must be a valid international phone number");
    const metrics = readFrontendLeadMetrics(payload);
    if ((await this.repo.countCountries(payload.countryIds)) !== payload.countryIds.length) throw new BadRequestException("Unknown country IDs");
    const normalized = {
      displayName: [lastName, firstName, middleName].filter(Boolean).join(" "),
      firstName,
      lastName,
      phoneNumber,
      role: "student",
      preferredLanguage: payload.locale,
    };
    return {
      normalized,
      metrics,
      normalizedPayload: { ...normalized, middleName, schoolName, grade: payload.grade, countryIds: payload.countryIds, studyFields: payload.studyFields },
      externalSubmissionId: payload.submissionId,
      submittedAt: payload.submittedAt ? new Date(payload.submittedAt) : undefined,
      schemaVersion: "express-v1",
    };
  }
}
