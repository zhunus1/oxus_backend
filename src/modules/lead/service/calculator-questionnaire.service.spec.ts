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
  it("preserves frontend results without replacing them with server weights or percentages", () => {
    const metrics = { score: 935, percent: 12, universities: 50 };
    const dto = { role: "student" as const, locale: "ru" as const, answers: [{ questionId: "city", optionId: "almaty" }] };
    expect(service.calculate(dto, metrics)).toMatchObject({ answeredCount: 1, complete: false, metrics: { ...metrics, provisional: true } });
    expect(service.calculate(dto).metrics).toEqual({ score: 20, percent: 2, universities: 2, provisional: true });
  });
  it.each(["parent", "student"] as const)("determines %s completeness from the answers even when results come from the frontend", role => {
    const answers = service.definition().questionnaires[role].map(q => ({ questionId: q.id, optionId: q.options[0].id }));
    expect(service.calculate({ role, locale: "ru", answers }, { score: 0, percent: 0, universities: 0 })).toMatchObject({
      complete: true,
      metrics: { score: 0, percent: 0, universities: 0, provisional: false },
    });
  });
  it("still validates questionnaire versions, option IDs and duplicate answers with frontend results", () => {
    const metrics = { score: 935, percent: 93, universities: 50 };
    const answer = { questionId: "city", optionId: "almaty" };
    for (const answers of [[answer, answer], [{ questionId: "city", optionId: "unknown" }], [{ questionId: "city", optionId: "other" }]]) {
      expect(() => service.calculate({ role: "student", locale: "ru", answers }, metrics)).toThrow();
    }
    expect(() => service.calculate({ role: "student", locale: "ru", answers: [], quizVersion: "future" }, metrics)).toThrow();
  });
});
