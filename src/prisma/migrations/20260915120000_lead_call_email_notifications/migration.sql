ALTER TABLE "NotificationLog"
    ADD COLUMN "deliveryKey" TEXT,
    ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "deliveryLeaseUntil" TIMESTAMP(3),
    ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "NotificationLog_deliveryKey_key" ON "NotificationLog"("deliveryKey");
