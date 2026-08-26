import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { TargetProgramService } from "./service/target-program.service";
import { TargetProgramRepository } from "./repository/target-program.repository";
import { TargetProgramController } from "./api/target-program.controller";
import { StudentPortraitModule } from "../studentportrait/studentportrait.module";
import { JwtModule } from "@nestjs/jwt";

import { UserJourneyModule } from "src/modules/user-journey/user-journey.module";

@Module({
  imports: [PrismaModule, StudentPortraitModule, JwtModule, UserJourneyModule],
  providers: [TargetProgramService, TargetProgramRepository],
  exports: [TargetProgramService],
  controllers: [TargetProgramController],
})
export class TargetProgramModule {}
