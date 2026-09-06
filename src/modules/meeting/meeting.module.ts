import { Module } from "@nestjs/common";
import { MeetingController } from "./api/meeting.controller";
import { ConfigModule } from "@nestjs/config";
import { JitsiService } from "./service/jitsi.service";
import { JwtModule } from "@nestjs/jwt";
import { MeetingRepository } from "./repository/meeting.repository";
import { PrismaModule } from "src/database/prisma.module";
import { ConsultationModule } from "../consultation/consultation.module";
import { UserJourneyModule } from "src/modules/user-journey/user-journey.module";

/** Provides meeting workflows and the shared Jitsi token signer. */
@Module({
  exports: [JitsiService],
  controllers: [MeetingController],
  providers: [JitsiService, MeetingRepository],
  imports: [ConfigModule, JwtModule, PrismaModule, ConsultationModule, UserJourneyModule],
})
export class MeetingModule {}
