import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "src/database/prisma.module";
import { ExpertScheduleController } from "./api/expert-schedule.controller";
import { ExpertScheduleService } from "./service/expert-schedule.service";
import { ExpertScheduleRepository } from "./repository/expert-schedule.repository";
import { ExpertAvailabilityController } from "./api/expert-availability.controller";

@Module({
  imports: [PrismaModule, JwtModule],
  controllers: [ExpertScheduleController, ExpertAvailabilityController],
  providers: [ExpertScheduleService, ExpertScheduleRepository],
})
export class ExpertScheduleModule {}
