import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { ExpertDashboardService } from "./service/expert-dashboard.service";
import { ExpertDashboardRepository } from "./repository/expert-dashboard.repository";
import { ExpertDashboardController } from "./api/expert-dashboard.controller";
import { ExpertStudentsController } from "./api/expert-students.controller";
import { JwtModule } from "@nestjs/jwt";

@Module({
  imports: [PrismaModule, AuditLogModule, JwtModule],
  providers: [ExpertDashboardService, ExpertDashboardRepository],
  controllers: [ExpertDashboardController, ExpertStudentsController],
  exports: [ExpertDashboardRepository],
})
export class ExpertDashboardModule {}
