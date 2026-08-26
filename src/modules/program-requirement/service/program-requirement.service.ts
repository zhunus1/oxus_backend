import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import messages from "src/configs/messages";
import { ProgramRequirementRepository } from "../repository/program-requirement.repository";
import { CreateProgramRequirementDto } from "../api/dto/create-program-requirement.dto";
import { UpdateProgramRequirementDto } from "../api/dto/update-program-requirement.dto";

@Injectable()
export class ProgramRequirementService {
  private readonly logger = new Logger(ProgramRequirementService.name);
  private readonly entityName = "ProgramRequirement";

  constructor(private readonly repo: ProgramRequirementRepository) {}

  async findByProgramId(programId: number) {
    try {
      return await this.repo.findByProgramId(programId);
    } catch (error) {
      this.logger.error(`Error fetching requirements for program ${programId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async create(programId: number, dto: CreateProgramRequirementDto) {
    try {
      return await this.repo.create(programId, dto);
    } catch (error: any) {
      this.logger.error(`Error creating requirement for program ${programId}: ${error}`);

      if (error?.code === "P2002") {
        throw new BadRequestException("Program requirement with same type and title already exists");
      }

      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  async update(id: number, dto: UpdateProgramRequirementDto) {
    try {
      const existing = await this.repo.findById(id);

      if (!existing) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }

      return await this.repo.update(id, dto);
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;

      this.logger.error(`Error updating requirement ${id}: ${error}`);

      if (error?.code === "P2002") {
        throw new BadRequestException("Program requirement with same type and title already exists");
      }

      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entityName));
    }
  }

  async delete(id: number) {
    try {
      const existing = await this.repo.findById(id);

      if (!existing) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }

      await this.repo.delete(id);

      return { success: true };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;

      this.logger.error(`Error deleting requirement ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR(this.entityName, id));
    }
  }

  async getRequirementStatus(targetProgramId: number, userId: number, roleCode?: string) {
    try {
      const targetProgram = await this.repo.findTargetProgramWithProgram(targetProgramId);

      if (!targetProgram) {
        throw new NotFoundException(messages.NOT_FOUND("TargetProgram"));
      }

      const isOwner = targetProgram.studentPortrait?.userId === userId;
      const isPrivileged = roleCode === "ADMIN" || roleCode === "EXPERT";

      if (!isOwner && !isPrivileged) {
        throw new BadRequestException("You do not have access to this target program");
      }

      if (!targetProgram.programId) {
        throw new BadRequestException("TargetProgram is not linked to a Program");
      }

      const requirements = await this.repo.findByProgramId(targetProgram.programId);
      const documents = await this.repo.findDocumentsForTargetProgram(targetProgramId);

      return requirements.map(requirement => {
        const matchedDocument = documents.find(doc => doc.documentType === requirement.type);

        return {
          requirementId: requirement.id,
          type: requirement.type,
          title: requirement.title,
          description: requirement.description,
          isRequired: requirement.isRequired,
          sortOrder: requirement.sortOrder,
          isSubmitted: !!matchedDocument,
          documentId: matchedDocument?.id ?? null,
          documentTitle: matchedDocument?.title ?? null,
          documentStatus: matchedDocument?.status ?? null,
        };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Error fetching requirement status for target program ${targetProgramId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }
}
