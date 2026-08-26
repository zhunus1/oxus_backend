import { Module } from "@nestjs/common";
import { PermissionController } from "./api/permission.controller";
import { PermissionService } from "./service/permission.service";
import { PermissionRepository } from "./repository/permission.repository";
import { PrismaModule } from "src/database/prisma.module";

@Module({
  controllers: [PermissionController],
  providers: [PermissionService, PermissionRepository],
  exports: [PermissionService, PermissionRepository],
  imports: [PrismaModule],
})
export class PermissionModule {}
