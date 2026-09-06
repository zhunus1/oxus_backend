import { LeadRealtimeModule } from "../lead/realtime/lead-realtime.module";
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "src/database/prisma.service";
import { UserJourneyModule } from "src/modules/user-journey/user-journey.module";
import { AdminController } from "./admin.controller";
import { AnalyticsController } from "./analytics.controller";
import { AdminService } from "./admin.service";
import { AnalyticsService } from "./analytics.service";
import { FinanceService } from "./finance.service";
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";
import { PortraitModule } from "./portrait/portrait.module";

@Module({
  imports: [LeadRealtimeModule, JwtModule, UsersModule, AuthModule, PortraitModule, UserJourneyModule],
  controllers: [AdminController, AnalyticsController],
  providers: [PrismaService, AdminService, AnalyticsService, FinanceService],
})
export class AdminModule {}
