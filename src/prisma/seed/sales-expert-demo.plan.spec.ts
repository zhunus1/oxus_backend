import { DEMO_SALES_EMAIL, DEMO_EXPERT_EMAIL, demoBatchKey, demoScenarios, demoTime, normalizeDemoOptions, parseDemoDate, parseDemoOptions } from "./sales-expert-demo.plan";

describe("Sales / Expert demo plan", () => {
  it("automatically selects the launch date in staging, even though NODE_ENV is production", () => {
    expect(() => parseDemoOptions(["--apply"], { STAGING: "false" })).toThrow("STAGING=true");
    expect(() => parseDemoOptions(["--force"], { STAGING: "true" })).toThrow("Usage");
    expect(parseDemoOptions([], { STAGING: "true", NODE_ENV: "production" }, new Date("2026-09-11T06:00:00Z"))).toEqual({
      startDate: "2026-09-11",
      apply: false,
      salesEmail: DEMO_SALES_EMAIL,
      expertEmail: DEMO_EXPERT_EMAIL,
    });
  });

  it("rejects invalid internal dates and the obsolete date override", () => {
    for (const date of ["2026-02-29", "2026-13-01", "2026-04-31", "11-09-2026"]) {
      expect(() => parseDemoDate(date)).toThrow();
    }
    expect(() => parseDemoOptions(["--start-date=2026-09-11"], { STAGING: "true" })).toThrow("--start-date is not supported");
    expect(() => parseDemoOptions(["--apply", "--apply"], { STAGING: "true" })).toThrow("duplicate");
  });

  it("provides 36 distinct customers, balanced daily work and both roles/locales across a month boundary", () => {
    const scenarios = demoScenarios("2026-09-30");
    expect(new Set(scenarios.map(row => row.code)).size).toBe(36);
    expect(new Set(scenarios.map(row => row.name)).size).toBe(36);
    expect([...new Set(scenarios.map(row => row.day))]).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    for (let dayIndex = 0; dayIndex < 3; dayIndex++) {
      const daily = scenarios.filter(row => row.dayIndex === dayIndex);
      expect(daily).toHaveLength(12);
      expect(daily.filter(row => row.kind === "new")).toHaveLength(3);
      expect(daily.filter(row => row.kind === "callback")).toHaveLength(3);
      expect(daily.filter(row => row.kind === "consultation")).toHaveLength(4);
      expect(daily.filter(row => row.kind === "contract")).toHaveLength(1);
      expect(daily.filter(row => row.kind === "rejected")).toHaveLength(1);
      expect(new Set(daily.map(row => row.role)).size).toBe(2);
      expect(new Set(daily.map(row => row.locale)).size).toBe(2);
    }
  });

  it("stores Almaty wall-clock dates in UTC and handles leap days", () => {
    expect(demoTime("2026-09-11", 9 * 60).toISOString()).toBe("2026-09-11T04:00:00.000Z");
    expect([...new Set(demoScenarios("2028-02-28").map(row => row.day))]).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("accepts both email argument forms and normalizes case/whitespace", () => {
    const options = parseDemoOptions(
      ["--sales-email= SALES.OTHER@example.test ", "--expert-email", "Expert.Other@example.test", "--apply"],
      { STAGING: "true" },
      new Date("2026-09-11T06:00:00Z"),
    );
    expect(options).toEqual({ startDate: "2026-09-11", apply: true, salesEmail: "sales.other@example.test", expertEmail: "expert.other@example.test" });
  });

  it("rejects malformed, repeated and identical account emails", () => {
    for (const extra of [
      ["--sales-email=bad"],
      ["--expert-email="],
      ["--sales-email=a@example.test", "--sales-email=b@example.test"],
      ["--sales-email=a@example.test", "--expert-email=A@example.test"],
    ]) {
      expect(() => parseDemoOptions(extra, { STAGING: "true" })).toThrow();
    }
  });

  it("distinguishes both account IDs in the batch key", () => {
    const original = demoBatchKey("2026-09-11", { managerId: 1, expertId: 2 });
    expect(demoBatchKey("2026-09-11", { managerId: 3, expertId: 2 })).not.toBe(original);
    expect(demoBatchKey("2026-09-11", { managerId: 1, expertId: 3 })).not.toBe(original);
  });

  it("changes the three-day window at Almaty midnight, independent of the server timezone", () => {
    const before = parseDemoOptions([], { STAGING: "true", TZ: "UTC" }, new Date("2026-12-31T18:59:59Z"));
    const after = parseDemoOptions([], { STAGING: "true", TZ: "America/New_York" }, new Date("2026-12-31T19:00:00Z"));
    expect([...new Set(demoScenarios(before.startDate).map(row => row.day))]).toEqual(["2026-12-31", "2027-01-01", "2027-01-02"]);
    expect([...new Set(demoScenarios(after.startDate).map(row => row.day))]).toEqual(["2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(demoBatchKey(before.startDate)).not.toBe(demoBatchKey(after.startDate));
  });

  it("recomputes the run date even when given options from an earlier preview", () => {
    const preview = normalizeDemoOptions({ apply: false }, new Date("2026-09-11T18:59:59Z"));
    const apply = normalizeDemoOptions({ ...preview, apply: true }, new Date("2026-09-11T19:00:00Z"));
    expect(apply.startDate).toBe("2026-09-12");
  });
});
