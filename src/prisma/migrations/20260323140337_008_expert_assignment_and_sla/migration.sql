/*
  Warnings:

  - Added the required column `updatedAt` to the `TargetProgram` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "StudentPortrait" ADD COLUMN     "consultantProfileId" INTEGER;

-- AlterTable
ALTER TABLE "TargetProgram" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AddForeignKey
ALTER TABLE "StudentPortrait" ADD CONSTRAINT "StudentPortrait_consultantProfileId_fkey" FOREIGN KEY ("consultantProfileId") REFERENCES "ConsultantProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
