/* eslint-disable @typescript-eslint/no-base-to-string */
export function toNumberArray(value: unknown): number[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parts = Array.isArray(value) ? value : String(value).split(",");
  const nums = parts
    .flatMap(v => String(v).split(","))
    .map(v => Number(String(v).trim()))
    .filter(n => Number.isFinite(n));
  return nums.length ? nums : undefined;
}
