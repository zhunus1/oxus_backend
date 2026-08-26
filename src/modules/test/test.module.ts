import { Module } from "@nestjs/common";
import { TestController } from "./api/test.controller";
import { TestService } from "./service/test.service";
import { TestRepository } from "./repository/test.repository";
import { QuestionSegmentRepository } from "./repository/question-segment.repository";
import { QuestionSegmentService } from "./service/question-segment.service";
import { PrismaService } from "src/database/prisma.service";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PrismaModule } from "src/database/prisma.module";

@Module({
  exports: [TestService, QuestionSegmentService],
  controllers: [TestController],
  providers: [TestRepository, QuestionSegmentRepository, PrismaService, TestService, QuestionSegmentService, JwtService],
  imports: [JwtModule, PrismaModule],
})
export class TestModule {}
