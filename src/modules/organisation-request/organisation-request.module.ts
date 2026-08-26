import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "src/database/prisma.module";
import { OrganisationRequestController } from "./api/organisation-request.controller";
import { OrganisationRequestRepository } from "./repository/organisation-request.repository";
import { OrganisationRequestService } from "./service/organisation-request.service";

@Module({
  imports: [PrismaModule, JwtModule],
  controllers: [OrganisationRequestController],
  providers: [OrganisationRequestRepository, OrganisationRequestService],
})
export class OrganisationRequestModule {}
