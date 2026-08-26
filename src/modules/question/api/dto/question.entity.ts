import { QuestionType } from "generated/prisma/enums";

export class QuestionEntity {
  id: number;
  testId: number;
  order: number;
  text: string;
  description: string | null;
  type: QuestionType;
  segmentId: number | null;
  options: QuestionOptionEntity[];
  required: boolean;

  constructor(partial: Partial<QuestionEntity>) {
    Object.assign(this, partial);
  }
}

export class QuestionOptionEntity {
  id: number;
  order: number;
  text: string;
  label: string | null;

  constructor(partial: Partial<QuestionOptionEntity>) {
    Object.assign(this, partial);
  }
}
