-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ImportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "Organisation"
ADD COLUMN IF NOT EXISTS "websiteUrl" TEXT;

-- AlterTable
ALTER TABLE "Program"
ALTER COLUMN "tuitionFee" DROP NOT NULL,
ALTER COLUMN "minGPA" DROP NOT NULL,
ALTER COLUMN "applicationDeadline" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Program_organisationId_name_degreeLevel_key" ON "Program"("organisationId", "name", "degreeLevel");

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrganisationImportJob" (
    "id" SERIAL NOT NULL,
    "organisationId" INTEGER NOT NULL,
    "initiatedByUserId" INTEGER,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "searchQuery" TEXT,
    "officialWebsiteUrl" TEXT,
    "sourceUrl" TEXT,
    "rawResult" JSONB,
    "importedProgramCount" INTEGER NOT NULL DEFAULT 0,
    "createdProgramCount" INTEGER NOT NULL DEFAULT 0,
    "updatedProgramCount" INTEGER NOT NULL DEFAULT 0,
    "errorLog" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganisationImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrganisationImportSnapshot" (
    "id" SERIAL NOT NULL,
    "importJobId" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "pageTitle" TEXT,
    "rawText" TEXT,
    "extractedData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganisationImportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrganisationImportJob_organisationId_createdAt_idx" ON "OrganisationImportJob"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrganisationImportJob_status_idx" ON "OrganisationImportJob"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrganisationImportSnapshot_importJobId_idx" ON "OrganisationImportSnapshot"("importJobId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "OrganisationImportJob" ADD CONSTRAINT "OrganisationImportJob_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "OrganisationImportJob" ADD CONSTRAINT "OrganisationImportJob_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "OrganisationImportSnapshot" ADD CONSTRAINT "OrganisationImportSnapshot_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "OrganisationImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
