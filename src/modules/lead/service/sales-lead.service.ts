import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CreateLeadCallbackDto } from "../api/dto/sales/create-lead-callback.dto";
import { CreateManualLeadDto } from "../api/dto/sales/create-manual-lead.dto";
import { SalesLeadQueryDto } from "../api/dto/sales/sales-lead-query.dto";
import { UpdateLeadCallbackDto } from "../api/dto/sales/update-lead-callback.dto";
import { SalesLeadRepository } from "../repository/sales-lead.repository";
import { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import { LeadIngestionService } from "./lead-ingestion.service";
import { LeadNotificationService } from "./lead-notification.service";

@Injectable()
export class SalesLeadService {
  constructor(
    private readonly repo: SalesLeadRepository,
    private readonly ingestion: LeadIngestionService,
    private readonly realtime: LeadRealtimeGateway,
    private readonly notifications: LeadNotificationService,
  ) {}

  async createManual(managerId: number, dto: CreateManualLeadDto) {
    const result = await this.ingestion.ingestManual(dto, managerId);
    if (result.created) this.realtime.emitLeadCreated(result.lead);
    return result;
  }

  async list(managerId: number, query: SalesLeadQueryDto) {
    const { data, total } = await this.repo.list(managerId, query);
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  summary(managerId: number) {
    return this.repo.summary(managerId);
  }

  async detail(managerId: number, leadId: number) {
    const lead = await this.repo.findVisibleById(leadId, managerId);
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  async accept(managerId: number, leadId: number) {
    const lead = await this.repo.accept(leadId, managerId);
    if (!lead) throw new ConflictException("Lead was already accepted or is no longer available");
    this.realtime.emitLeadAccepted(leadId, managerId, lead);
    return lead;
  }

  async createCallback(managerId: number, leadId: number, dto: CreateLeadCallbackDto) {
    await this.requireOwned(managerId, leadId);
    const scheduledFor = this.parseCallbackTime(dto.scheduledFor);
    let result: Awaited<ReturnType<SalesLeadRepository["createCallback"]>>;
    try {
      result = await this.repo.createCallback(leadId, managerId, scheduledFor, dto.comment?.trim());
    } catch (error) {
      if (this.isConcurrencyError(error)) throw new ConflictException("Could not schedule callback because the lead changed concurrently");
      throw error;
    }
    await this.notifications.schedule(result.notification);
    for (const call of result.cancelledExpertCalls) {
      this.realtime.emitExpertCallRemoved(call.expertUserId, call.id);
    }
    this.realtime.emitLeadUpdated(managerId, result.lead);
    return { lead: result.lead, callback: result.callback };
  }

  async updateCallback(managerId: number, leadId: number, callbackId: number, dto: UpdateLeadCallbackDto) {
    await this.requireOwned(managerId, leadId);
    const scheduledFor = dto.scheduledFor ? this.parseCallbackTime(dto.scheduledFor) : undefined;
    let result: Awaited<ReturnType<SalesLeadRepository["updateCallback"]>>;
    try {
      result = await this.repo.updateCallback(callbackId, leadId, managerId, {
        scheduledFor,
        status: dto.status,
        comment: dto.comment?.trim(),
      });
    } catch (error) {
      if (this.isConcurrencyError(error)) throw new ConflictException("Could not update callback because the lead changed concurrently");
      throw error;
    }
    if (result.kind === "not_found") throw new NotFoundException("Lead callback not found");
    if (result.kind === "not_editable") throw new ConflictException("A completed or cancelled callback cannot be changed");
    if (result.notification) await this.notifications.schedule(result.notification);
    this.realtime.emitLeadUpdated(managerId, result.lead);
    return { lead: result.lead, callback: result.callback };
  }

  async reject(managerId: number, leadId: number, reason: string) {
    await this.requireOwned(managerId, leadId);
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new BadRequestException("reason must not be empty");
    let result: Awaited<ReturnType<SalesLeadRepository["reject"]>>;
    try {
      result = await this.repo.reject(leadId, managerId, normalizedReason);
    } catch (error) {
      if (this.isConcurrencyError(error)) throw new ConflictException("Could not reject lead because it changed concurrently");
      throw error;
    }
    for (const call of result.cancelledExpertCalls) {
      this.realtime.emitExpertCallRemoved(call.expertUserId, call.id);
    }
    this.realtime.emitLeadUpdated(managerId, result.lead);
    return result.lead;
  }

  async activities(managerId: number, leadId: number) {
    await this.detail(managerId, leadId);
    return this.repo.activities(leadId);
  }

  sources() {
    return this.repo.sources();
  }

  private async requireOwned(managerId: number, leadId: number) {
    const lead = await this.repo.findOwnedById(leadId, managerId);
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  private parseCallbackTime(value: string): Date {
    const scheduledFor = new Date(value);
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) {
      throw new BadRequestException("scheduledFor must be a valid future date");
    }
    if (scheduledFor.getUTCMinutes() % 15 !== 0 || scheduledFor.getUTCSeconds() !== 0 || scheduledFor.getUTCMilliseconds() !== 0) {
      throw new BadRequestException("scheduledFor must use a 15-minute increment");
    }
    return scheduledFor;
  }

  private isConcurrencyError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && ["P2002", "P2034"].includes((error as { code?: string }).code ?? "");
  }
}
