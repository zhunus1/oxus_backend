import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { LeadController } from "./api/lead.controller";
import { LeadService } from "./service/lead.service";
import { LeadRepository } from "./repository/lead.repository";
import { JwtModule } from "@nestjs/jwt";

@Module({
  imports: [PrismaModule, JwtModule],
  controllers: [LeadController],
  providers: [LeadService, LeadRepository],
})
export class LeadModule {}
