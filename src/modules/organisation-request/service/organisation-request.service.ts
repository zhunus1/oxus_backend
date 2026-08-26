import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { OrganisationRequestStatus } from "generated/prisma/enums";
import messages from "src/configs/messages";
import { CreateOrganisationRequestDto } from "../api/dto/create-organisation-request.dto";
import { QueryOrganisationRequestDto } from "../api/dto/query-organisation-request.dto";
import { ResolveOrganisationRequestDto } from "../api/dto/resolve-organisation-request.dto";
import { ReviewOrganisationRequestDto } from "../api/dto/review-organisation-request.dto";
import { OrganisationRequestRepository } from "../repository/organisation-request.repository";

@Injectable()
export class OrganisationRequestService {
  private readonly logger = new Logger(OrganisationRequestService.name);
  private readonly entity = "OrganisationRequest";

  constructor(private readonly repo: OrganisationRequestRepository) {}

  async create(requestedByUserId: number, dto: CreateOrganisationRequestDto) {
    try {
      return await this.repo.create({
        requestedByUser: { connect: { id: requestedByUserId } },
        universityName: dto.universityName.trim(),
        countryName: dto.countryName?.trim() || null,
        notes: dto.notes?.trim() || null,
      });
    } catch (err: any) {
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async listMine(requestedByUserId: number, query: QueryOrganisationRequestDto) {
    return this.repo.findMany({
      requestedByUserId,
      status: query.status,
      skip: query.skip,
      take: query.take,
    });
  }

  async listAll(query: QueryOrganisationRequestDto) {
    return this.repo.findMany({
      status: query.status,
      skip: query.skip,
      take: query.take,
    });
  }

  async findMineById(id: number, requestedByUserId: number) {
    const request = await this.findById(id);
    if (request.requestedByUserId !== requestedByUserId) {
      throw new ForbiddenException("You can only access your own organisation requests.");
    }
    return request;
  }

  async findById(id: number) {
    const request = await this.repo.findById(id);
    if (!request) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
    }
    return request;
  }

  async approve(id: number, reviewedByUserId: number, dto: ReviewOrganisationRequestDto) {
    await this.findById(id);
    return await this.repo.updateById(id, {
      status: OrganisationRequestStatus.APPROVED,
      reviewedByUser: { connect: { id: reviewedByUserId } },
      reviewNote: dto.reviewNote?.trim() || null,
    });
  }

  async reject(id: number, reviewedByUserId: number, dto: ReviewOrganisationRequestDto) {
    await this.findById(id);
    return await this.repo.updateById(id, {
      status: OrganisationRequestStatus.REJECTED,
      reviewedByUser: { connect: { id: reviewedByUserId } },
      reviewNote: dto.reviewNote?.trim() || null,
    });
  }

  async resolve(id: number, reviewedByUserId: number, dto: ResolveOrganisationRequestDto) {
    await this.findById(id);
    return await this.repo.updateById(id, {
      status: OrganisationRequestStatus.COMPLETED,
      reviewedByUser: { connect: { id: reviewedByUserId } },
      reviewNote: dto.reviewNote?.trim() || null,
      resolvedOrganisation: { connect: { id: dto.resolvedOrganisationId } },
    });
  }
}
