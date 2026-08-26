-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "firstName" DROP DEFAULT,
ALTER COLUMN "lastName" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "description" TEXT,
ADD COLUMN     "segmentId" INTEGER;

-- AlterTable
ALTER TABLE "QuestionOption" ADD COLUMN     "label" TEXT;

-- CreateTable
CREATE TABLE "QuestionSegment" (
    "id" SERIAL NOT NULL,
    "testId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionSegment_testId_idx" ON "QuestionSegment"("testId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSegment_testId_title_key" ON "QuestionSegment"("testId", "title");

-- AddForeignKey
ALTER TABLE "QuestionSegment" ADD CONSTRAINT "QuestionSegment_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "QuestionSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
