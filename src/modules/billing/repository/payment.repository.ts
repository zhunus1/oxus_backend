import { Injectable } from "@nestjs/common";
import { CreateTransactionDto } from "../api/dtos/create-payment.dto";
import { PrismaService } from "src/database/prisma.service";
import { SubscriptionTier, Transaction } from "generated/prisma/client";
import { UpdateTransactionDto } from "../api/dtos/update-payment.dto";

const TIER_SLOTS: Partial<Record<SubscriptionTier, number>> = {
  [SubscriptionTier.AI_ROADMAP]: 3,
  [SubscriptionTier.EXPERT_MENTORSHIP]: 10,
};

@Injectable()
export class TransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateTransactionDto): Promise<Transaction> {
    return this.prisma.transaction.create({
      data: {
        user: { connect: { id: data.userId } },
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        subscriptionTier: data.subscriptionTier,
        ...(data.promoCodeId && { promoCode: { connect: { id: data.promoCodeId } } }),
      },
    });
  }

  async findOne(id: string): Promise<Transaction | null> {
    return this.prisma.transaction.findUnique({
      where: { id },
    });
  }

  async updateById(id: string, data: UpdateTransactionDto): Promise<Transaction> {
    return this.prisma.transaction.update({
      where: { id },
      data: {
        ...(data.status && { status: data.status }),
        ...(data.providerRef && { providerRef: data.providerRef }),
      },
    });
  }

  async upgradeSubscription(userId: number, tier: SubscriptionTier, consultationBalance?: number) {
    return this.prisma.studentPortrait.update({
      where: { userId },
      data: {
        subscription: tier,
        ...(consultationBalance !== undefined && { consultationBalance }),
      },
    });
  }

  async createPackageForSubscription(userId: number, tier: SubscriptionTier): Promise<void> {
    const totalSlots = TIER_SLOTS[tier];
    if (!totalSlots) return;

    const portrait = await this.prisma.studentPortrait.findUnique({
      where: { userId },
      select: { consultantProfileId: true },
    });

    if (!portrait?.consultantProfileId) return;

    await this.prisma.studentPackage.upsert({
      where: {
        studentId_expertId: {
          studentId: userId,
          expertId: portrait.consultantProfileId,
        },
      },
      create: {
        studentId: userId,
        expertId: portrait.consultantProfileId,
        totalSlots,
      },
      update: { totalSlots: { increment: totalSlots } },
    });
  }
}
