export function parseStringArrayToNumberArray(value: unknown): number[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Expected an array");
  }

  const result: number[] = [];

  for (const item of value) {
    const num = Number(item);

    if ((typeof item !== "string" && typeof item !== "number") || Number.isNaN(num)) {
      throw new Error(`Invalid numeric value: "${String(item)}"`);
    }

    result.push(num);
  }

  return result;
}
