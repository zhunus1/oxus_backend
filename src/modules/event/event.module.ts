import { Module } from "@nestjs/common";
import { EventController } from "./api/event.controller";
import { EventService } from "./service/event.service";
import { EventRepository } from "./repository/event.repository";
import { PrismaModule } from "src/database/prisma.module";
import { TestModule } from "../test/test.module";
import { QuestionModule } from "../question/question.module";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { StudentPortraitModule } from "../studentportrait/studentportrait.module";

@Module({
  imports: [PrismaModule, TestModule, QuestionModule, ConfigModule, JwtModule, StudentPortraitModule],
  controllers: [EventController],
  providers: [EventService, EventRepository],
  exports: [EventService],
})
export class EventModule {}
