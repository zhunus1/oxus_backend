import { Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { LeadRepository } from "../repository/lead.repository";
import { CreateLeadDto } from "../api/dto/create-lead.dto";
import { LeadEntity } from "../api/dto/lead.entity";
import messages from "src/configs/messages";
import { LeadIngestionService } from "./lead-ingestion.service";

@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name);
  private readonly entity = "Lead";

  constructor(
    private readonly repo: LeadRepository,
    private readonly ingestion: LeadIngestionService,
  ) {}

  async create(dto: CreateLeadDto): Promise<LeadEntity> {
    try {
      const result = await this.ingestion.ingestLegacy(dto);
      return new LeadEntity(result.lead);
    } catch (err) {
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async findAll(): Promise<LeadEntity[]> {
    try {
      return await this.repo.findAll();
    } catch (err) {
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async markContacted(id: number, expertUserId: number): Promise<LeadEntity> {
    try {
      const lead = await this.repo.markContacted(id, expertUserId);
      if (!lead) throw new NotFoundException("Lead not found");
      return lead;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }
}
