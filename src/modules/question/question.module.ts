import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { QuestionService } from "./service/question.service";
import { QuestionRepository } from "./repository/question.repository";
import { QuestionController } from "./api/question.controller";

@Module({
  imports: [PrismaModule],
  providers: [QuestionService, QuestionRepository],
  exports: [QuestionService],
  controllers: [QuestionController],
})
export class QuestionModule {}
