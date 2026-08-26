import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConsultationController } from "./api/consultation.controller";
import { ConsultationService } from "./service/consultation.service";
import { ConsultationRepository } from "./repository/consultation.repository";
import { MailModule } from "../mail/mail.module";
import { PrismaModule } from "src/database/prisma.module";
import { JwtModule } from "@nestjs/jwt";
import { ExpertMeetingsController } from "./api/expert-meetings.controller";
import { StudentMeetingsController } from "./api/student-meetings.controller";

import { UserJourneyModule } from "src/modules/user-journey/user-journey.module";
import { SmsModule } from "src/modules/sms/sms.module";

@Module({
  imports: [
    MailModule,
    SmsModule,
    BullModule.registerQueue({
      name: "mail",
    }),
    PrismaModule,
    JwtModule,
    UserJourneyModule,
  ],
  controllers: [ConsultationController, ExpertMeetingsController, StudentMeetingsController],
  providers: [ConsultationService, ConsultationRepository],
  exports: [ConsultationService],
})
export class ConsultationModule {}
