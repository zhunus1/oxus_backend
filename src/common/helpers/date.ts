export function toDateOnly(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toYM(dateStr: string): { y: number; m: number } {
  // Expect "YYYY-MM-DD"
  const [ys, ms] = dateStr.split("-");
  const y = Number(ys);
  const m = Number(ms);
  return { y, m };
}
export function validateDateRange(dateFrom?: string, dateTo?: string): boolean {
  if (!dateFrom || !dateTo) return true;
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return false;
  return from.getTime() <= to.getTime();
}
export function toYMD(d: Date) {
  // YYYY-MM-DD without TZ shifts based on local Date parts
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function formatDateTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function getMonthPeriod(date: Date = new Date()): { fromDate: string; toDate: string } {
  const year = date.getFullYear();
  const month = date.getMonth();

  // Start of the month (Day 1)
  const start = new Date(year, month, 1);

  // End of the month (Day 0 of the next month gets the last day of the current month)
  const end = new Date(year, month + 1, 0);

  // Local formatter to avoid UTC shifts
  const formatDate = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  return {
    fromDate: formatDate(start),
    toDate: formatDate(end),
  };
}
export function getYesterdayPeriod(date: Date = new Date()): { fromDate: string; toDate: string } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate() - 1;

  // yesterday 00:00
  const start = new Date(year, month, day, 0, 0, 0, 0);

  // yesterday 23:59:59.999
  const end = new Date(year, month, day, 23, 59, 59, 999);

  const formatDate = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  return {
    fromDate: formatDate(start),
    toDate: formatDate(end),
  };
}
export function getDayAsPeriod(date: Date = new Date()): { fromDate: string; toDate: string } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  // yesterday 00:00
  const start = new Date(year, month, day, 0, 0, 0, 0);

  // yesterday 23:59:59.999
  const end = new Date(year, month, day, 23, 59, 59, 999);

  const formatDate = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  return {
    fromDate: formatDate(start),
    toDate: formatDate(end),
  };
}
