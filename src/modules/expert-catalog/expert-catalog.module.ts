import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { ExpertCatalogService } from "./service/expert-catalog.service";
import { ExpertCatalogRepository } from "./repository/expert-catalog.repository";
import { ExpertCatalogController } from "./api/expert-catalog.controller";
import { JwtModule } from "@nestjs/jwt";

@Module({
  imports: [PrismaModule, AuditLogModule, JwtModule],
  providers: [ExpertCatalogService, ExpertCatalogRepository],
  controllers: [ExpertCatalogController],
})
export class ExpertCatalogModule {}
