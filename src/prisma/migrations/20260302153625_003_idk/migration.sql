/*
  Warnings:

  - The values [LIKERT] on the enum `QuestionType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `valueOption` on the `Response` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "QuestionType_new" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'NUMERIC', 'TEXT', 'DATE', 'PHONE');
ALTER TABLE "public"."Question" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Question" ALTER COLUMN "type" TYPE "QuestionType_new" USING ("type"::text::"QuestionType_new");
ALTER TYPE "QuestionType" RENAME TO "QuestionType_old";
ALTER TYPE "QuestionType_new" RENAME TO "QuestionType";
DROP TYPE "public"."QuestionType_old";
ALTER TABLE "Question" ALTER COLUMN "type" SET DEFAULT 'SINGLE_CHOICE';
COMMIT;

-- DropForeignKey
ALTER TABLE "Response" DROP CONSTRAINT "Response_valueOption_fkey";

-- AlterTable
ALTER TABLE "Response" DROP COLUMN "valueOption",
ADD COLUMN     "valueOptionId" INTEGER;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_valueOptionId_fkey" FOREIGN KEY ("valueOptionId") REFERENCES "QuestionOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
