import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { CreateManualLeadDto } from "../api/dto/sales/create-manual-lead.dto";
import { LeadSourceAdapter, LeadSourceMapping } from "../domain/lead-source-adapter";
import { LEAD_SOURCE } from "../domain/lead.constants";
import { normalizePhoneNumber } from "../domain/phone-number";
import { assertValidQuizAnswers } from "../domain/quiz-answer.validation";

@Injectable()
export class OfficeManualAdapter implements LeadSourceAdapter<CreateManualLeadDto> {
  readonly sourceCode = LEAD_SOURCE.OFFICE_MANUAL;

  map(payload: CreateManualLeadDto): LeadSourceMapping {
    const displayName = payload.name.trim();
    if (!displayName) throw new BadRequestException("name must not be empty");

    const phoneNumber = normalizePhoneNumber(payload.phone);
    if (!phoneNumber) throw new BadRequestException("phone must be a valid international phone number");

    assertValidQuizAnswers(payload.answers);

    const normalizedPayload: Prisma.InputJsonObject = {
      displayName,
      phoneNumber,
      role: payload.role,
      preferredLanguage: payload.locale,
      ...(payload.email ? { email: payload.email.trim().toLowerCase() } : {}),
    };

    const metrics: Record<string, number> = {};
    if (payload.score != null) metrics.score = payload.score;
    if (payload.percent != null) metrics.percent = payload.percent;
    if (payload.universities != null) metrics.universities = payload.universities;

    return {
      normalized: {
        displayName,
        phoneNumber,
        email: payload.email?.trim().toLowerCase(),
        role: payload.role,
        preferredLanguage: payload.locale,
      },
      normalizedPayload,
      metrics: Object.keys(metrics).length ? metrics : undefined,
      schemaVersion: "office-manual-v1",
      calculatorVersion: payload.quizVersion,
    };
  }
}
