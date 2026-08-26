-- AlterTable: Add new columns to Lead
ALTER TABLE "Lead" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Lead" ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Lead" ADD COLUMN "isContacted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "contactedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "contactedByUserId" INTEGER;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactedByUserId_fkey" FOREIGN KEY ("contactedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
