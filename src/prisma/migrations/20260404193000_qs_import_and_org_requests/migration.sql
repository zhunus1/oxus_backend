-- CreateEnum
CREATE TYPE "QsImportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'COMPLETED_WITH_ERRORS');

-- CreateEnum
CREATE TYPE "OrganisationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'IMPORTING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Organisation"
ADD COLUMN "qsFocus" TEXT,
ADD COLUMN "qsImportedAt" TIMESTAMP(3),
ADD COLUMN "qsInstitutionStatus" TEXT,
ADD COLUMN "qsOverallScore" DOUBLE PRECISION,
ADD COLUMN "qsPreviousRank" INTEGER,
ADD COLUMN "qsRank" INTEGER,
ADD COLUMN "qsRankingYear" INTEGER,
ADD COLUMN "qsRegion" TEXT,
ADD COLUMN "qsResearch" TEXT,
ADD COLUMN "qsSize" TEXT;

-- CreateTable
CREATE TABLE "QsOrganisationImportJob" (
    "id" SERIAL NOT NULL,
    "initiatedByUserId" INTEGER,
    "status" "QsImportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "fileName" TEXT NOT NULL,
    "rankingYear" INTEGER,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "rawSummary" JSONB,
    "errorLog" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QsOrganisationImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationRequest" (
    "id" SERIAL NOT NULL,
    "requestedByUserId" INTEGER NOT NULL,
    "reviewedByUserId" INTEGER,
    "resolvedOrganisationId" INTEGER,
    "universityName" TEXT NOT NULL,
    "countryName" TEXT,
    "notes" TEXT,
    "status" "OrganisationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QsOrganisationImportJob_status_createdAt_idx" ON "QsOrganisationImportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrganisationRequest_status_createdAt_idx" ON "OrganisationRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrganisationRequest_requestedByUserId_idx" ON "OrganisationRequest"("requestedByUserId");

-- AddForeignKey
ALTER TABLE "QsOrganisationImportJob" ADD CONSTRAINT "QsOrganisationImportJob_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationRequest" ADD CONSTRAINT "OrganisationRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationRequest" ADD CONSTRAINT "OrganisationRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationRequest" ADD CONSTRAINT "OrganisationRequest_resolvedOrganisationId_fkey" FOREIGN KEY ("resolvedOrganisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
