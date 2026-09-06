import { LeadStudentInvitationService, LeadStudentInvitationProcessor } from "./service/lead-student-invitation.service";
import { LeadGuestMeetingService } from "./service/lead-guest-meeting.service";
import { LeadContractService } from "./service/lead-contract.service";
import { ExpertLeadService } from "./service/expert-lead.service";
import { LeadAvailabilityService } from "./service/lead-availability.service";
import { ManualLeadV2Service } from "./service/manual-lead-v2.service";
import { CalculatorQuestionnaireService } from "./service/calculator-questionnaire.service";
import { PublicLeadAccessController } from "./api/public-lead-access.controller";
import { ExpertLeadController } from "./api/expert-lead.controller";
import { SalesV2Controller } from "./api/sales-v2.controller";
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
import { LeadRealtimeModule } from "./realtime/lead-realtime.module";
import { MeetingModule } from "../meeting/meeting.module";
import { MailModule } from "../mail/mail.module";
import { ConfigModule } from "@nestjs/config";
import { LeadNotificationService } from "./service/lead-notification.service";
import { LeadNotificationProcessor } from "./service/lead-notification.processor";

/** Registers lead ingestion, Sales and Expert workflows, and durable notification workers. */
@Module({
  imports: [
    PrismaModule,
    LeadRealtimeModule,
    MeetingModule,
    MailModule,
    ConfigModule,
    BullModule.registerQueue({ name: "lead-invitations" }),
    JwtModule,
    BullModule.registerQueue({ name: "lead-notifications" }),
    ThrottlerModule.forRoot([{ name: "public-lead-submission", ttl: 60_000, limit: 30 }]),
  ],
  controllers: [
    SalesV2Controller,
    ExpertLeadController,
    PublicLeadAccessController,
    LeadController,
    PublicLeadController,
    SalesLeadController,
    ExpertLeadCallController,
    NotificationController,
  ],
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
    CalculatorQuestionnaireService,
    ManualLeadV2Service,
    LeadAvailabilityService,
    ExpertLeadService,
    LeadContractService,
    LeadGuestMeetingService,
    LeadStudentInvitationService,
    LeadStudentInvitationProcessor,
    LeadNotificationService,
    LeadNotificationProcessor,
  ],
})
export class LeadModule {}
