import { normalizePhoneNumber } from "./phone-number";

describe("normalizePhoneNumber", () => {
  it.each([
    ["+7 777 482 19 33", "+77774821933"],
    ["8 (777) 482-19-33", "+77774821933"],
    ["7774821933", "+77774821933"],
    ["+49 1577 1408357", "+4915771408357"],
    ["+81 90-1234-5678", "+819012345678"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each(["", "123", "+1234567890123456", "call-me-77774821933"])('rejects invalid number "%s"', input => {
    expect(normalizePhoneNumber(input)).toBeNull();
  });
});
