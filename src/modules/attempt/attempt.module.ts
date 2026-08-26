import { Module } from "@nestjs/common";
import { AttemptService } from "./service/attempt.service";
import { AttemptRepository } from "./repository/attempt.repository";
import { PrismaModule } from "src/database/prisma.module";
import { AttemptController } from "./api/attempt.controller";
import { QuestionModule } from "src/modules/question/question.module";
import { ResponseRepository } from "src/modules/response/repository/response.repository";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { EventModule } from "src/modules/event/event.module";
import { StudentPortraitModule } from "src/modules/studentportrait/studentportrait.module";

@Module({
  imports: [PrismaModule, QuestionModule, EventModule, StudentPortraitModule],
  controllers: [AttemptController],
  providers: [AttemptService, AttemptRepository, ResponseRepository, JwtService, ConfigService],
  exports: [AttemptService],
})
export class AttemptModule {}
