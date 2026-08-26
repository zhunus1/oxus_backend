import { BadRequestException } from "@nestjs/common";
import { LandingCalculatorSubmissionDto } from "../api/dto/sales/landing-calculator-submission.dto";
import { LandingCalculatorAdapter } from "./landing-calculator.adapter";

describe("LandingCalculatorAdapter", () => {
  const adapter = new LandingCalculatorAdapter();

  const payload: LandingCalculatorSubmissionDto = {
    submissionId: "fba4498b-3fa5-40ba-9967-365b0c3edb62",
    quizVersion: "2026-08-26",
    submittedAt: "2026-08-26T18:41:07.221Z",
    role: "parent",
    locale: "kk",
    name: "  Аружан Сейдахмет  ",
    phone: "+7 777 482 19 33",
    score: 935,
    percent: 12,
    universities: 50,
    answers: [{ question: "Из какого вы города?", answer: "Алматы" }],
  };

  it("normalizes common fields while preserving calculator metrics exactly", () => {
    const result = adapter.map(payload);

    expect(result.normalized).toEqual({
      displayName: "Аружан Сейдахмет",
      phoneNumber: "+77774821933",
      role: "parent",
      preferredLanguage: "kk",
    });
    expect(result.metrics).toEqual({ score: 935, percent: 12, universities: 50 });
    expect(result.externalSubmissionId).toBe(payload.submissionId);
    expect(result.submittedAt).toEqual(new Date(payload.submittedAt));
  });

  it("accepts the identifier-plus-snapshot answer contract", () => {
    expect(() =>
      adapter.map({
        ...payload,
        answers: [
          {
            questionId: "city",
            optionIds: ["almaty"],
            questionText: "Из какого вы города?",
            answerText: "Алматы",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects answers that have neither a snapshot nor stable identifiers", () => {
    expect(() => adapter.map({ ...payload, answers: [{}] })).toThrow(BadRequestException);
  });

  it("accepts a registry-backed free-text answer without inventing an option id", () => {
    expect(() =>
      adapter.map({
        ...payload,
        answers: [{ questionId: "target-country-other", freeText: "  South Korea  " }],
      }),
    ).not.toThrow();
  });
});
