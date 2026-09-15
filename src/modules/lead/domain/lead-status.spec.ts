import { LeadStatus } from "generated/prisma/enums";
import { leadStatusUpdate } from "./lead-status";

describe("lead status timestamp", () => {
  afterEach(() => jest.useRealTimers());

  it("records the time only when the status actually changes", () => {
    const now = new Date("2030-01-01T10:00:00Z");
    jest.useFakeTimers().setSystemTime(now);
    for (const previous of Object.values(LeadStatus)) {
      for (const next of Object.values(LeadStatus)) {
        const saved = { status: previous, statusChangedAt: new Date("2020-01-01T00:00:00Z") };
        const updated = { ...saved, ...leadStatusUpdate(previous, next) };
        expect(updated.status).toBe(next);
        expect(updated.statusChangedAt).toEqual(previous === next ? saved.statusChangedAt : now);
      }
    }
  });
});
