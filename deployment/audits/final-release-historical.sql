-- Release Readiness Audit, 2026-09-28. READ ONLY; run on a restored production copy.
-- Requires the final schema, including manual contracts and occurredAt migrations.
-- For pre-cutover assessment, restore production, apply migrations there, then run this file.
-- psql -X -v ON_ERROR_STOP=1 --file=deployment/audits/final-release-historical.sql
-- Supply credentials securely outside this file. Output contains IDs and financial data.
-- No UPDATE/DELETE/DDL, no automatic repair. REVIEW rows are candidates, not proof of corruption.
-- Each query returns all matches; retain row counts and investigate every invariant violation.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

-- C01 INVARIANT: historical duplicate contracts for one student.
SELECT 'C01' AS audit, "studentId", COUNT(*) AS contracts, array_agg(id ORDER BY "createdAt") AS ids
FROM "Contract" GROUP BY "studentId" HAVING COUNT(*) > 1;

-- C02 INVARIANT: normally prevented by the existing unique index.
SELECT 'C02' AS audit, "contractNumber", COUNT(*) AS contracts
FROM "Contract" GROUP BY "contractNumber" HAVING COUNT(*) > 1;

-- C03 REVIEW: inaccessible/deleted/non-student account, including soft-deleted role.
SELECT 'C03' AS audit, c.id, c."studentId", r.code, u."deletedAt", r."deletedAt" AS "roleDeletedAt"
FROM "Contract" c LEFT JOIN "User" u ON u.id=c."studentId" LEFT JOIN "Role" r ON r.id=u."roleId"
WHERE u.id IS NULL OR u."deletedAt" IS NOT NULL OR r.id IS NULL OR r."deletedAt" IS NOT NULL
   OR r.code NOT IN ('STUDENT','SCHOOLBOY');

-- C04 REVIEW: historical signer/lead owner differs from current operational owner.
-- Transfer A -> B is legitimate; DO NOT rewrite historical attribution from this result.
SELECT 'C04' AS audit, c.id, l.id AS "leadId", c."signedByUserId", l."assignedExpertUserId",
       x."userId" AS "currentExpertUserId", x."isActive"
FROM "Contract" c LEFT JOIN "Lead" l ON l."contractId"=c.id
LEFT JOIN "StudentPortrait" p ON p."userId"=c."studentId"
LEFT JOIN "ConsultantProfile" x ON x.id=p."consultantProfileId"
WHERE (x."userId" IS NOT NULL AND c."signedByUserId" IS NOT NULL AND x."userId"<>c."signedByUserId")
   OR (x."userId" IS NOT NULL AND l."assignedExpertUserId" IS NOT NULL AND x."userId"<>l."assignedExpertUserId")
   OR x."isActive"=false
   OR (x.id IS NULL AND NOT COALESCE(l.status='CONTRACT_PENDING' AND l."assignedExpertUserId" IS NOT NULL,false));

-- P01 RECONCILE against provider export; SUCCESS alone is not evidence of past signature validation.
SELECT 'P01' AS audit, id, "userId", amount, currency, "createdAt"
FROM "Transaction" WHERE status='SUCCESS' AND NULLIF(btrim("providerRef"),'') IS NULL;

-- P02 INVARIANT for the currently supported single receiving merchant.
SELECT 'P02' AS audit, "providerRef", COUNT(*) AS transactions, array_agg(id) AS ids
FROM "Transaction" WHERE NULLIF(btrim("providerRef"),'') IS NOT NULL
GROUP BY "providerRef" HAVING COUNT(*)>1;

-- P03 REVIEW: successful gateway receipt without observable benefits.
-- A callback for a manual contract intentionally only updates the gateway ledger.
-- Transfers, admin grants and tier changes require case-by-case reconciliation.
SELECT 'P03' AS audit, t.id, t."userId", t."subscriptionTier", p.subscription,
       EXISTS (SELECT 1 FROM "Contract" c WHERE c."studentId"=t."userId"
               AND (c."paymentType" IS NOT NULL OR c."manualConfirmedAt" IS NOT NULL)) AS "manualLedgerOnly"
FROM "Transaction" t LEFT JOIN "StudentPortrait" p ON p."userId"=t."userId"
WHERE t.status='SUCCESS' AND (p.id IS NULL OR p.subscription<>t."subscriptionTier"
  OR (t."subscriptionTier" IN ('AI_ROADMAP','EXPERT_MENTORSHIP')
      AND NOT EXISTS (SELECT 1 FROM "StudentPackage" b WHERE b."studentId"=t."userId" AND b."totalSlots">0)));

-- P04 REVIEW: paid subscription/package with no recorded receipt.
-- Legacy benefits-on-signature, admin grants, and receipts outside the system are possible.
SELECT 'P04' AS audit, p."userId", p.subscription
FROM "StudentPortrait" p
WHERE (p.subscription<>'FREE' OR EXISTS (SELECT 1 FROM "StudentPackage" b WHERE b."studentId"=p."userId" AND b."totalSlots">0))
AND NOT EXISTS (SELECT 1 FROM "Transaction" t WHERE t."userId"=p."userId" AND t.status='SUCCESS')
AND NOT EXISTS (SELECT 1 FROM "Contract" c JOIN "ContractInstallment" i ON i."contractId"=c.id
                WHERE c."studentId"=p."userId" AND i."paidAt" IS NOT NULL);

-- P05 REVIEW: ledger vs contract mismatch, not proof a callback amount was wrong.
-- Raw historical signed payloads/provider exports are not stored in this schema.
-- Legacy USD tier purchases and multiple purchases can legitimately differ from contract face value.
SELECT 'P05' AS audit, t.id AS "transactionId", c.id AS "contractId", t.amount, t.currency,
       c.price AS "contractPrice", c.currency AS "contractCurrency", t."subscriptionTier", c."subscriptionTier" AS "contractTier"
FROM "Transaction" t JOIN "Contract" c ON c."studentId"=t."userId"
WHERE t.status='SUCCESS' AND (t.amount<=0 OR t.currency<>c.currency OR t.amount::numeric<>c.price::numeric
                           OR t."subscriptionTier"<>c."subscriptionTier");

-- P06 INVARIANT: schedule total/count disagree with stored contract terms.
SELECT 'P06' AS audit, c.id, c.price, c.currency, c."installmentCount", COUNT(i.id) AS installments, SUM(i.amount) AS scheduled
FROM "Contract" c LEFT JOIN "ContractInstallment" i ON i."contractId"=c.id
WHERE c."manualConfirmedAt" IS NOT NULL
GROUP BY c.id HAVING c."installmentCount" IS NULL OR COUNT(i.id)<>c."installmentCount" OR COALESCE(SUM(i.amount),0)<>c.price::numeric;

-- M01 INVARIANT: closed lead with no persisted contract.
SELECT 'M01' AS audit, l.id, l."contractId", l."convertedAt"
FROM "Lead" l LEFT JOIN "Contract" c ON c.id=l."contractId"
WHERE l.status='CONVERTED' AND c.id IS NULL;

-- M02 INVARIANT: manual confirmation without paid first installment.
SELECT 'M02' AS audit, c.id, c."manualConfirmedAt"
FROM "Contract" c LEFT JOIN "ContractInstallment" i ON i."contractId"=c.id AND i.number=1
WHERE c."manualConfirmedAt" IS NOT NULL AND (i.id IS NULL OR i."paidAt" IS NULL);

-- M03 INVARIANT: first receipt but signature/confirmation absent.
SELECT 'M03' AS audit, c.id, i."paidAt", c."studentSignedAt", c."manualConfirmedAt", c.status
FROM "Contract" c JOIN "ContractInstallment" i ON i."contractId"=c.id AND i.number=1
WHERE i."paidAt" IS NOT NULL AND (c."studentSignedAt" IS NULL OR c."manualConfirmedAt" IS NULL
                                OR c.status NOT IN ('SIGNED','PAID'));

-- M04 INVARIANT: fully paid contract still has unpaid schedule rows.
SELECT 'M04' AS audit, c.id, COUNT(*) AS unpaid
FROM "Contract" c JOIN "ContractInstallment" i ON i."contractId"=c.id
WHERE c.status='PAID' AND i."paidAt" IS NULL GROUP BY c.id;

-- M05 INVARIANT: manual SIGNED has no positive remaining debt.
SELECT 'M05' AS audit, c.id, c.price, COALESCE(SUM(i.amount) FILTER (WHERE i."paidAt" IS NOT NULL),0) AS paid
FROM "Contract" c LEFT JOIN "ContractInstallment" i ON i."contractId"=c.id
WHERE c.status='SIGNED' AND c."manualConfirmedAt" IS NOT NULL
GROUP BY c.id HAVING c.price::numeric-COALESCE(SUM(i.amount) FILTER (WHERE i."paidAt" IS NOT NULL),0)<=0;

-- M06 REVIEW: account exists before first payment/no payment. Account reuse is legitimate.
-- Pending legacy linked contracts require migration inventory; new draft-only leads should have no contract.
SELECT 'M06' AS audit, c.id, l.id AS "leadId", c."studentId", u."createdAt" AS "accountCreatedAt",
       c."createdAt" AS "contractCreatedAt", i."paidAt" AS "firstPaidAt", c."manualConfirmedAt", c.status,
       EXISTS (SELECT 1 FROM "LeadStudentInvitation" v WHERE v."userId"=u.id) AS "hasInvitation"
FROM "Contract" c JOIN "User" u ON u.id=c."studentId" LEFT JOIN "Lead" l ON l."contractId"=c.id
LEFT JOIN "ContractInstallment" i ON i."contractId"=c.id AND i.number=1
WHERE l.id IS NOT NULL AND (i."paidAt" IS NULL OR u."createdAt"<i."paidAt");

-- M07 REVIEW: confirmed manual or historical SIGNED contract without expected benefits (R02/R08).
-- Prior SIGNED is not sufficient evidence that an entitlement was successfully granted.
SELECT 'M07' AS audit, c.id, c."studentId", c."subscriptionTier", p.subscription,
       EXISTS (SELECT 1 FROM "StudentPackage" b WHERE b."studentId"=c."studentId" AND b."totalSlots">0) AS "hasAnyPackage"
FROM "Contract" c LEFT JOIN "StudentPortrait" p ON p."userId"=c."studentId"
WHERE (c."manualConfirmedAt" IS NOT NULL OR c.status='SIGNED') AND
 (c."subscriptionTier"='FREE' OR p.id IS NULL OR p.subscription<>c."subscriptionTier"
  OR (c."subscriptionTier" IN ('AI_ROADMAP','EXPERT_MENTORSHIP')
      AND NOT EXISTS (SELECT 1 FROM "StudentPackage" b WHERE b."studentId"=c."studentId" AND b."totalSlots">0)));

-- M08 INVARIANT: later receipt without prior receipt or in reversed payment order.
SELECT 'M08' AS audit, i."contractId", i.number, i."paidAt", prior.number AS "previousNumber", prior."paidAt" AS "previousPaidAt"
FROM "ContractInstallment" i JOIN "ContractInstallment" prior ON prior."contractId"=i."contractId" AND prior.number<i.number
WHERE i."paidAt" IS NOT NULL AND (prior."paidAt" IS NULL OR prior."paidAt">i."paidAt");

-- J01 REVIEW: duplicate first milestones; historical independent purchases may explain payment duplicates.
SELECT 'J01' AS audit, "userId", "eventType", COUNT(*) AS events, array_agg(id ORDER BY id) AS ids
FROM "UserJourneyEvent" WHERE "eventType" IN ('PAYMENT_COMPLETED','CONTRACT_SIGNED')
GROUP BY "userId","eventType" HAVING COUNT(*)>1;

-- J02 INVARIANT: milestone missing for a confirmed manual contract, matching backfill user scope.
SELECT 'J02' AS audit, c.id, c."studentId", required.type AS missing
FROM "Contract" c CROSS JOIN (VALUES ('CONTRACT_SIGNED'),('PAYMENT_COMPLETED')) required(type)
WHERE c."manualConfirmedAt" IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM "UserJourneyEvent" e WHERE e."userId"=c."studentId" AND e."eventType"=required.type)
UNION ALL
SELECT 'J02', c.id, c."studentId", 'LEAD_CONVERTED'
FROM "Contract" c JOIN "Lead" l ON l."contractId"=c.id
WHERE c."manualConfirmedAt" IS NOT NULL AND l.status='CONVERTED' AND NOT EXISTS
 (SELECT 1 FROM "UserJourneyEvent" e WHERE e."userId"=c."studentId" AND e."eventType"='LEAD_CONVERTED');

-- J03 REVIEW: null manual business timestamps, future events or occurrence after recording.
-- Null occurredAt is expected on legacy non-manual events; negative registration lag can be valid.
SELECT 'J03' AS audit, id, "userId", "eventType", "createdAt", "occurredAt"
FROM "UserJourneyEvent"
WHERE "occurredAt">CURRENT_TIMESTAMP OR "occurredAt">"createdAt"
 OR ("eventData"->>'manual'='true' AND "occurredAt" IS NULL);

-- J04 REVIEW: milestone date differs from authoritative manual fact.
SELECT 'J04' AS audit, c.id, e.id AS "eventId", e."eventType", e."occurredAt", facts.expected
FROM "Contract" c JOIN "ContractInstallment" i ON i."contractId"=c.id AND i.number=1
CROSS JOIN LATERAL (VALUES ('CONTRACT_SIGNED',c."studentSignedAt"),('PAYMENT_COMPLETED',i."paidAt")) facts(type,expected)
JOIN "UserJourneyEvent" e ON e."userId"=c."studentId" AND e."eventType"=facts.type
WHERE c."manualConfirmedAt" IS NOT NULL AND e."occurredAt" IS DISTINCT FROM facts.expected;

-- J05 REVIEW: payment before signature. Business must define whether prepayment is permitted.
SELECT 'J05' AS audit, c.id, c."studentSignedAt", i."paidAt", c."manualConfirmedAt"
FROM "Contract" c JOIN "ContractInstallment" i ON i."contractId"=c.id AND i.number=1
WHERE i."paidAt"<c."studentSignedAt" OR c."manualConfirmedAt"<i."paidAt" OR c."manualConfirmedAt"<c."studentSignedAt";

-- J06 REVIEW: recorded events imply negative chronology; manual account-after-payment is EXPECTED.
SELECT 'J06' AS audit, u.id AS "studentId", u."createdAt" AS "registeredAt",
       MIN(COALESCE(e."occurredAt",e."createdAt")) AS "firstBusinessEventAt"
FROM "User" u JOIN "UserJourneyEvent" e ON e."userId"=u.id
WHERE e."eventType" IN ('CONTRACT_SIGNED','PAYMENT_COMPLETED')
GROUP BY u.id HAVING MIN(COALESCE(e."occurredAt",e."createdAt"))<u."createdAt";

-- J07 INVARIANT: repeated later installment event for same contract/number.
SELECT 'J07' AS audit, "userId", "eventData"->>'contractId' AS "contractId",
       "eventData"->>'installmentNumber' AS number, COUNT(*) AS events
FROM "UserJourneyEvent" WHERE "eventType"='CONTRACT_INSTALLMENT_PAID'
GROUP BY "userId","eventData"->>'contractId',"eventData"->>'installmentNumber' HAVING COUNT(*)>1;

-- J08 INVARIANT: paid later installment missing its event.
SELECT 'J08' AS audit, c.id, i.number, i."paidAt"
FROM "Contract" c JOIN "ContractInstallment" i ON i."contractId"=c.id
WHERE c."manualConfirmedAt" IS NOT NULL AND i.number>1 AND i."paidAt" IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM "UserJourneyEvent" e WHERE e."userId"=c."studentId" AND e."eventType"='CONTRACT_INSTALLMENT_PAID'
   AND e."eventData"->>'contractId'=c.id AND e."eventData"->>'installmentNumber'=i.number::text);

COMMIT;
