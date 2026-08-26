-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('SOP', 'CV', 'PASSPORT', 'TRANSCRIPT', 'RECOMMENDATION_LETTER', 'PORTFOLIO', 'LANGUAGE_CERTIFICATE', 'OTHER');

-- AlterTable
ALTER TABLE "TargetProgram" ADD COLUMN     "programId" INTEGER;

-- CreateTable
CREATE TABLE "ProgramRequirement" (
    "id" SERIAL NOT NULL,
    "programId" INTEGER NOT NULL,
    "type" "RequirementType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgramRequirement_programId_sortOrder_idx" ON "ProgramRequirement"("programId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramRequirement_programId_type_title_key" ON "ProgramRequirement"("programId", "type", "title");

-- AddForeignKey
ALTER TABLE "ProgramRequirement" ADD CONSTRAINT "ProgramRequirement_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetProgram" ADD CONSTRAINT "TargetProgram_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
