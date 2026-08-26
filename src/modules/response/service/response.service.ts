import { Injectable, Logger, InternalServerErrorException, BadRequestException, NotFoundException } from "@nestjs/common";
import { ResponseRepository } from "../repository/response.repository";
import { ResponseEntity } from "../api/dto/response.entity";
import { CreateResponseDto } from "../api/dto/create-response.dto";
import { UpdateResponseDto } from "../api/dto/update-response.dto";
import messages from "src/configs/messages";
import { QuestionType } from "generated/prisma/enums";
import { QuestionService } from "src/modules/question/service/question.service";
import { AttemptService } from "src/modules/attempt/service/attempt.service";

@Injectable()
export class ResponseService {
  private readonly entity = "Response";
  private readonly logger = new Logger(ResponseService.name);

  constructor(
    private readonly repo: ResponseRepository,
    private readonly questionService: QuestionService,
    private readonly attemptService: AttemptService,
  ) {}

  async create(attemptId: string, dto: CreateResponseDto): Promise<ResponseEntity> {
    try {
      await this.attemptService.findById(attemptId);

      const question = await this.questionService.findById(dto.questionId);
      if (!question) throw new NotFoundException(messages.NOT_FOUND_BY_ID("Question", dto.questionId));

      if (
        (question.type === QuestionType.TEXT || question.type === QuestionType.DATE || question.type === QuestionType.PHONE) &&
        (dto.valueText === undefined || dto.valueText === null)
      ) {
        throw new BadRequestException(`valueText is required for question type ${question.type}`);
      }

      if (question.type === QuestionType.NUMERIC && (dto.valueNum === undefined || dto.valueNum === null)) {
        throw new BadRequestException(`valueNum is required for question type ${question.type}`);
      }

      if (question.type === QuestionType.SINGLE_CHOICE && (dto.valueOptionId === undefined || dto.valueOptionId === null)) {
        throw new BadRequestException(`valueOptionId is required for question type ${question.type}`);
      }

      return await this.repo.create(attemptId, dto);
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async findAllByAttemptId(attemptId: string): Promise<ResponseEntity[]> {
    try {
      await this.attemptService.findById(attemptId);
      return await this.repo.findAllByAttemptId(attemptId);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async updateById(attemptId: string, id: number, dto: UpdateResponseDto): Promise<ResponseEntity> {
    try {
      await this.attemptService.findById(attemptId);
      return await this.repo.updateById(id, dto);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }
}
