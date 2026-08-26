import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { UserJourneyLogService } from "./user-journey-log.service";

@Module({
  imports: [PrismaModule],
  providers: [UserJourneyLogService],
  exports: [UserJourneyLogService],
})
export class UserJourneyModule {}
