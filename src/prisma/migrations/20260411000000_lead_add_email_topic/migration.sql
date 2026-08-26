-- AlterTable: Add email and topic columns to Lead
ALTER TABLE "Lead" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Lead" ADD COLUMN "topic" TEXT NOT NULL DEFAULT '';
