import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { ResponseService } from "./service/response.service";
import { ResponseRepository } from "./repository/response.repository";
import { ResponseController } from "./api/response.controller";
import { QuestionModule } from "../question/question.module";
import { AttemptModule } from "../attempt/attempt.module";

@Module({
  imports: [PrismaModule, QuestionModule, AttemptModule],
  controllers: [ResponseController],
  providers: [ResponseService, ResponseRepository],
})
export class ResponseModule {}
