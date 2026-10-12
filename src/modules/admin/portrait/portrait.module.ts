import { Module } from "@nestjs/common";
import { PortraitController } from "./api/portrait.controller";
import { PortraitService } from "./service/portrait.service";
import { PortraitRepository } from "./repository/portrait.repository";
import { PrismaService } from "src/database/prisma.service";
import { JwtModule } from "@nestjs/jwt";
import { AuditLogModule } from "src/modules/audit-log/audit-log.module";
import { TargetProgramModule } from "src/modules/target-program/target-program.module";
import { StudentDocumentAccessModule } from "src/common/authorization/student-document-access.module";

@Module({
  imports: [JwtModule, AuditLogModule, TargetProgramModule, StudentDocumentAccessModule],
  controllers: [PortraitController],
  providers: [PortraitService, PortraitRepository, PrismaService],
})
export class PortraitModule {}
