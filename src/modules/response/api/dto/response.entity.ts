import { Decimal } from "@prisma/client/runtime/index-browser";
import { QuestionEntity, QuestionOptionEntity } from "src/modules/question/api/dto/question.entity";

export class AnswerEntity {
  valueText: string | null;
  valueNum: Decimal | null;
  valueOptionId: number | null;
  selectedOption: QuestionOptionEntity | null;

  constructor(partial: Partial<AnswerEntity>) {
    Object.assign(this, partial);
  }
}

export class ResponseEntity {
  id: number;
  questionId: number;
  question: QuestionEntity;
  answer: AnswerEntity;

  constructor(partial: Partial<ResponseEntity>) {
    Object.assign(this, partial);
  }
}
