/*
  Warnings:

  - Changed the type of `degreeLevel` on the `Program` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "DegreeLevel" AS ENUM ('BACHELOR', 'MASTER', 'PHD');

-- AlterTable
ALTER TABLE "Program" DROP COLUMN "degreeLevel",
ADD COLUMN     "degreeLevel" "DegreeLevel" NOT NULL;

-- CreateIndex
CREATE INDEX "Program_degreeLevel_idx" ON "Program"("degreeLevel");
