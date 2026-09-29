import type { Prisma } from "generated/prisma/client";
import type { UserJourneyEventType } from "src/modules/user-journey/user-journey.constants";

/** First-occurrence milestones only, inside the caller's Serializable contract transaction. */
export async function contractJourneyMilestone(tx: Prisma.TransactionClient, userId: number, eventType: UserJourneyEventType, occurredAt: Date, eventData: Prisma.InputJsonObject) {
  // Historical online signatures/payments may already have recorded this milestone.
  if (await tx.userJourneyEvent.findFirst({ where: { userId, eventType }, select: { id: true } })) return;
  await tx.userJourneyEvent.create({ data: { userId, eventType, occurredAt, eventData } });
}
