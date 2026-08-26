-- Additive Sales CRM migration. Existing lead data is retained and copied into
-- immutable legacy submissions before phone values are normalized.

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CALL_SCHEDULED', 'RECALL', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeadCallbackStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadExpertCallStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadSource_code_key" ON "LeadSource"("code");

INSERT INTO "LeadSource" ("id", "code", "name", "isActive", "createdAt", "updatedAt") VALUES
    (1, 'legacy-contact-form', 'Legacy contact form', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (2, 'landing-calculator', 'Landing calculator', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (3, 'office-manual', 'Office manual entry', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

SELECT setval(pg_get_serial_sequence('"LeadSource"', 'id'), 3, true);

-- Production deployments run migrations without necessarily running seeds, so
-- RBAC data required by the new controllers is installed idempotently here.
WITH new_permissions ("ordinal", "name", "code", "description") AS (
    VALUES
        (1, 'View Unassigned Leads', 'SALES_LEADS_READ_UNASSIGNED', 'Просмотр общей очереди новых лидов'),
        (2, 'Create Sales Lead', 'SALES_LEADS_CREATE', 'Ручное создание лидов'),
        (3, 'Accept Sales Lead', 'SALES_LEADS_ACCEPT', 'Принятие лида в работу'),
        (4, 'Manage Own Sales Leads', 'SALES_LEADS_MANAGE_OWN', 'Работа только со своими лидами'),
        (5, 'View Expert Availability', 'SALES_EXPERTS_READ_SLOTS', 'Просмотр свободных слотов экспертов'),
        (6, 'View Sales Notifications', 'SALES_NOTIFICATIONS_READ', 'Просмотр уведомлений Sales Manager'),
        (7, 'Respond to Lead Calls', 'EXPERT_LEAD_CALLS_RESPOND', 'Работа с запросами на созвон от Sales Manager')
), permission_base AS (
    SELECT GREATEST(COALESCE(MAX("id"), 0), 12) AS "baseId" FROM "Permission"
)
INSERT INTO "Permission" ("id", "name", "code", "description")
SELECT permission_base."baseId" + new_permissions."ordinal", new_permissions."name", new_permissions."code", new_permissions."description"
FROM new_permissions
CROSS JOIN permission_base
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "deletedAt" = NULL;

INSERT INTO "Role" ("id", "name", "code", "description", "createdAt")
SELECT GREATEST(COALESCE(MAX("id"), 0), 4) + 1, 'Sales Manager', 'SALES_MANAGER', 'Менеджер по продажам', CURRENT_TIMESTAMP
FROM "Role"
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "deletedAt" = NULL;

INSERT INTO "_PermissionToRole" ("A", "B")
SELECT permission."id", role."id"
FROM "Permission" AS permission
CROSS JOIN "Role" AS role
WHERE role."code" = 'SALES_MANAGER'
  AND permission."code" IN (
      'SALES_LEADS_READ_UNASSIGNED',
      'SALES_LEADS_CREATE',
      'SALES_LEADS_ACCEPT',
      'SALES_LEADS_MANAGE_OWN',
      'SALES_EXPERTS_READ_SLOTS',
      'SALES_NOTIFICATIONS_READ'
  )
ON CONFLICT DO NOTHING;

INSERT INTO "_PermissionToRole" ("A", "B")
SELECT permission."id", role."id"
FROM "Permission" AS permission
CROSS JOIN "Role" AS role
WHERE role."code" = 'EXPERT'
  AND permission."code" = 'EXPERT_LEAD_CALLS_RESPOND'
ON CONFLICT DO NOTHING;

INSERT INTO "_PermissionToRole" ("A", "B")
SELECT permission."id", role."id"
FROM "Permission" AS permission
CROSS JOIN "Role" AS role
WHERE role."code" = 'ADMIN'
  AND permission."code" IN (
      'SALES_LEADS_READ_UNASSIGNED',
      'SALES_LEADS_CREATE',
      'SALES_LEADS_ACCEPT',
      'SALES_LEADS_MANAGE_OWN',
      'SALES_EXPERTS_READ_SLOTS',
      'SALES_NOTIFICATIONS_READ',
      'EXPERT_LEAD_CALLS_RESPOND'
  )
ON CONFLICT DO NOTHING;

SELECT setval(pg_get_serial_sequence('"Permission"', 'id'), GREATEST((SELECT MAX("id") FROM "Permission"), 1), true);
SELECT setval(pg_get_serial_sequence('"Role"', 'id'), GREATEST((SELECT MAX("id") FROM "Role"), 1), true);

-- AlterTable
ALTER TABLE "Lead" RENAME COLUMN "phone" TO "phone_number";

ALTER TABLE "Lead"
    ALTER COLUMN "firstName" DROP NOT NULL,
    ALTER COLUMN "lastName" DROP NOT NULL,
    ALTER COLUMN "email" DROP NOT NULL,
    ALTER COLUMN "topic" DROP NOT NULL,
    ALTER COLUMN "interests" DROP NOT NULL,
    ALTER COLUMN "role" DROP NOT NULL,
    ALTER COLUMN "preferredLanguage" DROP NOT NULL,
    ALTER COLUMN "phone_number" DROP NOT NULL,
    ADD COLUMN "displayName" TEXT,
    ADD COLUMN "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    ADD COLUMN "originSourceId" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "assignedSalesManagerId" INTEGER,
    ADD COLUMN "acceptedAt" TIMESTAMP(3),
    ADD COLUMN "createdByUserId" INTEGER,
    ADD COLUMN "rejectedAt" TIMESTAMP(3),
    ADD COLUMN "rejectionReason" TEXT,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Lead"
    ADD CONSTRAINT "Lead_originSourceId_fkey"
    FOREIGN KEY ("originSourceId") REFERENCES "LeadSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Lead_assignedSalesManagerId_fkey"
    FOREIGN KEY ("assignedSalesManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "Lead_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LeadSubmission" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "externalSubmissionId" TEXT,
    "schemaVersion" TEXT,
    "calculatorVersion" TEXT,
    "rawPayload" JSONB NOT NULL,
    "normalizedPayload" JSONB,
    "metrics" JSONB,
    "submittedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCallback" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "salesManagerId" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "LeadCallbackStatus" NOT NULL DEFAULT 'SCHEDULED',
    "comment" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadCallback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadExpertCall" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "salesManagerId" INTEGER NOT NULL,
    "expertUserId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "comment" TEXT,
    "status" "LeadExpertCallStatus" NOT NULL DEFAULT 'REQUESTED',
    "responseComment" TEXT,
    "respondedAt" TIMESTAMP(3),
    "meetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadExpertCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "actorUserId" INTEGER,
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- Preserve every existing legacy contact form payload before normalization.
INSERT INTO "LeadSubmission" (
    "leadId",
    "sourceId",
    "schemaVersion",
    "rawPayload",
    "normalizedPayload",
    "submittedAt",
    "receivedAt"
)
SELECT
    lead."id",
    1,
    'legacy-v1',
    jsonb_strip_nulls(jsonb_build_object(
        'firstName', lead."firstName",
        'lastName', lead."lastName",
        'phone', lead."phone_number",
        'email', lead."email",
        'topic', lead."topic",
        'interests', lead."interests",
        'role', lead."role",
        'preferredLanguage', lead."preferredLanguage"
    )),
    jsonb_strip_nulls(jsonb_build_object(
        'displayName', NULLIF(BTRIM(CONCAT_WS(' ', lead."firstName", lead."lastName")), ''),
        'phoneNumber', lead."phone_number",
        'email', lead."email",
        'role', lead."role",
        'preferredLanguage', lead."preferredLanguage"
    )),
    lead."createdAt",
    lead."createdAt"
FROM "Lead" AS lead;

UPDATE "Lead"
SET
    "displayName" = NULLIF(BTRIM(CONCAT_WS(' ', "firstName", "lastName")), ''),
    "phone_number" = CASE
        WHEN LENGTH(REGEXP_REPLACE("phone_number", '[^0-9]', '', 'g')) = 11
             AND REGEXP_REPLACE("phone_number", '[^0-9]', '', 'g') LIKE '8%'
            THEN '+7' || SUBSTRING(REGEXP_REPLACE("phone_number", '[^0-9]', '', 'g') FROM 2)
        WHEN LENGTH(REGEXP_REPLACE("phone_number", '[^0-9]', '', 'g')) = 10
             AND REGEXP_REPLACE("phone_number", '[^0-9]', '', 'g') LIKE '7%'
            THEN '+7' || REGEXP_REPLACE("phone_number", '[^0-9]', '', 'g')
        WHEN LENGTH(REGEXP_REPLACE("phone_number", '[^0-9]', '', 'g')) BETWEEN 8 AND 15
            THEN '+' || REGEXP_REPLACE("phone_number", '[^0-9]', '', 'g')
        ELSE NULLIF(BTRIM("phone_number"), '')
    END;

-- AlterTable
ALTER TABLE "NotificationLog"
    ADD COLUMN "leadId" INTEGER,
    ADD COLUMN "metadata" JSONB,
    ADD COLUMN "readAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "LeadSubmission_sourceId_externalSubmissionId_key" ON "LeadSubmission"("sourceId", "externalSubmissionId");
CREATE INDEX "LeadSubmission_leadId_receivedAt_idx" ON "LeadSubmission"("leadId", "receivedAt");
CREATE INDEX "LeadSubmission_sourceId_receivedAt_idx" ON "LeadSubmission"("sourceId", "receivedAt");
CREATE INDEX "LeadCallback_salesManagerId_status_scheduledFor_idx" ON "LeadCallback"("salesManagerId", "status", "scheduledFor");
CREATE INDEX "LeadCallback_leadId_createdAt_idx" ON "LeadCallback"("leadId", "createdAt");
CREATE UNIQUE INDEX "LeadCallback_one_scheduled_per_lead_idx" ON "LeadCallback"("leadId") WHERE "status" = 'SCHEDULED';
CREATE UNIQUE INDEX "LeadExpertCall_meetingId_key" ON "LeadExpertCall"("meetingId");
CREATE INDEX "LeadExpertCall_expertUserId_status_startTime_idx" ON "LeadExpertCall"("expertUserId", "status", "startTime");
CREATE INDEX "LeadExpertCall_salesManagerId_status_startTime_idx" ON "LeadExpertCall"("salesManagerId", "status", "startTime");
CREATE INDEX "LeadExpertCall_leadId_createdAt_idx" ON "LeadExpertCall"("leadId", "createdAt");
CREATE UNIQUE INDEX "LeadExpertCall_one_active_per_lead_idx" ON "LeadExpertCall"("leadId") WHERE "status" IN ('REQUESTED', 'CONFIRMED');
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");
CREATE INDEX "LeadActivity_actorUserId_createdAt_idx" ON "LeadActivity"("actorUserId", "createdAt");
CREATE INDEX "Lead_status_assignedSalesManagerId_createdAt_idx" ON "Lead"("status", "assignedSalesManagerId", "createdAt");
CREATE INDEX "Lead_phone_number_idx" ON "Lead"("phone_number");
CREATE INDEX "Lead_originSourceId_createdAt_idx" ON "Lead"("originSourceId", "createdAt");
CREATE INDEX "NotificationLog_userId_channel_readAt_createdAt_idx" ON "NotificationLog"("userId", "channel", "readAt", "createdAt");
CREATE INDEX "NotificationLog_status_scheduledFor_idx" ON "NotificationLog"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadCallback" ADD CONSTRAINT "LeadCallback_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadCallback" ADD CONSTRAINT "LeadCallback_salesManagerId_fkey" FOREIGN KEY ("salesManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadExpertCall" ADD CONSTRAINT "LeadExpertCall_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadExpertCall" ADD CONSTRAINT "LeadExpertCall_salesManagerId_fkey" FOREIGN KEY ("salesManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadExpertCall" ADD CONSTRAINT "LeadExpertCall_expertUserId_fkey" FOREIGN KEY ("expertUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadExpertCall" ADD CONSTRAINT "LeadExpertCall_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
