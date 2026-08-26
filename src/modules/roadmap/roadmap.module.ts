import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { RoadmapService } from "./service/roadmap.service";
import { RoadmapRepository } from "./repository/roadmap.repository";
import { RoadmapController } from "./api/roadmap.controller";
import { JwtModule } from "@nestjs/jwt";

@Module({
  imports: [PrismaModule, AuditLogModule, JwtModule],
  providers: [RoadmapService, RoadmapRepository],
  controllers: [RoadmapController],
})
export class RoadmapModule {}
