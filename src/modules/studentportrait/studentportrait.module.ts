import { Module } from "@nestjs/common";
import { StudentPortraitController } from "./api/studentportrait.controller";
import { StudentPortraitService } from "./service/studentportrait.service";
import { StudentPortraitRepository } from "./repository/studentportrait.repository";
import { PrismaService } from "src/database/prisma.service";
import { JwtModule } from "@nestjs/jwt";
import { UserJourneyModule } from "src/modules/user-journey/user-journey.module";

@Module({
  imports: [JwtModule, UserJourneyModule],
  controllers: [StudentPortraitController],
  providers: [StudentPortraitService, StudentPortraitRepository, PrismaService],
  exports: [StudentPortraitService],
})
export class StudentPortraitModule {}
