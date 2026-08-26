import { BadRequestException } from "@nestjs/common";

export function ensureUnique<T, K extends keyof T>(rows: T[] | undefined, key: K, msg: string) {
  if (!rows || rows.length === 0) return;
  const seen = new Set<unknown>();
  for (const r of rows) {
    const val = r[key];
    if (seen.has(val)) {
      throw new BadRequestException(msg);
    }
    seen.add(val);
  }
}
