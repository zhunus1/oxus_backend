-- Add ContractStatus enum
CREATE TYPE "ContractStatus" AS ENUM ('PENDING_STUDENT', 'PENDING_EXPERT', 'SIGNED');

-- Create Contract table
CREATE TABLE "Contract" (
    "id"               TEXT NOT NULL,
    "contractNumber"   TEXT NOT NULL,
    "studentId"        INTEGER NOT NULL,
    "signedByUserId"   INTEGER,
    "subscriptionTier" "SubscriptionTier" NOT NULL,
    "price"            DOUBLE PRECISION NOT NULL,
    "clientFullName"   TEXT,
    "studentName"      TEXT,
    "clientIin"        TEXT,
    "clientAddress"    TEXT,
    "clientPhone"      TEXT,
    "serviceStartDate" TIMESTAMP(3),
    "serviceEndDate"   TIMESTAMP(3),
    "status"           "ContractStatus" NOT NULL DEFAULT 'PENDING_STUDENT',
    "studentSignedAt"  TIMESTAMP(3),
    "expertSignedAt"   TIMESTAMP(3),
    "studentOtpHash"   TEXT,
    "studentOtpExpiry" TIMESTAMP(3),
    "expertOtpHash"    TEXT,
    "expertOtpExpiry"  TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on contractNumber
CREATE UNIQUE INDEX "Contract_contractNumber_key" ON "Contract"("contractNumber");

-- Indexes
CREATE INDEX "Contract_studentId_idx" ON "Contract"("studentId");
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- Foreign keys
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Contract" ADD CONSTRAINT "Contract_signedByUserId_fkey"
    FOREIGN KEY ("signedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
