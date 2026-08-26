import { Prisma } from "generated/prisma/client";

export function toDecimal(v: number | string): Prisma.Decimal {
  // Accept numbers from DTO, but store as Decimal precisely
  return new Prisma.Decimal(v);
}
