export function normalizePhoneNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\+?[\d\s().-]+$/.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("8")) {
    return `+7${digits.slice(1)}`;
  }

  if (digits.length === 10 && digits.startsWith("7")) {
    return `+7${digits}`;
  }

  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}
