import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { CreateQuestionSegmentDto } from "../api/dto/create-question-segment.dto";
import { QuestionSegmentEntity } from "../api/dto/question-segment.entity";

@Injectable()
export class QuestionSegmentRepository extends BaseRepository {
  async create(testId: number, data: CreateQuestionSegmentDto): Promise<QuestionSegmentEntity> {
    const segment = await this.prisma.questionSegment.create({
      data: { testId, title: data.title },
    });
    return new QuestionSegmentEntity(segment);
  }

  async findMany(testId: number): Promise<QuestionSegmentEntity[]> {
    const segments = await this.prisma.questionSegment.findMany({
      where: { testId },
      orderBy: { createdAt: "asc" },
    });
    return segments.map(s => new QuestionSegmentEntity(s));
  }

  async findById(id: number): Promise<QuestionSegmentEntity | null> {
    const segment = await this.prisma.questionSegment.findUnique({ where: { id } });
    return segment ? new QuestionSegmentEntity(segment) : null;
  }

  async findByTestAndId(testId: number, id: number): Promise<QuestionSegmentEntity | null> {
    const segment = await this.prisma.questionSegment.findFirst({ where: { id, testId } });
    return segment ? new QuestionSegmentEntity(segment) : null;
  }

  async deleteById(id: number): Promise<QuestionSegmentEntity> {
    const segment = await this.prisma.questionSegment.delete({ where: { id } });
    return new QuestionSegmentEntity(segment);
  }
}
