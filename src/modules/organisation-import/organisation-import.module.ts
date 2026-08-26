import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "src/database/prisma.module";
import { OrganisationImportController } from "./api/organisation-import.controller";
import { OrganisationImportRepository } from "./repository/organisation-import.repository";
import { OrganisationImportService } from "./service/organisation-import.service";
import { OrganisationImportProcessor } from "./service/organisation-import.processor";
import { ProgramCatalogAgentService } from "./service/program-catalog-agent.service";
import { OrganisationCatalogAgentService } from "./service/organisation-catalog-agent.service";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "organisation-imports",
    }),
    PrismaModule,
    JwtModule,
  ],
  controllers: [OrganisationImportController],
  providers: [OrganisationImportRepository, OrganisationImportService, OrganisationImportProcessor, ProgramCatalogAgentService, OrganisationCatalogAgentService],
})
export class OrganisationImportModule {}
