-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "fileKey" TEXT;

-- CreateIndex
CREATE INDEX "Document_studentPortraitId_deletedAt_updatedAt_idx" ON "Document"("studentPortraitId", "deletedAt", "updatedAt");
