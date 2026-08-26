// Общие утилиты дат/времени для проекта

export type DateRangeQ = { fromDate?: string; toDate?: string };

/** Парсит fromDate/toDate из query в реальный Date-диапазон */
export function parseRange(q?: DateRangeQ) {
  const from = q?.fromDate ? new Date(q.fromDate.endsWith("Z") ? q.fromDate : `${q.fromDate}T00:00:00.000Z`) : undefined;

  const to = q?.toDate ? new Date(q.toDate.endsWith("Z") ? q.toDate : `${q.toDate}T23:59:59.999Z`) : undefined;

  return { from, to };
}

/** Форматирует дату/время для Казахстана (ru-RU, Asia/Almaty) */
export function fmtKZ(d: Date): string {
  return d.toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
export function fmt(d: Date): string {
  return d.toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
export function fmtUTC(d: Date): string {
  return d.toISOString().slice(0, 10).split("-").reverse().join(".");
}

/** Форматирует только дату для Казахстана (ru-RU, Asia/Almaty) */
export function fmtKZDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" });
}
export function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
