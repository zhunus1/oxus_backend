import { Prisma } from "generated/prisma/client";

export interface NormalizedLeadData {
  displayName?: string;
  phoneNumber?: string;
  email?: string;
  role?: string;
  preferredLanguage?: string;
  firstName?: string;
  lastName?: string;
  topic?: string;
  interests?: string;
}

export interface LeadSourceMapping {
  normalized: NormalizedLeadData;
  normalizedPayload: Prisma.InputJsonObject;
  metrics?: Prisma.InputJsonObject;
  submittedAt?: Date;
  externalSubmissionId?: string;
  schemaVersion?: string;
  calculatorVersion?: string;
}

export interface LeadSourceAdapter<TPayload extends object = Record<string, unknown>> {
  readonly sourceCode: string;
  map(payload: TPayload): LeadSourceMapping;
}
