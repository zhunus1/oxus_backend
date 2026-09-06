import { CalculatorQuestionnaireService } from "./calculator-questionnaire.service";
describe("calculator questionnaires", () => {
  const service = new CalculatorQuestionnaireService();
  it("retains the complete bilingual parent and student definitions", () => {
    expect(service.definition().questionnaires.parent).toHaveLength(11);
    expect(service.definition().questionnaires.student).toHaveLength(9);
    for (const questions of Object.values(service.definition().questionnaires))
      for (const q of questions) {
        expect(q.text.ru).toBeTruthy();
        expect(q.text.kk).toBeTruthy();
      }
  });
  it("allows an empty partial questionnaire without claiming a final result", () => {
    expect(service.calculate({ role: "parent", locale: "ru", answers: [] })).toMatchObject({ complete: false, answeredCount: 0, metrics: { score: 0, provisional: true } });
  });
  it("uses server-side weights and stores the localized question and answer", () => {
    expect(service.calculate({ role: "student", locale: "kk", answers: [{ questionId: "city", optionId: "almaty" }] })).toMatchObject({
      answeredCount: 1,
      answers: [{ questionText: "Сен қай қаладансың?", answerText: "Алматы" }],
      metrics: { provisional: true },
    });
  });
  it("rejects unknown options, duplicate answers and unsupported versions", () => {
    const answer = { questionId: "city", optionId: "almaty" };
    for (const answers of [[answer, answer], [{ questionId: "city", optionId: "unknown" }]]) expect(() => service.calculate({ role: "parent", locale: "ru", answers })).toThrow();
    expect(() => service.calculate({ role: "parent", locale: "ru", answers: [], quizVersion: "future" })).toThrow();
  });
});
