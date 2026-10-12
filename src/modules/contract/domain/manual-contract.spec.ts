import { commercialTerms, installmentSchedule, pastPaymentDate, paymentTerms } from "./manual-contract";
import { Prisma } from "generated/prisma/client";

jest.mock("generated/prisma/client", () => ({ Prisma: { Decimal: jest.requireActual("@prisma/client/runtime/client").Decimal } }));

describe("manual contract payment schedule", () => {
  it.each([750000, 1500000])("rejects FREE commercial terms at %i even in legacy mode", price => {
    for (const legacy of [false, true]) expect(() => commercialTerms(price, "KZT", "FREE", "FULL", 1, legacy)).toThrow("Select a paid tariff");
  });

  it.each(["AI_ROADMAP", "EXPERT_MENTORSHIP"] as const)("accepts both established prices for %s without inventing a tier-price mapping", tier => {
    for (const price of [750000, 1500000]) expect(commercialTerms(price, "KZT", tier)).toEqual({ paymentType: "FULL", installmentCount: 1 });
  });

  it("rejects unknown or inherited tier names on direct calls", () => {
    for (const tier of [undefined, "unknown", "toString", "__proto__"]) expect(() => commercialTerms(1500000, "KZT", tier as any)).toThrow();
  });
  it("anchors to the Almaty payment date and returns to the original day after February", () => {
    const schedule = installmentSchedule(1500000, 3, new Date("2026-01-30T21:00:00Z"));
    expect(schedule.map(p => p.dueDate.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(schedule.map(p => p.amount.toNumber())).toEqual([500000, 500000, 500000]);
  });

  it("handles leap years and year boundaries without cumulative day drift", () => {
    expect(installmentSchedule(750000, 4, new Date("2023-12-31T12:00:00Z")).map(p => p.dueDate.toISOString().slice(0, 10))).toEqual([
      "2023-12-31",
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
    ]);
  });

  it.each([3, 7, 11, 120])("allocates rounding exactly across %i installments", count => {
    const rows = installmentSchedule(750000, count, new Date("2026-01-01T00:00:00Z"));
    expect(rows.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0)).toNumber()).toBe(750000);
    expect(rows[0].amount.sub(rows.at(-1)!.amount).lte("0.01")).toBe(true);
  });

  it.each([
    [100000, "KZT", "FULL", 1],
    [1500000, "USD", "FULL", 1],
    [1500000, "KZT", "FULL", 2],
    [750000, "KZT", "INSTALLMENT", undefined],
    [750000, "KZT", "INSTALLMENT", 1],
    [750000, "KZT", "INSTALLMENT", 2.5],
    [750000, "KZT", "INSTALLMENT", 121],
  ])("rejects invalid terms %j %s %s %s", (price, currency, type, count) => {
    expect(() => paymentTerms(price, currency, type as "FULL", count as number)).toThrow();
  });

  it("accepts both prices and defaults full payment to one installment", () => {
    for (const price of [750000, 1500000]) expect(paymentTerms(price, "KZT")).toEqual({ paymentType: "FULL", installmentCount: 1 });
  });

  it.each([2, 3])("accepts %i total installments for a new plan", count => {
    expect(paymentTerms(1500000, "KZT", "INSTALLMENT", count)).toEqual({ paymentType: "INSTALLMENT", installmentCount: count });
  });

  it.each([4, 7, 120, 121])("rejects %i installments even when editing historical amounts", count => {
    for (const legacy of [false, true]) expect(() => commercialTerms(1500000, "KZT", "EXPERT_MENTORSHIP", "INSTALLMENT", count, legacy)).toThrow();
  });

  it.each([4, 7, 120])("preserves %i installments only for unchanged historical terms", count => {
    expect(commercialTerms(499, "USD", "EXPERT_MENTORSHIP", "INSTALLMENT", count, true, true)).toEqual({ paymentType: "INSTALLMENT", installmentCount: count });
    expect(() => paymentTerms(1500000, "KZT", "INSTALLMENT", count, false, true)).toThrow();
  });

  it("preserves historical currency and amount only when explicitly handling existing terms", () => {
    expect(() => paymentTerms(499, "USD", "INSTALLMENT", 2)).toThrow();
    expect(paymentTerms(499, "USD", "INSTALLMENT", 2, true)).toEqual({ paymentType: "INSTALLMENT", installmentCount: 2 });
  });

  it.each(["2099-01-01T00:00:00Z", "invalid", "2026-01-01", "2026-01-01T12:00:00"])("rejects an ambiguous or future timestamp %s", date => {
    expect(() => pastPaymentDate(date, "paidAt")).toThrow();
  });
});
