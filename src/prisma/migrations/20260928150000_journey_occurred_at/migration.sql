-- Keep recording time intact. Legacy events use createdAt when occurredAt is absent.
ALTER TABLE "UserJourneyEvent" ADD COLUMN "occurredAt" TIMESTAMP(3);
CREATE INDEX "UserJourneyEvent_occurredAt_idx" ON "UserJourneyEvent"("occurredAt");
