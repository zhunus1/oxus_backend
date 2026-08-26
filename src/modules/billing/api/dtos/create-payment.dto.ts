import { SubscriptionTier } from "generated/prisma/client";

export class CreateTransactionDto {
  userId: number;
  amount: number;
  currency: string;
  status: string;
  subscriptionTier: SubscriptionTier;
  promoCodeId?: number;
}
