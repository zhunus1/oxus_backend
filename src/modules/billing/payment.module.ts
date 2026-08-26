import { Module } from "@nestjs/common";
import { FreedomPayService } from "./service/freedompay.service";
import { PaymentService } from "./service/payment.service";
import { TransactionRepository } from "./repository/payment.repository";
import { PaymentController } from "./api/payment.controller";
import { PrismaModule } from "src/database/prisma.module";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule } from "@nestjs/config";
import { ContractModule } from "../contract/contract.module";
import { UserJourneyModule } from "src/modules/user-journey/user-journey.module";

@Module({
  imports: [PrismaModule, JwtModule, ConfigModule, ContractModule, UserJourneyModule],
  exports: [PaymentService],
  controllers: [PaymentController],
  providers: [FreedomPayService, PaymentService, TransactionRepository],
})
export class PaymentModule {}
