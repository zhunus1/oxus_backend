import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { ProgramRequirementController } from "./api/program-requirement.controller";
import { ProgramRequirementService } from "./service/program-requirement.service";
import { ProgramRequirementRepository } from "./repository/program-requirement.repository";
import { JwtModule } from "@nestjs/jwt";

@Module({
  imports: [PrismaModule, JwtModule],
  controllers: [ProgramRequirementController],
  providers: [ProgramRequirementService, ProgramRequirementRepository],
  exports: [ProgramRequirementService],
})
export class ProgramRequirementModule {}
