-- Restore only facts already attested by manual confirmation and recorded receipts.
-- createdAt remains insertion time; occurredAt records the historical business fact.
BEGIN;

WITH candidates AS (
  SELECT c."studentId" AS "userId", 'CONTRACT_SIGNED' AS type, c."studentSignedAt" AS at,
    jsonb_build_object('contractId', c.id, 'manual', true, 'backfilled', true) AS data
  FROM "Contract" c
  WHERE c."manualConfirmedAt" IS NOT NULL AND c."studentSignedAt" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "ContractInstallment" i WHERE i."contractId" = c.id AND i.number = 1 AND i."paidAt" IS NOT NULL)
  UNION ALL
  SELECT c."studentId", 'PAYMENT_COMPLETED', i."paidAt",
    jsonb_build_object('contractId', c.id, 'manual', true, 'backfilled', true,
      'installmentNumber', 1, 'amount', i.amount::text, 'currency', c.currency, 'actorUserId', i."confirmedByUserId")
  FROM "Contract" c JOIN "ContractInstallment" i ON i."contractId" = c.id AND i.number = 1
  WHERE c."manualConfirmedAt" IS NOT NULL AND i."paidAt" IS NOT NULL
  UNION ALL
  SELECT c."studentId", 'LEAD_CONVERTED', l."convertedAt",
    jsonb_build_object('contractId', c.id, 'leadId', l.id, 'manual', true, 'backfilled', true)
  FROM "Contract" c JOIN "Lead" l ON l."contractId" = c.id
  WHERE c."manualConfirmedAt" IS NOT NULL AND l.status = 'CONVERTED' AND l."convertedAt" IS NOT NULL
), first_events AS (
  SELECT DISTINCT ON ("userId", type) * FROM candidates ORDER BY "userId", type, at, data::text
)
INSERT INTO "UserJourneyEvent" ("userId", "eventType", "occurredAt", "eventData")
SELECT f."userId", f.type, f.at, f.data FROM first_events f
WHERE NOT EXISTS (SELECT 1 FROM "UserJourneyEvent" e WHERE e."userId" = f."userId" AND e."eventType" = f.type);

INSERT INTO "UserJourneyEvent" ("userId", "eventType", "occurredAt", "eventData")
SELECT c."studentId", 'CONTRACT_INSTALLMENT_PAID', i."paidAt",
  jsonb_build_object('contractId', c.id, 'manual', true, 'backfilled', true,
    'installmentNumber', i.number, 'amount', i.amount::text, 'currency', c.currency, 'actorUserId', i."confirmedByUserId")
FROM "Contract" c JOIN "ContractInstallment" i ON i."contractId" = c.id
WHERE c."manualConfirmedAt" IS NOT NULL AND i.number > 1 AND i."paidAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "UserJourneyEvent" e WHERE e."userId" = c."studentId" AND e."eventType" = 'CONTRACT_INSTALLMENT_PAID'
      AND e."eventData"->>'contractId' = c.id AND e."eventData"->>'installmentNumber' = i.number::text
  );

COMMIT;
