import { Injectable, Logger, NotFoundException, ConflictException, InternalServerErrorException } from "@nestjs/common";
import { QuestionSegmentRepository } from "../repository/question-segment.repository";
import { CreateQuestionSegmentDto } from "../api/dto/create-question-segment.dto";
import { QuestionSegmentEntity } from "../api/dto/question-segment.entity";
import messages from "src/configs/messages";

@Injectable()
export class QuestionSegmentService {
  private readonly entity = "QuestionSegment";
  private readonly logger = new Logger(QuestionSegmentService.name);

  constructor(private readonly repo: QuestionSegmentRepository) {}

  async create(testId: number, dto: CreateQuestionSegmentDto): Promise<QuestionSegmentEntity> {
    try {
      return await this.repo.create(testId, dto);
    } catch (err) {
      if (err?.code === "P2002") {
        throw new ConflictException(`Segment with title "${dto.title}" already exists in this test`);
      }
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async findAll(testId: number): Promise<QuestionSegmentEntity[]> {
    try {
      return await this.repo.findMany(testId);
    } catch (err) {
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async deleteById(testId: number, id: number): Promise<QuestionSegmentEntity> {
    try {
      const segment = await this.repo.findByTestAndId(testId, id);
      if (!segment) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      return await this.repo.deleteById(id);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_DELETE_ERROR(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR(this.entity, id));
    }
  }
}
