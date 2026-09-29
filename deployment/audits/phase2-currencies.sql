-- Read-only inventory. These totals are grouped by currency; never sum the groups without FX policy.
SELECT currency, status, COUNT(*) AS contracts, SUM(price::numeric) AS price
FROM "Contract" GROUP BY currency, status ORDER BY currency, status;

SELECT currency, status, COUNT(*) AS transactions, SUM(amount::numeric) AS amount
FROM "Transaction" GROUP BY currency, status ORDER BY currency, status;

SELECT c.currency, COUNT(*) AS confirmed_installments, SUM(i.amount) AS received
FROM "ContractInstallment" i JOIN "Contract" c ON c.id = i."contractId"
WHERE i."paidAt" IS NOT NULL GROUP BY c.currency ORDER BY c.currency;
