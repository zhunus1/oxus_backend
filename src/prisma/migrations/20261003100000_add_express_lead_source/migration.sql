INSERT INTO "LeadSource" ("code", "name", "isActive", "createdAt", "updatedAt")
VALUES ('express', 'express', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
