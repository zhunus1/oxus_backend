import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CreateLeadCallbackDto } from "../api/dto/sales/create-lead-callback.dto";
import { CreateManualLeadDto } from "../api/dto/sales/create-manual-lead.dto";
import { SalesLeadQueryDto } from "../api/dto/sales/sales-lead-query.dto";
import { UpdateLeadCallbackDto } from "../api/dto/sales/update-lead-callback.dto";
import { SalesLeadRepository } from "../repository/sales-lead.repository";
import { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import { LeadIngestionService } from "./lead-ingestion.service";
import { LeadNotificationService } from "./lead-notification.service";

/** Coordinates Sales validation, transactional persistence, and post-commit notifications. */
@Injectable()
export class SalesLeadService {
  constructor(
    private readonly repo: SalesLeadRepository,
    private readonly ingestion: LeadIngestionService,
    private readonly realtime: LeadRealtimeGateway,
    private readonly notifications: LeadNotificationService,
  ) {}

  /** Preserves legacy manual ingestion and broadcasts only newly created leads. */
  async createManual(managerId: number, dto: CreateManualLeadDto) {
    const result = await this.ingestion.ingestManual(dto, managerId);
    if (result.created) this.realtime.emitLeadCreated(result.lead);
    return result;
  }

  /** Adds pagination metadata to the manager-scoped lead list. */
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

  /** Returns counters using the same visibility rules as the Sales queues. */
  summary(managerId: number) {
    return this.repo.summary(managerId);
  }

  /** Returns a visible lead card or hides inaccessible leads behind a not-found response. */
  async detail(managerId: number, leadId: number) {
    const lead = await this.repo.findVisibleById(leadId, managerId);
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  /** Claims a lead for Sales and broadcasts the winning manager after the commit. */
  async accept(managerId: number, leadId: number) {
    const lead = await this.repo.accept(leadId, managerId);
    if (!lead) throw new ConflictException("Lead was already accepted or is no longer available");
    this.realtime.emitLeadAccepted(leadId, managerId, lead);
    return lead;
  }

  /** Validates callback timing, persists the transition, then schedules its durable reminder. */
  async createCallback(managerId: number, leadId: number, dto: CreateLeadCallbackDto) {
    await this.requireOwned(managerId, leadId);
    const scheduledFor = this.parseCallbackTime(dto.scheduledFor);
    const result = await this.repo.createCallback(leadId, managerId, scheduledFor, dto.comment?.trim(), dto.reason);
    await this.notifications.schedule();
    for (const call of result.cancelledExpertCalls) {
      this.realtime.emitExpertCallRemoved(call.expertUserId, call.id);
    }
    this.realtime.emitLeadUpdated(managerId, result.lead);
    if (result.lead.assignedExpertUserId) this.realtime.emitExpertLeadUpdated(result.lead.assignedExpertUserId, leadId);
    return { lead: result.lead, callback: result.callback };
  }

  /** Updates only an editable callback and schedules a replacement reminder when needed. */
  async updateCallback(managerId: number, leadId: number, callbackId: number, dto: UpdateLeadCallbackDto) {
    await this.requireOwned(managerId, leadId);
    const scheduledFor = dto.scheduledFor ? this.parseCallbackTime(dto.scheduledFor) : undefined;
    const result = await this.repo.updateCallback(callbackId, leadId, managerId, {
      scheduledFor,
      status: dto.status,
      comment: dto.comment?.trim(),
      reason: dto.reason,
    });
    if (result.kind === "not_found") throw new NotFoundException("Lead callback not found");
    if (result.kind === "not_editable") throw new ConflictException("A completed or cancelled callback cannot be changed");
    if (result.notification) await this.notifications.schedule();
    this.realtime.emitLeadUpdated(managerId, result.lead);
    if (result.lead.assignedExpertUserId) this.realtime.emitExpertLeadUpdated(result.lead.assignedExpertUserId, leadId);
    return { lead: result.lead, callback: result.callback };
  }

  /** Requires a rejection reason and notifies participants after closing the lead. */
  async reject(managerId: number, leadId: number, reason: string) {
    await this.requireOwned(managerId, leadId);
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new BadRequestException("reason must not be empty");
    const result = await this.repo.reject(leadId, managerId, normalizedReason);
    for (const call of result.cancelledExpertCalls) {
      this.realtime.emitExpertCallRemoved(call.expertUserId, call.id);
    }
    this.realtime.emitLeadUpdated(managerId, result.lead);
    if (result.lead.assignedExpertUserId) this.realtime.emitExpertLeadUpdated(result.lead.assignedExpertUserId, leadId);
    return result.lead;
  }

  /** Checks card visibility before returning its activity history. */
  async activities(managerId: number, leadId: number) {
    await this.detail(managerId, leadId);
    return this.repo.activities(leadId);
  }

  /** Returns the enabled source catalogue used by Sales. */
  sources() {
    return this.repo.sources();
  }

  /** Checks current Sales ownership before validating a requested action. */
  private async requireOwned(managerId: number, leadId: number) {
    const lead = await this.repo.findOwnedById(leadId, managerId);
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  /** Rejects past or invalid callback times and enforces fifteen-minute boundaries. */
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
}
