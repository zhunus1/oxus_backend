export function toDateOrNull(s?: string): Date | null {
  return s ? new Date(s + "T00:00:00.000Z") : null;
}
