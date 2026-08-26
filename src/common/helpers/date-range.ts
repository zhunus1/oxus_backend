// src/common/helpers/date-range.ts

export interface DateRangeQuery {
  dateFrom?: string;
  dateTo?: string;
}

export function resolveDateRange(q?: DateRangeQuery | null): { dateFrom?: Date; dateTo?: Date } {
  if (q?.dateFrom || q?.dateTo) {
    const dateFrom = q.dateFrom ? new Date(q.dateFrom) : undefined;
    const dateTo = q.dateTo ? new Date(q.dateTo) : undefined;
    return { dateFrom, dateTo };
  }

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

  return { dateFrom: firstDay, dateTo: now };
}
