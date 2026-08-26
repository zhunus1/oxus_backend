import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { AnswerEntity, ResponseEntity } from "../api/dto/response.entity";
import { CreateResponseDto } from "../api/dto/create-response.dto";
import { UpdateResponseDto } from "../api/dto/update-response.dto";
import { QuestionEntity, QuestionOptionEntity } from "src/modules/question/api/dto/question.entity";

const questionInclude = {
  question: {
    include: { options: { orderBy: { order: "asc" as const } } },
  },
  option: true,
};

@Injectable()
export class ResponseRepository extends BaseRepository {
  private toEntity(r: any): ResponseEntity {
    return new ResponseEntity({
      id: r.id,
      questionId: r.questionId,
      question: new QuestionEntity({
        id: r.question.id,
        order: r.question.order,
        text: r.question.text,
        type: r.question.type,
        required: r.question.required,
        options: r.question.options.map((o: any) => new QuestionOptionEntity({ id: o.id, order: o.order, text: o.text })),
      }),
      answer: new AnswerEntity({
        valueText: r.valueText,
        valueNum: r.valueNum,
        valueOptionId: r.valueOptionId,
        selectedOption: r.option ? new QuestionOptionEntity({ id: r.option.id, order: r.option.order, text: r.option.text }) : null,
      }),
    });
  }

  async create(attemptId: string, data: CreateResponseDto): Promise<ResponseEntity> {
    const response = await this.prisma.response.upsert({
      where: {
        attemptId_questionId: { attemptId, questionId: data.questionId },
      },
      update: data,
      create: { ...data, attemptId },
      include: questionInclude,
    });
    return this.toEntity(response);
  }

  async updateById(id: number, data: UpdateResponseDto): Promise<ResponseEntity> {
    const response = await this.prisma.response.update({
      where: { id },
      data,
      include: questionInclude,
    });
    return this.toEntity(response);
  }

  async findAllByAttemptId(attemptId: string): Promise<ResponseEntity[]> {
    const responses = await this.prisma.response.findMany({
      where: { attemptId },
      include: questionInclude,
      orderBy: { createdAt: "desc" },
    });
    return responses.map(r => this.toEntity(r));
  }
}
