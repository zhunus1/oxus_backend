-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "endTime" TIMESTAMP(3),
ADD COLUMN     "expertId" INTEGER,
ADD COLUMN     "packageId" INTEGER,
ADD COLUMN     "startTime" TIMESTAMP(3),
ADD COLUMN     "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN     "studentId" INTEGER,
ALTER COLUMN "consultationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StudentPackage" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "expertId" INTEGER NOT NULL,
    "totalSlots" INTEGER NOT NULL,
    "usedSlots" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentPackage_studentId_idx" ON "StudentPackage"("studentId");

-- CreateIndex
CREATE INDEX "StudentPackage_expertId_idx" ON "StudentPackage"("expertId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentPackage_studentId_expertId_key" ON "StudentPackage"("studentId", "expertId");

-- CreateIndex
CREATE INDEX "Meeting_studentId_idx" ON "Meeting"("studentId");

-- CreateIndex
CREATE INDEX "Meeting_expertId_idx" ON "Meeting"("expertId");

-- CreateIndex
CREATE INDEX "Meeting_packageId_idx" ON "Meeting"("packageId");

-- CreateIndex
CREATE INDEX "Meeting_startTime_endTime_idx" ON "Meeting"("startTime", "endTime");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "ConsultantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "StudentPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPackage" ADD CONSTRAINT "StudentPackage_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPackage" ADD CONSTRAINT "StudentPackage_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "ConsultantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
