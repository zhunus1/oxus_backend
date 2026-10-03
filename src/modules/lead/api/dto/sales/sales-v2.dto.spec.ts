import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CalculatorAnswersDto, CreateManualLeadV2Dto, ExpertQuestionnaireDto, SaveCalculatorAnswersDto } from "./sales-v2.dto";

describe("Sales v2 required contacts and optional questionnaire", () => {
  const input = { name: "  Parent Name  ", phone: " +77770000001 ", email: " PARENT@example.test ", role: "parent", locale: "ru" };

  it.each(["name", "phone", "email", "role", "locale"])("requires %s even when answers are omitted", async field => {
    const dto = plainToInstance(CreateManualLeadV2Dto, { ...input, [field]: undefined });
    expect((await validate(dto)).map(error => error.property)).toContain(field);
  });

  it.each(["name", "phone", "email"])("rejects blank %s", async field => {
    const dto = plainToInstance(CreateManualLeadV2Dto, { ...input, [field]: "   " });
    expect((await validate(dto)).map(error => error.property)).toContain(field);
  });

  it.each(["parent", "student"])("accepts %s contacts without JSON answers and normalizes whitespace", async role => {
    const dto = plainToInstance(CreateManualLeadV2Dto, { ...input, role });
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({ name: "Parent Name", phone: "+77770000001", email: "parent@example.test" });
    expect(dto.answers).toBeUndefined();
  });

  it("still validates optional answers when supplied", async () => {
    const dto = plainToInstance(CreateManualLeadV2Dto, { ...input, answers: [{ questionId: 12, optionId: false }] });
    expect((await validate(dto)).map(error => error.property)).toContain("answers");
    expect(await validate(plainToInstance(CreateManualLeadV2Dto, { ...input, answers: [] }))).toEqual([]);
  });

  it("allows an empty expert draft but rejects malformed supplied fields", async () => {
    expect(await validate(plainToInstance(ExpertQuestionnaireDto, {}))).toEqual([]);
    expect((await validate(plainToInstance(ExpertQuestionnaireDto, { citizenshipCountryId: "unknown", languages: "English" }))).map(error => error.property).sort()).toEqual([
      "citizenshipCountryId",
      "languages",
    ]);
  });

  it.each([CreateManualLeadV2Dto, SaveCalculatorAnswersDto])("retains frontend results through whitelist validation for %p", async Dto => {
    const dto = plainToInstance<object, object>(Dto, { ...input, answers: [], score: 935, percent: 12, universities: 50 });
    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto).toMatchObject({ score: 935, percent: 12, universities: 50 });
  });

  it.each([
    ["score", -1],
    ["score", 1001],
    ["percent", 101],
    ["universities", 10001],
    ["score", 1.5],
  ])("rejects out-of-range %s=%s", async (field, value) => {
    for (const Dto of [CreateManualLeadV2Dto, SaveCalculatorAnswersDto]) {
      const dto = plainToInstance<object, object>(Dto, { ...input, answers: [], score: 0, percent: 0, universities: 0, [field]: value });
      expect((await validate(dto)).map(error => error.property)).toContain(field);
    }
  });

  it("keeps frontend result fields out of the server preview DTO", async () => {
    const dto = plainToInstance(CalculatorAnswersDto, { role: "student", locale: "ru", answers: [], score: 935, percent: 12, universities: 50 });
    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto).not.toHaveProperty("score");
  });
});
