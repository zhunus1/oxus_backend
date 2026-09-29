import { Prisma } from "generated/prisma/client";

/** Aggregate receipts before contracts so a fully paid installment plan is counted once. */
export function expertEarningsTotalsQuery(expertId: number) {
  return Prisma.sql`
    WITH receipts AS (
      SELECT i."contractId", COALESCE(SUM(i.amount) FILTER (WHERE i."paidAt" IS NOT NULL), 0) AS paid
      FROM "ContractInstallment" i JOIN "Contract" scoped ON scoped.id = i."contractId"
      WHERE scoped."signedByUserId" = ${expertId}
      GROUP BY i."contractId"
    ), amounts AS (
      SELECT c.currency, c.status, c.price::numeric AS price,
        CASE WHEN r."contractId" IS NOT NULL THEN r.paid
          WHEN c.status = 'PAID' THEN c.price::numeric ELSE 0 END AS paid
      FROM "Contract" c LEFT JOIN receipts r ON r."contractId" = c.id
      WHERE c."signedByUserId" = ${expertId}
    )
    SELECT currency, COUNT(*) AS count,
      SUM(CASE WHEN status IN ('SIGNED', 'PAID') THEN price ELSE 0 END) AS "totalSignedAmount",
      SUM(paid) AS "totalPaidAmount",
      SUM(CASE WHEN status = 'SIGNED' THEN price - paid ELSE 0 END) AS "signedUnpaidAmount"
    FROM amounts GROUP BY currency ORDER BY currency
  `;
}
