import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { leadTransaction } from "../domain/lead-transaction";
import { PrismaService } from "src/database/prisma.service";
import { CalculatorAnswersDto, CreateManualLeadV2Dto } from "../api/dto/sales/sales-v2.dto";
import { LEAD_SOURCE } from "../domain/lead.constants";
import { normalizePhoneNumber } from "../domain/phone-number";
import { LeadIngestionRepository } from "../repository/lead-ingestion.repository";
import { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import { CalculatorQuestionnaireService } from "./calculator-questionnaire.service";

/** Creates manual leads and stores versioned calculator answers separately from common lead fields. */
@Injectable()
export class ManualLeadV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: LeadIngestionRepository,
    private readonly calculator: CalculatorQuestionnaireService,
    private readonly realtime: LeadRealtimeGateway,
  ) {}

  /** Creates an unassigned NEW lead with normalized contacts and an optional partial questionnaire. */
  async create(managerId: number, dto: CreateManualLeadV2Dto) {
    const displayName = dto.name.trim();
    const phoneNumber = normalizePhoneNumber(dto.phone);
    if (!displayName || !phoneNumber) throw new BadRequestException("Name and valid international phone are required");
    const source = await this.source();
    const questionnaire = this.calculator.calculate({ ...dto, answers: dto.answers ?? [] });
    const normalized = { displayName, phoneNumber, email: dto.email.trim().toLowerCase(), role: dto.role, preferredLanguage: dto.locale };
    const lead = await this.repo.createLeadWithSubmission({
      sourceId: source.id,
      sourceCode: source.code,
      createdByUserId: managerId,
      rawPayload: JSON.parse(JSON.stringify(dto)),
      mapping: {
        normalized,
        normalizedPayload: { ...normalized, questionnaire },
        metrics: questionnaire.metrics,
        schemaVersion: "office-manual-v2",
        calculatorVersion: questionnaire.version,
      },
    });
    this.realtime.emitLeadCreated(lead);
    return { lead, created: true };
  }

  /** Appends an immutable questionnaire snapshot and synchronizes its language on the owned lead. */
  async saveAnswers(managerId: number, leadId: number, dto: CalculatorAnswersDto) {
    const questionnaire = this.calculator.calculate(dto);
    const source = await this.source();
    const submission = await leadTransaction(this.prisma, async tx => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, assignedSalesManagerId: managerId, deletedAt: null } });
      if (!lead) throw new NotFoundException("Lead not found");
      if (lead.contractId) throw new ConflictException("Contract questionnaire is already frozen");
      if (lead.role !== dto.role) throw new BadRequestException("Questionnaire role must match lead role");
      const saved = await tx.leadSubmission.create({
        data: {
          leadId,
          sourceId: source.id,
          schemaVersion: "office-manual-v2",
          calculatorVersion: questionnaire.version,
          rawPayload: JSON.parse(JSON.stringify(dto)),
          normalizedPayload: { questionnaire, role: dto.role, preferredLanguage: dto.locale },
          metrics: questionnaire.metrics,
        },
      });
      await tx.leadActivity.create({ data: { leadId, actorUserId: managerId, type: "QUESTIONNAIRE_SAVED", metadata: { submissionId: saved.id } } });
      await tx.lead.update({ where: { id: leadId }, data: { preferredLanguage: dto.locale } });
      return saved;
    });
    this.realtime.emitLeadUpdated(managerId, { id: leadId });
    return submission;
  }

  /** Requires the configured manual source to remain active before accepting questionnaire data. */
  private async source() {
    const source = await this.repo.findSourceByCode(LEAD_SOURCE.OFFICE_MANUAL);
    if (!source?.isActive) throw new NotFoundException("Manual lead source is not active");
    return source;
  }
}
