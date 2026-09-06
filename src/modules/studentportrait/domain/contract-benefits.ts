import { SubscriptionTier } from "generated/prisma/enums";
export const TIER_SLOTS: Partial<Record<SubscriptionTier, number>> = {
  [SubscriptionTier.AI_ROADMAP]: 3,
  [SubscriptionTier.EXPERT_MENTORSHIP]: 10,
};
