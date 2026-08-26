import { HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { ProgramRepository } from "../repository/program.repository";
import { ProgramDetailEntity, ProgramEntity } from "../api/dto/program.entity";
import { QueryProgramDto } from "../api/dto/query-program.dto";
import { CreateProgramDto } from "../api/dto/create-program.dto";
import { UpdateProgramDto } from "../api/dto/update-program.dto";
import messages from "src/configs/messages";
import { UpdateProgramDeadlineDto } from "../api/dto/update-program-deadline.dto";
import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

@Injectable()
export class ProgramService {
  private readonly logger = new Logger(ProgramService.name);
  private readonly entity = "Program";

  constructor(
    private readonly repo: ProgramRepository,
    private readonly userJourneyLog: UserJourneyLogService,
  ) {}

  async findAll(dto: QueryProgramDto): Promise<ProgramEntity[]> {
    try {
      return await this.repo.findAll(dto);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  private async requireById(id: number): Promise<ProgramDetailEntity> {
    const program = await this.repo.findById(id);
    if (!program) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
    return program;
  }

  async findById(id: number, viewerUserId?: number): Promise<ProgramDetailEntity> {
    try {
      const program = await this.requireById(id);
      if (viewerUserId !== undefined) {
        void this.userJourneyLog.logEvent(viewerUserId, USER_JOURNEY_EVENT.PROGRAM_VIEWED, {
          programId: id,
          programTitle: program.name,
          organisationId: program.organisationId,
          organisationNameEn: program.organisationNameEn ?? null,
          organisationNameRu: program.organisationNameRu ?? null,
          degreeLevel: program.degreeLevel,
        });
      }
      return program;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id));
    }
  }

  async updateDeadline(id: number, dto: UpdateProgramDeadlineDto): Promise<ProgramDetailEntity> {
    try {
      await this.requireById(id);
      const updatedProgram = await this.repo.updateDeadline(id, new Date(dto.applicationDeadline));
      return new ProgramDetailEntity(updatedProgram);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async create(dto: CreateProgramDto): Promise<ProgramEntity> {
    try {
      return await this.repo.create(dto);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async updateById(id: number, dto: UpdateProgramDto): Promise<ProgramDetailEntity> {
    try {
      await this.requireById(id);
      return await this.repo.updateById(id, dto);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async deleteById(id: number): Promise<ProgramEntity> {
    try {
      await this.requireById(id);
      return await this.repo.deleteById(id);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_DELETE_ERROR(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR(this.entity, id));
    }
  }
}
