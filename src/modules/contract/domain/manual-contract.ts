import { BadRequestException } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import type { ContractPaymentType, SubscriptionTier } from "generated/prisma/enums";
import { TIER_SLOTS } from "src/modules/studentportrait/domain/contract-benefits";
import { MAX_NEW_CONTRACT_INSTALLMENTS } from "./manual-contract.constants";

/** Shared by every contract writer; historical amounts retain their existing compatibility. */
export function commercialTerms(
  price: number,
  currency: string,
  subscriptionTier: SubscriptionTier,
  paymentType: ContractPaymentType = "FULL",
  installmentCount?: number,
  legacy = false,
  preserveExistingInstallments = false,
) {
  if (!Object.hasOwn(TIER_SLOTS, subscriptionTier) || !TIER_SLOTS[subscriptionTier]) throw new BadRequestException("Select a paid tariff");
  return paymentTerms(price, currency, paymentType, installmentCount, legacy, preserveExistingInstallments);
}

export function paymentTerms(
  price: number,
  currency: string,
  paymentType: ContractPaymentType = "FULL",
  installmentCount?: number,
  legacy = false,
  preserveExistingInstallments = false,
) {
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    (!legacy && (!Number.isInteger(price) || ![1500000, 750000].includes(price))) ||
    (legacy ? !["KZT", "USD", "EUR"].includes(currency) : currency !== "KZT")
  )
    throw new BadRequestException("Contract price must be 1500000 KZT or 750000 KZT for Cambridge Line");
  const count = installmentCount ?? (paymentType === "FULL" ? 1 : undefined);
  // Only confirmation of persisted terms preserves a historical plan; editing legacy prices does not lift the new-plan limit.
  const maximum = legacy && preserveExistingInstallments ? 120 : MAX_NEW_CONTRACT_INSTALLMENTS;
  if (!["FULL", "INSTALLMENT"].includes(paymentType) || !Number.isSafeInteger(count) || count! < 1 || count! > maximum || (paymentType === "FULL" ? count !== 1 : count! < 2))
    throw new BadRequestException(`FULL requires one payment; INSTALLMENT requires an explicit count from 2 to ${maximum}`);
  return { paymentType, installmentCount: count! };
}

export function pastPaymentDate(value: string | Date, field: string): Date {
  if (typeof value === "string" && !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new BadRequestException(`${field} must include a time and timezone`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date > new Date()) throw new BadRequestException(`${field} must be a valid date in the past or present`);
  return date;
}

/** Keep the original local day, including after February, and allocate rounding in tiyn. */
export function installmentSchedule(price: number, count: number, firstPaidAt: Date) {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(firstPaidAt);
  const part = (type: string) => Number(local.find(p => p.type === type)!.value);
  const year = part("year"),
    month = part("month") - 1,
    day = part("day");
  const total = new Prisma.Decimal(price).mul(100).toNumber();
  if (!Number.isSafeInteger(total) || total < count) throw new BadRequestException("Invalid contract amount");
  const base = Math.floor(total / count),
    remainder = total % count;
  return Array.from({ length: count }, (_, index) => {
    const lastDay = new Date(Date.UTC(year, month + index + 1, 0)).getUTCDate();
    return {
      number: index + 1,
      amount: new Prisma.Decimal(base + (index < remainder ? 1 : 0)).div(100),
      dueDate: new Date(Date.UTC(year, month + index, Math.min(day, lastDay))),
    };
  });
}
