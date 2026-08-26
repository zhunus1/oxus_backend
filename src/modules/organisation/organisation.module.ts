import { Module } from "@nestjs/common";
import { OrganisationService } from "./service/organisation.service";
import { OrganisationRepository } from "./repository/organisation.repository";
import { PrismaService } from "src/database/prisma.service";
import { OrganisationController } from "./api/organisation.controller";
import { JwtModule } from "@nestjs/jwt";
import { MinioModule } from "src/common/utils/minio/minio.module";

@Module({
  imports: [JwtModule, MinioModule],
  controllers: [OrganisationController],
  providers: [OrganisationRepository, PrismaService, OrganisationService],
  exports: [OrganisationService],
})
export class OrganisationModule {}
