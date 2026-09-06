import { LeadRealtimeModule } from "../lead/realtime/lead-realtime.module";
import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule } from "@nestjs/config";
import { MailModule } from "../mail/mail.module";
import { StudentPortraitModule } from "../studentportrait/studentportrait.module";
import { ContractRepository } from "./repository/contract.repository";
import { ContractService } from "./service/contract.service";
import { OtpService } from "./service/otp.service";
import { PdfService } from "./service/pdf.service";
import { ContractController } from "./api/contract.controller";
import { ExpertContractController } from "./api/expert-contract.controller";

import { UserJourneyModule } from "src/modules/user-journey/user-journey.module";

/** Connects contract signing with student benefits and lead lifecycle notifications. */
@Module({
  imports: [PrismaModule, LeadRealtimeModule, JwtModule, ConfigModule, MailModule, StudentPortraitModule, UserJourneyModule],
  providers: [ContractRepository, ContractService, OtpService, PdfService],
  controllers: [ContractController, ExpertContractController],
  exports: [ContractService],
})
export class ContractModule {}
