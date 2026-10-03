import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ExpressSubmissionDto } from "./express-submission.dto";

describe("Express questionnaire validation", () => {
  const input = {
    submissionId: "1bec4c5e-177d-4d1c-b8dd-4a580507523f",
    locale: "ru",
    firstName: "Алихан",
    lastName: "Әлиев",
    phone: "+77774821933",
    schoolName: "Школа № 125",
    grade: 10,
    countryIds: [1, 2],
    studyFields: ["IT", "ENGINEERING"],
  };

  it("accepts the student form without email, middle name or calculator data", async () => {
    expect(await validate(plainToInstance(ExpressSubmissionDto, input))).toEqual([]);
  });

  it.each(Object.keys(input))("requires %s", async field => {
    expect((await validate(plainToInstance(ExpressSubmissionDto, { ...input, [field]: undefined }))).map(error => error.property)).toContain(field);
  });

  it.each([
    ["grade", 8],
    ["grade", "10"],
    ["grade", 10.5],
    ["locale", "en"],
    ["submissionId", "invalid"],
    ["schoolName", "   "],
    ["firstName", "   "],
    ["lastName", "   "],
    ["middleName", 123],
    ["countryIds", []],
    ["countryIds", [1, 1]],
    ["countryIds", ["1"]],
    ["countryIds", [0]],
    ["countryIds", [2_147_483_648]],
    ["countryIds", Array.from({ length: 31 }, (_, i) => i + 1)],
    ["studyFields", []],
    ["studyFields", ["IT", "IT"]],
    ["studyFields", ["UNKNOWN"]],
    ["submittedAt", "invalid"],
  ])("rejects malformed %s (%j)", async (field, value) => {
    expect((await validate(plainToInstance(ExpressSubmissionDto, { ...input, [field]: value }))).map(error => error.property)).toContain(field);
  });
});
