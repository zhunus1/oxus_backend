import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { LeadController } from "./api/lead.controller";
import { LeadService } from "./service/lead.service";
import { LeadRepository } from "./repository/lead.repository";
import { JwtModule } from "@nestjs/jwt";
import { BullModule } from "@nestjs/bullmq";
import { ThrottlerModule } from "@nestjs/throttler";
import { PublicLeadController } from "./api/public-lead.controller";
import { SalesLeadController } from "./api/sales-lead.controller";
import { ExpertLeadCallController } from "./api/expert-lead-call.controller";
import { NotificationController } from "./api/notification.controller";
import { LeadIngestionRepository } from "./repository/lead-ingestion.repository";
import { SalesLeadRepository } from "./repository/sales-lead.repository";
import { LeadIngestionService } from "./service/lead-ingestion.service";
import { LandingCalculatorAdapter } from "./service/landing-calculator.adapter";
import { OfficeManualAdapter } from "./service/office-manual.adapter";
import { LegacyContactFormAdapter } from "./service/legacy-contact-form.adapter";
import { SalesLeadService } from "./service/sales-lead.service";
import { LeadExpertCallService } from "./service/lead-expert-call.service";
import { LeadRealtimeGateway } from "./realtime/lead-realtime.gateway";
import { LeadNotificationService } from "./service/lead-notification.service";
import { LeadNotificationProcessor } from "./service/lead-notification.processor";

@Module({
  imports: [
    PrismaModule,
    JwtModule,
    BullModule.registerQueue({ name: "lead-notifications" }),
    ThrottlerModule.forRoot([{ name: "public-lead-submission", ttl: 60_000, limit: 30 }]),
  ],
  controllers: [LeadController, PublicLeadController, SalesLeadController, ExpertLeadCallController, NotificationController],
  providers: [
    LeadService,
    LeadRepository,
    LeadIngestionRepository,
    SalesLeadRepository,
    LeadIngestionService,
    LandingCalculatorAdapter,
    OfficeManualAdapter,
    LegacyContactFormAdapter,
    SalesLeadService,
    LeadExpertCallService,
    LeadRealtimeGateway,
    LeadNotificationService,
    LeadNotificationProcessor,
  ],
})
export class LeadModule {}
