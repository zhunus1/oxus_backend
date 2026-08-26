import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { ExpertCatalogRepository } from "../repository/expert-catalog.repository";
import { AuditLogService } from "src/modules/audit-log/service/audit-log.service";
import { ExpertCatalogQueryDto } from "../api/dto/expert-catalog-query.dto";
import messages from "src/configs/messages";

@Injectable()
export class ExpertCatalogService {
  private readonly logger = new Logger(ExpertCatalogService.name);

  constructor(
    private readonly repo: ExpertCatalogRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findMany(query: ExpertCatalogQueryDto) {
    try {
      return await this.repo.findMany(query);
    } catch (error) {
      this.logger.error(`Error fetching expert catalog: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("ExpertCatalog"));
    }
  }

  async findById(id: number) {
    try {
      const expert = await this.repo.findById(id);
      if (!expert) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID("ConsultantProfile", id));
      }
      return expert;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching expert ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID("ConsultantProfile", id));
    }
  }

  async listExpertsForPeerTransfer(excludeUserId: number) {
    try {
      const rows = await this.repo.findExpertsForTransferPicker(excludeUserId);
      return rows.map(p => ({
        consultantProfileId: p.id,
        userId: p.user.id,
        firstname: p.user.firstname,
        lastname: p.user.lastname,
        email: p.user.email,
        bio: p.bio ?? null,
        rating: p.rating,
        countryLabels: p.expertCountries.map(c => c.nameEn ?? c.isoCode).filter(Boolean),
      }));
    } catch (error) {
      this.logger.error(`Error fetching experts for peer transfer: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("ExpertCatalog"));
    }
  }

  async selectExpert(userId: number, expertId: number) {
    try {
      const portrait = await this.repo.findPortraitByUserId(userId);
      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND("StudentPortrait"));
      }

      const expert = await this.repo.findById(expertId);
      if (!expert) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID("ConsultantProfile", expertId));
      }
      if (!expert.isActive) {
        throw new BadRequestException("This expert is currently not available");
      }

      await this.repo.assignExpert(portrait.id, expertId);

      await this.auditLogService.log(userId, "EXPERT_SELECTED", "StudentPortrait", portrait.id, {
        consultantProfileId: expertId,
        expertName: `${expert.user.firstname} ${expert.user.lastname}`,
      });

      return { success: true, assignedExpertId: expertId };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error(`Error selecting expert: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR("StudentPortrait", 0));
    }
  }
}
