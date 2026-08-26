import { BadRequestException } from "@nestjs/common";

interface QuizAnswerLike {
  question?: string;
  answer?: string;
  questionId?: string;
  optionIds?: string[];
  freeText?: string | null;
  questionText?: string;
  answerText?: string;
}

export function assertValidQuizAnswers(answers: QuizAnswerLike[]): void {
  for (const [index, answer] of answers.entries()) {
    const questionSnapshot = answer.questionText ?? answer.question;
    const answerSnapshot = answer.answerText ?? answer.answer;
    const hasSnapshot = Boolean(questionSnapshot?.trim() && answerSnapshot?.trim());
    const hasSelectedOptions = Boolean(answer.optionIds?.length && answer.optionIds.every(optionId => optionId.trim()));
    const hasIdentifiers = Boolean(answer.questionId?.trim() && (hasSelectedOptions || answer.freeText?.trim()));

    if (!hasSnapshot && !hasIdentifiers) {
      throw new BadRequestException(`answers[${index}] must contain question/answer or questionId with optionIds/freeText`);
    }
  }
}
