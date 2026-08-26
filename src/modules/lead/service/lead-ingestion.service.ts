import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { CreateLeadDto } from "../api/dto/create-lead.dto";
import { CreateManualLeadDto } from "../api/dto/sales/create-manual-lead.dto";
import { LandingCalculatorSubmissionDto } from "../api/dto/sales/landing-calculator-submission.dto";
import { LeadSourceAdapter } from "../domain/lead-source-adapter";
import { LEAD_SOURCE, LEAD_SUBMISSION_MAX_BYTES } from "../domain/lead.constants";
import { LeadIngestionRepository } from "../repository/lead-ingestion.repository";
import { LandingCalculatorAdapter } from "./landing-calculator.adapter";
import { LegacyContactFormAdapter } from "./legacy-contact-form.adapter";
import { OfficeManualAdapter } from "./office-manual.adapter";

@Injectable()
export class LeadIngestionService {
  private readonly adapters: Map<string, LeadSourceAdapter<any>>;

  constructor(
    private readonly repo: LeadIngestionRepository,
    landingAdapter: LandingCalculatorAdapter,
    officeManualAdapter: OfficeManualAdapter,
    legacyAdapter: LegacyContactFormAdapter,
  ) {
    this.adapters = new Map<string, LeadSourceAdapter<any>>();
    this.adapters.set(landingAdapter.sourceCode, landingAdapter);
    this.adapters.set(officeManualAdapter.sourceCode, officeManualAdapter);
    this.adapters.set(legacyAdapter.sourceCode, legacyAdapter);
  }

  ingestLanding(payload: LandingCalculatorSubmissionDto) {
    return this.ingest(LEAD_SOURCE.LANDING_CALCULATOR, payload);
  }

  ingestManual(payload: CreateManualLeadDto, createdByUserId: number) {
    return this.ingest(LEAD_SOURCE.OFFICE_MANUAL, payload, createdByUserId);
  }

  ingestLegacy(payload: CreateLeadDto) {
    return this.ingest(LEAD_SOURCE.LEGACY_CONTACT_FORM, payload);
  }

  private async ingest(sourceCode: string, payload: object, createdByUserId?: number) {
    const rawPayload = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonObject;
    const payloadSize = Buffer.byteLength(JSON.stringify(rawPayload), "utf8");
    if (payloadSize > LEAD_SUBMISSION_MAX_BYTES) {
      throw new PayloadTooLargeException(`Lead payload exceeds ${LEAD_SUBMISSION_MAX_BYTES} bytes`);
    }

    const adapter = this.adapters.get(sourceCode);
    if (!adapter) throw new BadRequestException(`Unsupported lead source: ${sourceCode}`);

    const source = await this.repo.findSourceByCode(sourceCode);
    if (!source || !source.isActive) throw new NotFoundException(`Lead source is not active: ${sourceCode}`);

    const mapping = adapter.map(payload);

    if (mapping.externalSubmissionId) {
      const existing = await this.repo.findByExternalSubmission(source.id, mapping.externalSubmissionId);
      if (existing) return { lead: existing.lead, created: false };
    }

    try {
      const lead = await this.repo.createLeadWithSubmission({ sourceId: source.id, sourceCode, mapping, rawPayload, createdByUserId });
      return { lead, created: true };
    } catch (error) {
      if (mapping.externalSubmissionId && this.repo.isUniqueConstraintError(error)) {
        const existing = await this.repo.findByExternalSubmission(source.id, mapping.externalSubmissionId);
        if (existing) return { lead: existing.lead, created: false };
      }
      if (this.repo.isUniqueConstraintError(error)) {
        throw new ConflictException("Lead submission already exists");
      }
      throw error;
    }
  }
}
