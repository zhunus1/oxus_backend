-- CreateTable
CREATE TABLE "Program" (
    "id" SERIAL NOT NULL,
    "organisationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "degreeLevel" TEXT NOT NULL,
    "tuitionFee" DOUBLE PRECISION NOT NULL,
    "minGPA" DOUBLE PRECISION NOT NULL,
    "minIELTS" DOUBLE PRECISION,
    "applicationDeadline" TIMESTAMP(3) NOT NULL,
    "baseAcceptanceRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Program_degreeLevel_idx" ON "Program"("degreeLevel");

-- CreateIndex
CREATE INDEX "Program_organisationId_idx" ON "Program"("organisationId");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
