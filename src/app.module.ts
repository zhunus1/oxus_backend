import { Module } from "@nestjs/common";
import { PrismaModule } from "./database/prisma.module";
import { ValidatorsModule } from "./common/validators/validators.module";
import { PrometheusModule } from "@willsoto/nestjs-prometheus";
import { MetricsModule } from "./common/utils/metrics/metrics.module";
import { HealthModule } from "./common/utils/health/health.module";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { OrganisationModule } from "./modules/organisation/organisation.module";
import { AdminModule } from "./modules/admin/admin.module";
import { MailModule } from "./modules/mail/mail.module";
import { ConsultationModule } from "./modules/consultation/consultation.module";
import { MeetingModule } from "./modules/meeting/meeting.module";
import { TestModule } from "./modules/test/test.module";
import { QuestionModule } from "./modules/question/question.module";
import { AttemptModule } from "./modules/attempt/attempt.module";
import { ResponseModule } from "./modules/response/response.module";
import { EventModule } from "./modules/event/event.module";
import { PromocodeModule } from "./modules/promocode/promocode.module";
import { RecommendationModule } from "./modules/recommendation/recommendation.module";
import { PaymentModule } from "./modules/billing/payment.module";
import { StudentPortraitModule } from "./modules/studentportrait/studentportrait.module";
import { CountryModule } from "./modules/country/country.module";
import { LanguageModule } from "./modules/language/language.module";
import { AuditLogModule } from "./modules/audit-log/audit-log.module";
import { ExpertDashboardModule } from "./modules/expert-dashboard/expert-dashboard.module";
import { TargetProgramModule } from "./modules/target-program/target-program.module";
import { DocumentModule } from "./modules/document/document.module";
import { RoadmapModule } from "./modules/roadmap/roadmap.module";
import { ExpertCatalogModule } from "./modules/expert-catalog/expert-catalog.module";
import { ExpertScheduleModule } from "./modules/expert-schedule/expert-schedule.module";
import { ProgramRequirementModule } from "./modules/program-requirement/program-requirement.module";
import { ProgramModule } from "./modules/program/program.module";
import { OrganisationImportModule } from "./modules/organisation-import/organisation-import.module";
import { QsImportModule } from "./modules/qs-import/qs-import.module";
import { OrganisationRequestModule } from "./modules/organisation-request/organisation-request.module";
import { LeadModule } from "./modules/lead/lead.module";
import { ContractModule } from "./modules/contract/contract.module";
import { AccountModule } from "./modules/account/account.module";
import { TaskModule } from "./modules/task/task.module";
import { CollabMeetingModule } from "./modules/collab-meeting/collab-meeting.module";

@Module({
  imports: [
    ConfigModule.forRoot(),
    PrismaModule,
    PrometheusModule.register({
      defaultLabels: {
        app: "AcademicApply App",
      },
      path: "/metrics",
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.get<string>("REDIS_URL"),
        },
      }),
      inject: [ConfigService],
    }),

    HealthModule,
    ValidatorsModule,
    MetricsModule,
    OrganisationModule,
    AdminModule,
    MailModule,
    ConsultationModule,
    EventModule,
    PromocodeModule,
    MeetingModule,

    TestModule,
    QuestionModule,
    AttemptModule,
    ResponseModule,
    RecommendationModule,
    PaymentModule,
    StudentPortraitModule,
    CountryModule,
    LanguageModule,
    AuditLogModule,
    ExpertDashboardModule,
    TargetProgramModule,
    DocumentModule,
    RoadmapModule,
    ExpertCatalogModule,
    ExpertScheduleModule,
    ProgramRequirementModule,
    ProgramModule,
    OrganisationImportModule,
    QsImportModule,
    OrganisationRequestModule,
    LeadModule,
    ContractModule,
    AccountModule,
    TaskModule,
    CollabMeetingModule,
  ],
})
export class AppModule {}
