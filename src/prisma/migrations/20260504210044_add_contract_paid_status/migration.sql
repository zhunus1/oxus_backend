-- AlterEnum
ALTER TYPE "ContractStatus" ADD VALUE 'PAID';

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "paidAt" TIMESTAMP(3);
