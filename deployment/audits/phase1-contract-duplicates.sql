-- Read-only preflight. Run on a copy of the target database before rollout.
-- Existing application invariant: at most one Contract per student, regardless of status.
SELECT "studentId", COUNT(*) AS "contractCount", array_agg(id ORDER BY "createdAt", id) AS "contractIds"
FROM "Contract"
GROUP BY "studentId"
HAVING COUNT(*) > 1
ORDER BY "studentId";

-- Historical payment references are not assumed unique and are never rewritten automatically.
SELECT "providerRef", COUNT(*) AS "transactionCount", array_agg(id ORDER BY "createdAt", id) AS "transactionIds"
FROM "Transaction"
WHERE "providerRef" IS NOT NULL
GROUP BY "providerRef"
HAVING COUNT(*) > 1
ORDER BY "providerRef";
