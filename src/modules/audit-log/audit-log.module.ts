import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { AuditLogService } from "./service/audit-log.service";
import { AuditLogRepository } from "./repository/audit-log.repository";

@Module({
  imports: [PrismaModule],
  providers: [AuditLogService, AuditLogRepository],
  exports: [AuditLogService],
})
export class AuditLogModule {}
