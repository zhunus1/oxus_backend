export type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  minuteOfDay: number;
};

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function getLocalDateParts(date: Date, timeZone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find(p => p.type === "year")?.value);
  const month = Number(parts.find(p => p.type === "month")?.value);
  const day = Number(parts.find(p => p.type === "day")?.value);
  let hour = Number(parts.find(p => p.type === "hour")?.value);
  const minute = Number(parts.find(p => p.type === "minute")?.value);
  const weekdayShort = parts.find(p => p.type === "weekday")?.value;

  if (hour === 24) hour = 0;

  return {
    year,
    month,
    day,
    dayOfWeek: WEEKDAY_MAP[weekdayShort ?? "Mon"] ?? 1,
    minuteOfDay: hour * 60 + minute,
  };
}

/** Converts a wall-clock time in `timeZone` to a UTC `Date`. */
export function zonedLocalToUtc(year: number, month: number, day: number, minuteOfDay: number, timeZone: string): Date {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  for (let i = 0; i < 4; i++) {
    const local = getLocalDateParts(candidate, timeZone);
    const desiredMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const actualMs = Date.UTC(local.year, local.month - 1, local.day, Math.floor(local.minuteOfDay / 60), local.minuteOfDay % 60, 0);
    const diff = desiredMs - actualMs;
    if (diff === 0) break;
    candidate = new Date(candidate.getTime() + diff);
  }

  return candidate;
}

export function localDateKey(parts: Pick<LocalDateTimeParts, "year" | "month" | "day">): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function incrementCalendarDay(year: number, month: number, day: number) {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}
