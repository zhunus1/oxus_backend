-- AlterTable
ALTER TABLE "CollabMeeting" ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurringGroupId" TEXT;

-- CreateIndex
CREATE INDEX "CollabMeeting_recurringGroupId_idx" ON "CollabMeeting"("recurringGroupId");
