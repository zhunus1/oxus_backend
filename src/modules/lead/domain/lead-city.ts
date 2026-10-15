import type { Prisma } from "generated/prisma/client";
import { calculatorQuestionnaire } from "./calculator-questionnaire";

const cityQuestions = Object.values(calculatorQuestionnaire.questionnaires).flatMap(questions => questions.filter(question => question.id === "city"));
const questionTexts = [...new Set(cityQuestions.flatMap(question => Object.values(question.text)))];
const legacyQuestions = questionTexts.flatMap(text => [`@.questionText == ${JSON.stringify(text)}`, `@.question == ${JSON.stringify(text)}`]);

// Older calculator submissions contain localized question/answer snapshots without IDs.
export const CITY_ANSWER_JSON_PATH = `$.answers[*] ? (@.questionId == "city" || ((!exists(@.questionId) || @.questionId == null || @.questionId == "") && (${legacyQuestions.join(" || ")})))`;

export function leadCityFromAnswer(answer: Prisma.JsonValue | null, locale: string | null): string | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  for (const field of ["freeText", "answerText", "answer"]) {
    const value = answer[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const optionId = Array.isArray(answer.optionIds) ? answer.optionIds[0] : answer.optionId;
  const option = cityQuestions[0].options.find(option => option.id === optionId);
  return option && option.id !== "other" ? option.label[locale === "kk" ? "kk" : "ru"] : null;
}
