import { Prisma } from "generated/prisma/client";

// A shared PostgreSQL transaction lock keeps Consultation and LeadExpertCall
// reservations for the same expert from being created concurrently.
const EXPERT_BOOKING_LOCK_NAMESPACE = 1_331_197_267;

export async function lockExpertBookings(tx: Prisma.TransactionClient, expertUserId: number): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      CAST(${EXPERT_BOOKING_LOCK_NAMESPACE} AS integer),
      CAST(${expertUserId} AS integer)
    )
  `;
}
