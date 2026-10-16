import { leadCityFromAnswer } from "./lead-city";

describe("Sales lead city", () => {
  it.each([
    [{ freeText: "  Караганда  ", answerText: "Другое: Караганда" }, "ru", "Караганда"],
    [{ answerText: "  Алматы  ", optionIds: ["almaty"] }, "ru", "Алматы"],
    [{ question: "Из какого вы города?", answer: "Астана" }, "ru", "Астана"],
    [{ optionIds: ["shymkent"] }, "kk", "Шымкент"],
    [{ optionId: "astana" }, null, "Астана"],
    [{ optionIds: ["other"] }, "ru", null],
    [{ optionIds: ["unknown"] }, "ru", null],
    [{ answerText: "   ", answer: 12 }, "ru", null],
    [null, "ru", null],
    [[], "ru", null],
    ["malformed snapshot", "ru", null],
  ] as const)("reads %j", (answer, locale, expected) => {
    expect(leadCityFromAnswer(JSON.parse(JSON.stringify(answer)), locale)).toBe(expected);
  });
});
