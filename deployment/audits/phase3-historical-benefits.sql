-- R02 review candidates only, not proof of corruption or of benefits never issued.
-- Final schema required. Read-only snapshot; no names, emails, phones or gateway secrets.
-- psql -X -v ON_ERROR_STOP=1 --file=deployment/audits/phase3-historical-benefits.sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

WITH observed AS (
  SELECT c.id AS "contractId", c."studentId", c."subscriptionTier", c.status, c."manualConfirmedAt",
         c.price, c.currency, c."studentSignedAt", c."signedByUserId",
         p.subscription AS "observedSubscription", p."consultantProfileId" AS "currentExpertProfileId",
         p."consultationBalance", k.id AS "currentPackageId", k."totalSlots", k."usedSlots",
         CASE c."subscriptionTier" WHEN 'AI_ROADMAP' THEN 3 WHEN 'EXPERT_MENTORSHIP' THEN 10 END AS "expectedSlots",
         EXISTS (SELECT 1 FROM "Contract" other WHERE other."studentId"=c."studentId" AND other.id<>c.id) AS "competingContract",
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', sp.id, 'expertId', sp."expertId", 'totalSlots', sp."totalSlots", 'usedSlots', sp."usedSlots"))
                   FROM "StudentPackage" sp WHERE sp."studentId"=c."studentId"), '[]'::jsonb) AS packages,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'amount', t.amount, 'currency', t.currency,
                   'createdAt', t."createdAt", 'hasProviderRef', NULLIF(btrim(t."providerRef"),'') IS NOT NULL))
                   FROM "Transaction" t WHERE t."userId"=c."studentId"), '[]'::jsonb) AS "gatewayEvidence",
         COALESCE((SELECT jsonb_agg(jsonb_build_object('number', i.number, 'amount', i.amount, 'paidAt', i."paidAt"))
                   FROM "ContractInstallment" i WHERE i."contractId"=c.id), '[]'::jsonb) AS "manualEvidence"
  FROM "Contract" c
  LEFT JOIN "StudentPortrait" p ON p."userId"=c."studentId"
  LEFT JOIN "StudentPackage" k ON k."studentId"=c."studentId" AND k."expertId"=p."consultantProfileId"
  WHERE c.status='SIGNED' AND c."manualConfirmedAt" IS NULL
), classified AS (
  SELECT *, array_remove(ARRAY[
    CASE WHEN "expectedSlots" IS NULL THEN 'UNSUPPORTED_PAID_TIER' END,
    CASE WHEN "observedSubscription" IS DISTINCT FROM "subscriptionTier" THEN 'SUBSCRIPTION_MISMATCH_OR_MISSING' END,
    CASE WHEN "currentPackageId" IS NULL THEN 'CURRENT_OWNER_PACKAGE_MISSING_OR_TRANSFERRED' END,
    CASE WHEN "totalSlots" < "expectedSlots" THEN 'INSUFFICIENT_OBSERVED_CAPACITY' END,
    CASE WHEN "usedSlots" < 0 OR "usedSlots" > "totalSlots" THEN 'INCONSISTENT_PACKAGE_USAGE' END,
    CASE WHEN "competingContract" THEN 'MULTIPLE_CONTRACTS_ENTITLEMENT_ATTRIBUTION_UNKNOWN' END
  ], NULL) AS "reviewReasons"
  FROM observed
)
SELECT 'R02' AS audit, 'C_AMBIGUOUS_REVIEW_REQUIRED' AS classification, *
FROM classified WHERE cardinality("reviewReasons") > 0 ORDER BY "contractId";
-- Empty reasons = Case A, observable benefits consistent; no claim of immutable grant provenance.
-- Case B (provably never granted) cannot be established from this schema. Missing != never issued.
-- Historical PAID is Case D and retains the existing 409 policy; not a candidate for this transition.
-- Gateway rows are student-level evidence, not proof of contract grant or verified historical callback.
COMMIT;
