BEGIN;

ALTER TABLE "Lead" ADD COLUMN "statusChangedAt" TIMESTAMP(3);

-- Historical status-change timestamps were not recorded reliably. Preserve the
-- creation order until each existing lead next changes status.
UPDATE "Lead" SET "statusChangedAt" = "createdAt";

ALTER TABLE "Lead"
  ALTER COLUMN "statusChangedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "statusChangedAt" SET NOT NULL;

CREATE INDEX "Lead_assignedExpertUserId_statusChangedAt_id_idx"
  ON "Lead"("assignedExpertUserId", "statusChangedAt", "id");

COMMIT;
