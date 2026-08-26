-- CreateTable
CREATE TABLE "Lead" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "interests" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "preferredLanguage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
