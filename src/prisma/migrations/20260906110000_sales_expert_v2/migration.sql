-- CreateEnum
CREATE TYPE "LeadMeetingFormat" AS ENUM ('ONLINE', 'OFFICE');

-- CreateEnum
CREATE TYPE "LeadCallbackReason" AS ENUM ('NO_ANSWER', 'RESCHEDULED', 'FOLLOW_UP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadStatus" ADD VALUE 'OFFICE_INVITED';
ALTER TYPE "LeadStatus" ADD VALUE 'CONTRACT_PENDING';
ALTER TYPE "LeadStatus" ADD VALUE 'CONVERTED';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "assignedExpertUserId" INTEGER,
ADD COLUMN     "callbackReason" "LeadCallbackReason",
ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "expertQuestionnaire" JSONB,
ADD COLUMN     "expertStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LeadCallback" ADD COLUMN     "reason" "LeadCallbackReason";

-- AlterTable
ALTER TABLE "LeadExpertCall" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "format" "LeadMeetingFormat" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "invitationId" TEXT,
ADD COLUMN     "officeAddress" TEXT,
ADD COLUMN     "officeCode" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "questionnaire" JSONB;

-- CreateTable
CREATE TABLE "LeadMeetingInvitation" (
    "id" TEXT NOT NULL,
    "leadId" INTEGER NOT NULL,
    "salesManagerId" INTEGER NOT NULL,
    "roomName" TEXT NOT NULL,
    "booking" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadMeetingInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadStudentInvitation" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadStudentInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadMeetingInvitation_roomName_key" ON "LeadMeetingInvitation"("roomName");

-- CreateIndex
CREATE INDEX "LeadMeetingInvitation_leadId_createdAt_idx" ON "LeadMeetingInvitation"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadMeetingInvitation_expiresAt_idx" ON "LeadMeetingInvitation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadStudentInvitation_userId_key" ON "LeadStudentInvitation"("userId");

-- CreateIndex
CREATE INDEX "LeadStudentInvitation_sentAt_expiresAt_idx" ON "LeadStudentInvitation"("sentAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_contractId_key" ON "Lead"("contractId");

-- CreateIndex
CREATE INDEX "Lead_assignedExpertUserId_status_createdAt_idx" ON "Lead"("assignedExpertUserId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadExpertCall_invitationId_key" ON "LeadExpertCall"("invitationId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedExpertUserId_fkey" FOREIGN KEY ("assignedExpertUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadExpertCall" ADD CONSTRAINT "LeadExpertCall_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "LeadMeetingInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMeetingInvitation" ADD CONSTRAINT "LeadMeetingInvitation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMeetingInvitation" ADD CONSTRAINT "LeadMeetingInvitation_salesManagerId_fkey" FOREIGN KEY ("salesManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStudentInvitation" ADD CONSTRAINT "LeadStudentInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the existing expert relationship when exposing old CRM calls in the new UI.
UPDATE "Lead" AS lead
SET "assignedExpertUserId" = latest."expertUserId"
FROM (
  SELECT DISTINCT ON ("leadId") "leadId", "expertUserId"
  FROM "LeadExpertCall"
  ORDER BY "leadId", "createdAt" DESC, "id" DESC
) AS latest
WHERE lead."id" = latest."leadId" AND lead."assignedExpertUserId" IS NULL;

ALTER TABLE "LeadExpertCall" ADD CONSTRAINT "LeadExpertCall_office_check"
CHECK (("format" = 'ONLINE' AND "officeCode" IS NULL AND "officeAddress" IS NULL)
  OR ("format" = 'OFFICE' AND "officeCode" IN ('almaty', 'shymkent') AND "officeAddress" IS NOT NULL));
