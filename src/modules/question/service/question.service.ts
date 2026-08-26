import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, Logger } from "@nestjs/common";
import { QuestionRepository } from "../repository/question.repository";
import { QuestionEntity } from "../api/dto/question.entity";
import { CreateQuestionDto } from "../api/dto/create-question.dto";
import messages from "src/configs/messages";
import { UpdateQuestionDto } from "../api/dto/update-question.dto";

@Injectable()
export class QuestionService {
  private readonly logger = new Logger(QuestionService.name);
  constructor(private readonly repo: QuestionRepository) {}

  async create(testId: number, dto: CreateQuestionDto): Promise<QuestionEntity> {
    try {
      const existing = await this.repo.findMany(testId);
      if (existing.some(q => q.order === dto.order)) {
        throw new BadRequestException(`Combination of [testId, order] must be unique`);
      }
      return await this.repo.create(testId, dto);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(messages.DATABASE_CREATE_ERROR("Question"), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("Question"));
    }
  }

  async findAll(testId: number): Promise<QuestionEntity[]> {
    try {
      return await this.repo.findMany(testId);
    } catch (err) {
      this.logger.error(messages.DATABASE_FETCH_ERROR("Questions"), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("Questions"));
    }
  }

  async findOneById(testId: number, id: number): Promise<QuestionEntity> {
    try {
      const question = await this.repo.findOneById(testId, id);
      if (!question) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID("Question", id));
      }
      return question;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID("Question", id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID("Question", id));
    }
  }

  async findById(id: number): Promise<QuestionEntity> {
    try {
      const question = await this.repo.findById(id);
      if (!question) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID("Question", id));
      }
      return question;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID("Question", id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID("Question", id));
    }
  }

  async updateById(testId: number, id: number, dto: UpdateQuestionDto): Promise<QuestionEntity> {
    try {
      await this.findOneById(testId, id);

      if (dto.order !== undefined) {
        const existing = await this.repo.findMany(testId);
        if (existing.some(q => q.id !== id && q.order === dto.order)) {
          throw new BadRequestException(`Combination of [testId, order] must be unique`);
        }
      }

      return await this.repo.updateById(testId, id, dto);
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR("Question", id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR("Question", id));
    }
  }
}
