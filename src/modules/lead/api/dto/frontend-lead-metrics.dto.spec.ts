import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { ExpressSubmissionDto } from "./express-submission.dto";
import { CreateManualLeadV2Dto, SaveCalculatorAnswersDto } from "./sales/sales-v2.dto";

describe.each([ExpressSubmissionDto, CreateManualLeadV2Dto, SaveCalculatorAnswersDto])("frontend metrics in %p", Dto => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false });
  const input = {
    submissionId: "d3589c87-450a-4ebd-819c-bdf2b2ad67bd",
    locale: "ru",
    role: "student",
    schoolName: "School 125",
    grade: 10,
    firstName: "Student",
    lastName: "Test",
    name: "Student Test",
    phone: "+77774821933",
    email: "student@example.test",
    countryIds: [1],
    studyFields: ["IT"],
    answers: [],
  };
  const parse = (metrics: object) => pipe.transform({ ...input, ...metrics }, { type: "body", metatype: Dto });

  it.each([{}, { score: 0, percent: 0, universities: 0 }, { score: 1000, percent: 100, universities: 10000 }])(
    "accepts omitted results and inclusive boundaries: %p",
    async metrics => {
      expect(await parse(metrics)).toMatchObject(metrics);
    },
  );

  it.each(["score", "percent", "universities"])("rejects non-integer JSON types for %s without coercion", async field => {
    for (const value of [false, true, "", " ", "1", null, [], [1], {}, 1.5, -1]) {
      await expect(parse({ score: 1, percent: 1, universities: 1, [field]: value })).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
