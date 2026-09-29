import { ContractScanService } from "./service/contract-scan.service";
import { ContractScanController } from "./api/contract-scan.controller";
import { ManualContractService } from "./service/manual-contract.service";
import { ManualContractController } from "./api/manual-contract.controller";
import { BullModule } from "@nestjs/bullmq";
import { CONTRACT_NOTIFICATION_QUEUE, ContractNotificationService, ContractNotificationProcessor } from "./service/contract-notification.service";
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
  imports: [
    BullModule.registerQueue({ name: CONTRACT_NOTIFICATION_QUEUE }),
    PrismaModule,
    LeadRealtimeModule,
    JwtModule,
    ConfigModule,
    MailModule,
    StudentPortraitModule,
    UserJourneyModule,
  ],
  providers: [ContractScanService, ManualContractService, ContractNotificationService, ContractNotificationProcessor, ContractRepository, ContractService, OtpService, PdfService],
  controllers: [ContractScanController, ManualContractController, ContractController, ExpertContractController],
  exports: [ContractService],
})
export class ContractModule {}
