import type { Contract, Prisma } from "generated/prisma/client";

/** Public contract reads must never expose signing credentials, including null fields. */
export const contractInternalOmit = {
  studentOtpHash: true,
  studentOtpExpiry: true,
  expertOtpHash: true,
  expertOtpExpiry: true,
} as const satisfies Prisma.ContractOmit;

export type SafeContract = Omit<Contract, keyof typeof contractInternalOmit>;
