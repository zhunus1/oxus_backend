-- CreateEnum
CREATE TYPE "ContractPaymentType" AS ENUM ('FULL', 'INSTALLMENT');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "installmentCount" INTEGER,
ADD COLUMN     "manualConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "partyDetails" JSONB,
ADD COLUMN     "paymentType" "ContractPaymentType",
ADD COLUMN     "scanFileKey" TEXT;

-- CreateTable
CREATE TABLE "LeadContractDraft" (
    "leadId" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadContractDraft_pkey" PRIMARY KEY ("leadId")
);

-- CreateTable
CREATE TABLE "ContractInstallment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "paidAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" INTEGER,

    CONSTRAINT "ContractInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractInstallment_paidAt_dueDate_idx" ON "ContractInstallment"("paidAt", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ContractInstallment_contractId_number_key" ON "ContractInstallment"("contractId", "number");

-- AddForeignKey
ALTER TABLE "LeadContractDraft" ADD CONSTRAINT "LeadContractDraft_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractInstallment" ADD CONSTRAINT "ContractInstallment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractInstallment" ADD CONSTRAINT "ContractInstallment_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
