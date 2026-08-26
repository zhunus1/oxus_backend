import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { TransactionRepository } from "../repository/payment.repository";
import { FreedomPayService } from "./freedompay.service";
import messages from "src/configs/messages";
import { FreedomPaymentDto } from "../api/dtos/freedom-pay.dto";
import { SubscriptionTier } from "generated/prisma/client";
import { ContractService } from "src/modules/contract/service/contract.service";
import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

const TIER_PRICING: Record<string, number> = {
  AI_ROADMAP: 49,
  EXPERT_MENTORSHIP: 499,
};

@Injectable()
export class PaymentService {
  private entity = "Transaction";
  private logger = new Logger(PaymentService.name);

  constructor(
    private repo: TransactionRepository,
    private freedompayService: FreedomPayService,
    private contractService: ContractService,
    private readonly userJourneyLog: UserJourneyLogService,
  ) {}

  async createPayment(userId: number, subscriptionTier: SubscriptionTier) {
    try {
      const amount = TIER_PRICING[subscriptionTier];
      if (!amount) {
        throw new BadRequestException(`Invalid subscription tier: ${subscriptionTier}`);
      }

      const contractSigned = await this.contractService.isFullySigned(userId);
      if (!contractSigned) {
        throw new ForbiddenException("You must sign the service agreement before purchasing a subscription.");
      }

      const transaction = await this.repo.create({
        userId,
        amount,
        currency: "USD",
        status: "PENDING",
        subscriptionTier,
      });

      const paymentIntent = await this.freedompayService.initPayment(transaction.id, amount, "USD");

      return {
        transaction,
        paymentIntent: {
          payment_url: paymentIntent.pg_redirect_url,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof InternalServerErrorException) throw error;
      this.logger.error(`Internal error for ${this.entity}: ${error}`);
      throw new InternalServerErrorException(messages.INTERNAL_ERROR(this.entity));
    }
  }

  async handleFreedomWebhook(data: FreedomPaymentDto) {
    try {
      const transactionId = data.pg_order_id;
      const externalPaymentId = data.pg_payment_id;

      await this.freedompayService.handleWebhook(data);

      if (data.pg_failure_code || data.pg_failure_description) {
        this.logger.log(`Payment failed with code ${data.pg_failure_code} and description: ${data.pg_failure_description}`);
        await this.repo.updateById(transactionId, { status: "FAILED", providerRef: externalPaymentId });
      } else {
        this.logger.log(`Successful payment with id ${transactionId}`);
        const transaction = await this.repo.updateById(transactionId, { status: "SUCCESS", providerRef: externalPaymentId });

        // Upgrade student subscription after successful payment
        try {
          const consultationBalance = transaction.subscriptionTier === SubscriptionTier.EXPERT_MENTORSHIP ? 8 : undefined;
          await this.repo.upgradeSubscription(transaction.userId, transaction.subscriptionTier, consultationBalance);
          this.logger.log(`Upgraded subscription for user ${transaction.userId} to ${transaction.subscriptionTier}`);
          await this.repo.createPackageForSubscription(transaction.userId, transaction.subscriptionTier);
          this.logger.log(`Created package for user ${transaction.userId} with tier ${transaction.subscriptionTier}`);
          void this.contractService.markStudentContractPaid(transaction.userId);
          void this.userJourneyLog.logEvent(transaction.userId, USER_JOURNEY_EVENT.PAYMENT_COMPLETED, {
            transactionId,
            subscriptionTier: transaction.subscriptionTier,
            amount: transaction.amount,
          });
        } catch (upgradeError) {
          this.logger.error(`Failed to upgrade subscription for user ${transaction.userId}: ${upgradeError}`);
        }
      }

      return { status: "OK" };
    } catch (error) {
      this.logger.error(`Internal server error while handling payment with ID ${data.pg_order_id}: ${error}`);
      throw new InternalServerErrorException(messages.INTERNAL_ERROR(this.entity));
    }
  }

  async findOne(id: string) {
    try {
      const transaction = await this.repo.findOne(id);
      if (!transaction) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID_STRING(this.entity, id));
      }
      return { status: transaction.status };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Database fetch error for ${this.entity} with id: ${id}. ERR: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id));
    }
  }
}
