import { Injectable } from "@nestjs/common";
import { CreateQuestionDto } from "../api/dto/create-question.dto";
import { QuestionEntity } from "../api/dto/question.entity";
import { BaseRepository } from "src/database/prisma.repository";
import { UpdateQuestionDto } from "../api/dto/update-question.dto";

@Injectable()
export class QuestionRepository extends BaseRepository {
  private readonly optionSelect = { id: true, order: true, text: true, label: true } as const;

  async create(testId: number, data: CreateQuestionDto): Promise<QuestionEntity> {
    const { options, ...questionData } = data;
    const question = await this.prisma.question.create({
      data: { ...questionData, testId, options: { create: options } },
      include: { options: { select: this.optionSelect } },
    });
    return new QuestionEntity(question);
  }

  async findMany(testId: number): Promise<QuestionEntity[]> {
    const questions = await this.prisma.question.findMany({
      include: { options: { select: this.optionSelect } },
      where: { testId, deletedAt: null },
      orderBy: { order: "asc" },
    });
    return questions.map(question => new QuestionEntity(question));
  }

  async findOneById(testId: number, id: number): Promise<QuestionEntity | null> {
    const question = await this.prisma.question.findFirst({
      where: { id, testId, deletedAt: null },
      include: { options: { select: this.optionSelect } },
    });
    return question ? new QuestionEntity(question) : null;
  }

  async findById(id: number): Promise<QuestionEntity | null> {
    const question = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: { options: { select: this.optionSelect } },
    });
    return question ? new QuestionEntity(question) : null;
  }

  async updateById(testId: number, id: number, data: UpdateQuestionDto): Promise<QuestionEntity> {
    const { options, ...questionData } = data;
    await this.prisma.$transaction(async tx => {
      await tx.question.update({
        where: { id },
        data: { ...questionData },
      });

      if (options !== undefined) {
        await tx.questionOption.deleteMany({ where: { questionId: id } });
        if (options.length > 0) {
          await tx.questionOption.createMany({
            data: options.map(option => ({
              questionId: id,
              order: option.order,
              text: option.text,
              label: option.label,
            })),
          });
        }
      }
    });

    const updated = await this.prisma.question.findFirstOrThrow({
      where: { id, testId, deletedAt: null },
      include: { options: { select: this.optionSelect } },
    });

    return new QuestionEntity(updated);
  }
}
