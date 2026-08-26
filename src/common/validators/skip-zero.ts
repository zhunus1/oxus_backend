import { Transform } from "class-transformer";

export function TransformSkipZero() {
  return Transform(({ value }) => {
    if (value === undefined || value === null || value === "" || value === "0" || Number(value) === 0 || isNaN(Number(value))) {
      return undefined;
    }
    return Number(value);
  });
}
