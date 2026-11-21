-- Internal provider identity state; existing users and business tables are unchanged.
CREATE TABLE "WazzupAccess" (
    "userId" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "revocationPending" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "WazzupAccess_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "WazzupAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
