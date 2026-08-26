-- User journey events for admin analytics
CREATE TABLE "UserJourneyEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserJourneyEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserJourneyEvent_userId_createdAt_idx" ON "UserJourneyEvent"("userId", "createdAt");
CREATE INDEX "UserJourneyEvent_createdAt_idx" ON "UserJourneyEvent"("createdAt");
CREATE INDEX "UserJourneyEvent_eventType_idx" ON "UserJourneyEvent"("eventType");

ALTER TABLE "UserJourneyEvent" ADD CONSTRAINT "UserJourneyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
