import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { TargetProgramRepository } from "../repository/target-program.repository";
import { CreateTargetProgramDto } from "../api/dto/create-target-program.dto";
import { UpdateTargetProgramDto } from "../api/dto/update-target-program.dto";
import messages from "src/configs/messages";
import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

@Injectable()
export class TargetProgramService {
  private readonly logger = new Logger(TargetProgramService.name);
  private readonly entityName = "TargetProgram";

  constructor(
    private readonly repo: TargetProgramRepository,
    private readonly userJourneyLog: UserJourneyLogService,
  ) {}

  async create(userId: number, portraitId: number, dto: CreateTargetProgramDto) {
    try {
      const program = await this.repo.findProgramById(dto.programId);

      if (!program) {
        throw new NotFoundException(messages.NOT_FOUND("Program"));
      }

      const created = await this.repo.create({
        programId: program.id,
        programTitle: program.name,
        organisationId: program.organisationId,
        deadline: dto.deadline,
        intake: dto.intake,
        studentPortraitId: portraitId,
      });
      void this.userJourneyLog.logEvent(userId, USER_JOURNEY_EVENT.PROGRAM_SELECTED, {
        targetProgramId: created.id,
        programId: program.id,
        programTitle: program.name,
        organisationId: program.organisationId,
        organisationNameEn: program.organisation.nameEn,
        organisationNameRu: program.organisation.nameRu,
        intake: dto.intake,
      });
      return created;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;

      this.logger.error(`Error creating target program: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  async findMyPrograms(portraitId: number) {
    try {
      return await this.repo.findByPortraitId(portraitId);
    } catch (error) {
      this.logger.error(`Error fetching target programs: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findById(portraitId: number, id: number) {
    try {
      const tp = await this.repo.findByIdForPortrait(id, portraitId);
      if (!tp) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      return tp;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching target program ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entityName, id));
    }
  }

  async update(userId: number, portraitId: number, id: number, dto: UpdateTargetProgramDto) {
    try {
      const tp = await this.repo.findById(id);
      if (!tp) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }

      if (tp.studentPortraitId !== portraitId) {
        throw new ForbiddenException(messages.FORBIDDEN_ACTION);
      }

      let updateData: any = {
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        intake: dto.intake,
      };

      if (dto.programId !== undefined) {
        const program = await this.repo.findProgramById(dto.programId);

        if (!program) {
          throw new NotFoundException(messages.NOT_FOUND("Program"));
        }

        updateData = {
          ...updateData,
          program: { connect: { id: program.id } },
          programTitle: program.name,
          organisation: { connect: { id: program.organisationId } },
        };
      } else {
        if (dto.programTitle !== undefined) {
          updateData.programTitle = dto.programTitle;
        }

        if (dto.organisationId !== undefined) {
          updateData.organisation = { connect: { id: dto.organisationId } };
        }
      }

      return await this.repo.update(id, updateData);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Error updating target program ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, id));
    }
  }

  async delete(userId: number, portraitId: number, id: number) {
    try {
      const tp = await this.repo.findById(id);
      if (!tp) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      if (tp.studentPortraitId !== portraitId) {
        throw new ForbiddenException(messages.FORBIDDEN_ACTION);
      }

      await this.repo.delete(id);
      return { deleted: true };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error deleting target program ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR(this.entityName, id));
    }
  }
}
