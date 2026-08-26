import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "src/database/prisma.service";
import { ProgramController } from "./api/program.controller";
import { ProgramService } from "./service/program.service";
import { ProgramRepository } from "./repository/program.repository";

import { PrismaModule } from "src/database/prisma.module";
import { UserJourneyModule } from "src/modules/user-journey/user-journey.module";

@Module({
  imports: [JwtModule, PrismaModule, UserJourneyModule],
  controllers: [ProgramController],
  providers: [ProgramRepository, PrismaService, ProgramService],
  exports: [ProgramService],
})
export class ProgramModule {}
