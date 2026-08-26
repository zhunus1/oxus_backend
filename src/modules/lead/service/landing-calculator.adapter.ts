import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { LandingCalculatorSubmissionDto } from "../api/dto/sales/landing-calculator-submission.dto";
import { LeadSourceAdapter, LeadSourceMapping } from "../domain/lead-source-adapter";
import { LEAD_SOURCE } from "../domain/lead.constants";
import { normalizePhoneNumber } from "../domain/phone-number";
import { assertValidQuizAnswers } from "../domain/quiz-answer.validation";

@Injectable()
export class LandingCalculatorAdapter implements LeadSourceAdapter<LandingCalculatorSubmissionDto> {
  readonly sourceCode = LEAD_SOURCE.LANDING_CALCULATOR;

  map(payload: LandingCalculatorSubmissionDto): LeadSourceMapping {
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
    };

    return {
      normalized: {
        displayName,
        phoneNumber,
        role: payload.role,
        preferredLanguage: payload.locale,
      },
      normalizedPayload,
      metrics: {
        score: payload.score,
        percent: payload.percent,
        universities: payload.universities,
      },
      submittedAt: new Date(payload.submittedAt),
      externalSubmissionId: payload.submissionId,
      schemaVersion: "landing-calculator-v1",
      calculatorVersion: payload.quizVersion,
    };
  }
}
