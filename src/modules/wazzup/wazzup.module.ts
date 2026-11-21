import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "src/database/prisma.module";
import { WazzupClient } from "./wazzup.client";
import { WazzupController } from "./wazzup.controller";
import { WazzupService } from "./wazzup.service";
import { WazzupAccessService } from "./wazzup-access.service";

@Module({
  imports: [ConfigModule, JwtModule, PrismaModule],
  controllers: [WazzupController],
  providers: [WazzupClient, WazzupService, WazzupAccessService],
  exports: [WazzupAccessService],
})
export class WazzupModule {}
