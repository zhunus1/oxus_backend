import { Prisma } from "generated/prisma/client";

export function isPositiveInt(n: unknown): boolean {
  return Number.isInteger(n) && (n as number) > 0;
}

export function dec(v: string | number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(String(v).replace(/\s+/g, "").replace(",", "."));
}
