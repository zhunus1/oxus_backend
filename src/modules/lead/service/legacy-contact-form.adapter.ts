import { Injectable } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { CreateLeadDto } from "../api/dto/create-lead.dto";
import { LeadSourceAdapter, LeadSourceMapping } from "../domain/lead-source-adapter";
import { LEAD_SOURCE } from "../domain/lead.constants";
import { normalizePhoneNumber } from "../domain/phone-number";

@Injectable()
export class LegacyContactFormAdapter implements LeadSourceAdapter<CreateLeadDto> {
  readonly sourceCode = LEAD_SOURCE.LEGACY_CONTACT_FORM;

  map(payload: CreateLeadDto): LeadSourceMapping {
    const displayName = `${payload.firstName.trim()} ${payload.lastName.trim()}`.trim();
    const phoneNumber = normalizePhoneNumber(payload.phone) ?? payload.phone.trim();

    const normalizedPayload: Prisma.InputJsonObject = {
      displayName,
      phoneNumber,
      email: payload.email.trim().toLowerCase(),
      role: payload.role,
      preferredLanguage: payload.preferredLanguage,
    };

    return {
      normalized: {
        displayName,
        phoneNumber,
        email: payload.email.trim().toLowerCase(),
        role: payload.role,
        preferredLanguage: payload.preferredLanguage,
        firstName: payload.firstName,
        lastName: payload.lastName,
        topic: payload.topic,
        interests: payload.interests,
      },
      normalizedPayload,
      schemaVersion: "legacy-v1",
    };
  }
}
