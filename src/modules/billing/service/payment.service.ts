import { BadRequestException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { TransactionRepository } from "../repository/payment.repository";
import { FreedomPayService } from "./freedompay.service";
import messages from "src/configs/messages";
import { SubscriptionTier } from "generated/prisma/client";
import { ContractService } from "src/modules/contract/service/contract.service";

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
  ) {}

  async createPayment(userId: number, subscriptionTier: SubscriptionTier) {
    try {
      if (await this.contractService.usesManualPayments(userId)) throw new BadRequestException("This contract uses expert-confirmed manual payments");
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

  async handleFreedomWebhook(data: Record<string, unknown>) {
    try {
      const receipt = await this.freedompayService.handleWebhook(data);
      await this.repo.settleFreedomPayment(receipt);
      return { status: "OK" };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error("Payment processing failed; the provider may retry");
      throw new InternalServerErrorException(messages.INTERNAL_ERROR(this.entity));
    }
  }

  freedomWebhookAcknowledgement() {
    return this.freedompayService.webhookAcknowledgement();
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
