import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";

/** Merchant API flat form messages; keep original scalar values, including decimal formatting. */
export function freedomSignature(script: string, fields: Record<string, unknown>, secret: string): string {
  const values = Object.keys(fields)
    .filter(key => key !== "pg_sig")
    .sort()
    .map(key => {
      const value = fields[key];
      if (key === "pg_xml" || (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))))
        throw new BadRequestException("Unsupported payment message format");
      return String(value);
    });
  return createHash("md5")
    .update([script, ...values, secret].join(";"))
    .digest("hex");
}

export interface VerifiedFreedomPayment {
  orderId: string;
  paymentId: string;
  amount: string;
  currency: string;
  merchantId: string;
}
