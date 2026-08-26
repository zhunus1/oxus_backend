-- CreateTable
CREATE TABLE "ExpertSchedule" (
    "id" SERIAL NOT NULL,
    "expertId" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpertSchedule_expertId_dayOfWeek_startMinute_key" ON "ExpertSchedule"("expertId", "dayOfWeek", "startMinute");

-- CreateIndex
CREATE UNIQUE INDEX "ExpertSchedule_expertId_dayOfWeek_endMinute_key" ON "ExpertSchedule"("expertId", "dayOfWeek", "endMinute");

-- CreateIndex
CREATE UNIQUE INDEX "ExpertSchedule_expertId_dayOfWeek_key" ON "ExpertSchedule"("expertId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "ExpertSchedule" ADD CONSTRAINT "ExpertSchedule_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
