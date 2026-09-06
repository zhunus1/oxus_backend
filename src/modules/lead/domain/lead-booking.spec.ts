import { assertLeadBookingTime, splitLeadSlots } from "./lead-booking";
describe("first consultation slots", () => {
  const timezone = "Asia/Almaty";
  const day = { year: 2026, month: 9, day: 7 };
  it("clips configured windows and ends the final slot at 17:30", () => {
    const slots = splitLeadSlots(day, 8 * 60, 19 * 60, timezone);
    expect(slots).toHaveLength(17);
    expect(slots[0].startTime.toISOString()).toBe("2026-09-07T04:00:00.000Z");
    expect(slots.at(-1)?.endTime.toISOString()).toBe("2026-09-07T12:30:00.000Z");
    for (const slot of slots) expect(() => assertLeadBookingTime(slot.startTime, slot.endTime, timezone)).not.toThrow();
  });
  it("does not invent a slot outside a partial configured window", () => {
    expect(splitLeadSlots(day, 9 * 60 + 15, 10 * 60 + 15, timezone)).toEqual([{ startTime: new Date("2026-09-07T04:30:00Z"), endTime: new Date("2026-09-07T05:00:00Z") }]);
    expect(splitLeadSlots(day, 9 * 60 + 15, 9 * 60 + 45, timezone)).toEqual([]);
  });
  it.each([
    ["03:30", "04:00"],
    ["12:30", "13:00"],
    ["04:00", "05:00"],
    ["04:15", "04:45"],
    ["04:00:01", "04:30:01"],
  ])("rejects invalid time %s–%s", (start, end) => {
    expect(() => assertLeadBookingTime(new Date(`2026-09-07T${start}Z`), new Date(`2026-09-07T${end}Z`), timezone)).toThrow();
  });
});
