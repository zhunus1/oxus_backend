import { assertLeadOfficeCity } from "./lead-office";
describe("office city policy", () => {
  const submission = (city: string) => ({
    schemaVersion: "office-manual-v2",
    rawPayload: {},
    normalizedPayload: { questionnaire: { answers: [{ questionId: "city", optionIds: [city] }] } },
  });
  it("allows the matching office and rejects other cities", () => {
    expect(() => assertLeadOfficeCity(submission("almaty"), "almaty")).not.toThrow();
    expect(() => assertLeadOfficeCity(submission("shymkent"), "almaty")).toThrow();
    expect(() => assertLeadOfficeCity(submission("other"), "shymkent")).toThrow();
  });
  it("does not interpret arbitrary source JSON as calculator data", () => {
    expect(() => assertLeadOfficeCity({ ...submission("other"), schemaVersion: "partner-v1" }, "almaty")).not.toThrow();
  });
});
