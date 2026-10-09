import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { ProgramRequirementController } from "./api/program-requirement.controller";
import { ProgramRequirementService } from "./service/program-requirement.service";
import { ProgramRequirementRepository } from "./repository/program-requirement.repository";
import { JwtModule } from "@nestjs/jwt";
import { StudentDocumentAccessModule } from "src/common/authorization/student-document-access.module";

@Module({
  imports: [PrismaModule, JwtModule, StudentDocumentAccessModule],
  controllers: [ProgramRequirementController],
  providers: [ProgramRequirementService, ProgramRequirementRepository],
  exports: [ProgramRequirementService],
})
export class ProgramRequirementModule {}
