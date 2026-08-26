import { Module } from "@nestjs/common";
import { PromocodeController } from "./api/promocode.controller";
import { PrismaModule } from "src/database/prisma.module";
import { PromocodeService } from "./service/promocode.service";
import { PromocodeRepository } from "./repository/promocode.repository";

@Module({
  imports: [PrismaModule],
  controllers: [PromocodeController],
  providers: [PromocodeService, PromocodeRepository],
})
export class PromocodeModule {}
