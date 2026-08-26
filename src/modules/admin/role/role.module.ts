import { Module } from "@nestjs/common";
import { RoleController } from "./api/role.controller";
import { RoleService } from "./service/role.service";
import { RoleRepository } from "./repository/role.repository";
import { PrismaModule } from "src/database/prisma.module";

@Module({
  controllers: [RoleController],
  providers: [RoleService, RoleRepository],
  exports: [RoleService, RoleRepository],
  imports: [PrismaModule],
})
export class RoleModule {}
