import { BadRequestException, Injectable } from "@nestjs/common";
import { calculatorQuestionnaire } from "../domain/calculator-questionnaire";
import { CalculatorAnswersDto } from "../api/dto/sales/sales-v2.dto";

/** Serves the versioned calculator definitions and calculates scores from validated answers. */
@Injectable()
export class CalculatorQuestionnaireService {
  /** Returns supported roles, localized questions, options, and scoring bands. */
  definition() {
    return calculatorQuestionnaire;
  }

  /** Validates answer IDs and free text, then returns localized snapshots and provisional or final metrics. */
  calculate(dto: CalculatorAnswersDto) {
    if (dto.quizVersion && dto.quizVersion !== calculatorQuestionnaire.version) throw new BadRequestException("Unsupported questionnaire version");
    const questions = calculatorQuestionnaire.questionnaires[dto.role];
    const seen = new Set<string>();
    let score = 0;
    const answers = dto.answers.map(answer => {
      if (seen.has(answer.questionId)) throw new BadRequestException("Duplicate question answer");
      seen.add(answer.questionId);
      const question = questions.find(q => q.id === answer.questionId);
      const option = question?.options.find(o => o.id === answer.optionId);
      if (!question || !option) throw new BadRequestException("Unknown question or option");
      const allowsFreeText = "allowsFreeText" in option && option.allowsFreeText;
      const freeText = answer.freeText?.trim();
      if (allowsFreeText && !freeText) throw new BadRequestException("Other option requires freeText");
      if (!allowsFreeText && freeText) throw new BadRequestException("Selected option does not accept freeText");
      score += option.weight;
      return {
        questionId: question.id,
        optionIds: [option.id],
        questionText: question.text[dto.locale],
        answerText: freeText ? `${option.label[dto.locale]}: ${freeText}` : option.label[dto.locale],
        ...(freeText ? { freeText } : {}),
      };
    });
    const complete = seen.size === questions.length;
    const bands = calculatorQuestionnaire.resultBands[dto.role];
    return {
      version: calculatorQuestionnaire.version,
      answers,
      complete,
      answeredCount: answers.length,
      questionCount: questions.length,
      metrics: {
        score,
        percent: Math.min(Math.floor(score / 10), 100),
        universities: answers.length ? (bands.find(b => score >= b.minScore)?.universities ?? 0) : 0,
        provisional: !complete,
      },
    };
  }
}
