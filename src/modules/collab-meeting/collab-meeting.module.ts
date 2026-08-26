import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "src/database/prisma.module";
import { CollabMeetingController } from "./api/collab-meeting.controller";
import { CollabMeetingService } from "./service/collab-meeting.service";
import { CollabMeetingRepository } from "./repository/collab-meeting.repository";

@Module({
  imports: [ConfigModule, JwtModule, PrismaModule, BullModule.registerQueue({ name: "mail" })],
  controllers: [CollabMeetingController],
  providers: [CollabMeetingService, CollabMeetingRepository],
})
export class CollabMeetingModule {}
