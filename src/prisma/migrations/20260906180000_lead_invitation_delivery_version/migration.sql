-- Keep existing invitations and queued jobs compatible with delivery generation 1.
ALTER TABLE "LeadStudentInvitation"
ADD COLUMN "deliveryVersion" INTEGER NOT NULL DEFAULT 1;
