import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CreateTransactionDto } from "../api/dtos/create-payment.dto";
import { PrismaService } from "src/database/prisma.service";
import { Prisma, SubscriptionTier, Transaction } from "generated/prisma/client";
import { leadTransaction } from "src/modules/lead/domain/lead-transaction";
import { TIER_SLOTS } from "src/modules/studentportrait/domain/contract-benefits";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";
import type { VerifiedFreedomPayment } from "../domain/freedom-signature";

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

  /** Receipt, subscription, package, contract and journey commit together or all roll back. */
  async settleFreedomPayment(receipt: VerifiedFreedomPayment): Promise<void> {
    await leadTransaction(this.prisma, async tx => {
      // Serialize the provider reference as well as the order: one payment cannot fund two orders.
      const paymentKey = `freedompay:${receipt.merchantId}:${receipt.paymentId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentKey}, 0))::text`;
      await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${receipt.orderId} FOR UPDATE`;
      const transaction = await tx.transaction.findUnique({ where: { id: receipt.orderId }, include: { user: { select: { deletedAt: true, role: { select: { code: true } } } } } });
      if (!transaction) throw new NotFoundException("Payment order not found");
      if (!new Prisma.Decimal(receipt.amount).isPositive() || !new Prisma.Decimal(transaction.amount).equals(receipt.amount) || transaction.currency !== receipt.currency)
        throw new BadRequestException("Payment amount or currency does not match the order");
      if (transaction.providerRef && transaction.providerRef !== receipt.paymentId) throw new ConflictException("Order has another provider payment");
      if (await tx.transaction.findFirst({ where: { providerRef: receipt.paymentId, id: { not: transaction.id } }, select: { id: true } }))
        throw new ConflictException("Provider payment already belongs to another order");
      // Historical SUCCESS rows are never granted again: their prior side effects may be incomplete.
      if (transaction.status === "SUCCESS") {
        if (!transaction.providerRef) await tx.transaction.update({ where: { id: transaction.id }, data: { providerRef: receipt.paymentId } });
        return;
      }
      if (!["PENDING", "FAILED"].includes(transaction.status)) throw new ConflictException("Order is not awaiting payment");
      if (transaction.user.deletedAt || !["STUDENT", "SCHOOLBOY"].includes(transaction.user.role.code)) throw new ConflictException("Student account is unavailable");
      const manual = await tx.contract.findFirst({
        where: { studentId: transaction.userId, OR: [{ paymentType: { not: null } }, { manualConfirmedAt: { not: null } }] },
        select: { id: true },
      });
      if (!manual) {
        const signed = await tx.contract.findFirst({ where: { studentId: transaction.userId, status: { in: ["SIGNED", "PAID"] } }, select: { id: true } });
        if (!signed) throw new ConflictException("No signed contract for this payment");
        const portrait = await tx.studentPortrait.update({
          where: { userId: transaction.userId },
          data: { subscription: transaction.subscriptionTier, ...(transaction.subscriptionTier === SubscriptionTier.EXPERT_MENTORSHIP ? { consultationBalance: 8 } : {}) },
        });
        const totalSlots = TIER_SLOTS[transaction.subscriptionTier];
        if (!totalSlots) throw new ConflictException("Unsupported subscription tier");
        if (portrait.consultantProfileId)
          await tx.studentPackage.upsert({
            where: { studentId_expertId: { studentId: transaction.userId, expertId: portrait.consultantProfileId } },
            create: { studentId: transaction.userId, expertId: portrait.consultantProfileId, totalSlots },
            update: { totalSlots: { increment: totalSlots } },
          });
        await tx.contract.updateMany({
          where: { studentId: transaction.userId, status: "SIGNED", manualConfirmedAt: null, paymentType: null },
          data: { status: "PAID", paidAt: new Date() },
        });
        await tx.userJourneyEvent.create({
          data: {
            userId: transaction.userId,
            eventType: USER_JOURNEY_EVENT.PAYMENT_COMPLETED,
            eventData: { transactionId: transaction.id, subscriptionTier: transaction.subscriptionTier, amount: transaction.amount },
          },
        });
      }
      // In-flight manual receipts remain gateway ledger entries for reconciliation, without benefits.
      await tx.transaction.update({ where: { id: transaction.id }, data: { status: "SUCCESS", providerRef: receipt.paymentId } });
    });
  }
}
