import { BadRequestException } from "@nestjs/common";
import { getLocalDateParts, zonedLocalToUtc } from "src/common/helpers/timezone";

export const LEAD_SLOT_MINUTES = 30;
export const LEAD_DAY_START = 9 * 60;
export const LEAD_DAY_END = 17 * 60 + 30;

/** Requires a thirty-minute first consultation on half-hour boundaries between 09:00 and 17:30 local time. */
export function assertLeadBookingTime(startTime: Date, endTime: Date, timezone: string) {
  const start = getLocalDateParts(startTime, timezone);
  const end = getLocalDateParts(endTime, timezone);
  if (
    endTime.getTime() - startTime.getTime() !== LEAD_SLOT_MINUTES * 60_000 ||
    startTime.getUTCSeconds() !== 0 ||
    startTime.getUTCMilliseconds() !== 0 ||
    start.minuteOfDay % LEAD_SLOT_MINUTES !== 0 ||
    start.minuteOfDay < LEAD_DAY_START ||
    end.minuteOfDay > LEAD_DAY_END ||
    start.year !== end.year ||
    start.month !== end.month ||
    start.day !== end.day
  ) {
    throw new BadRequestException("First consultations require a 30-minute slot between 09:00 and 17:30 in the expert timezone");
  }
}

/** Splits configured working hours into complete half-hour consultation slots within the allowed day. */
export function splitLeadSlots(day: { year: number; month: number; day: number }, startMinute: number, endMinute: number, timezone: string) {
  const result: { startTime: Date; endTime: Date }[] = [];
  const from = Math.ceil(Math.max(startMinute, LEAD_DAY_START) / LEAD_SLOT_MINUTES) * LEAD_SLOT_MINUTES;
  const to = Math.min(endMinute, LEAD_DAY_END);
  for (let minute = from; minute + LEAD_SLOT_MINUTES <= to; minute += LEAD_SLOT_MINUTES) {
    result.push({
      startTime: zonedLocalToUtc(day.year, day.month, day.day, minute, timezone),
      endTime: zonedLocalToUtc(day.year, day.month, day.day, minute + LEAD_SLOT_MINUTES, timezone),
    });
  }
  return result;
}
