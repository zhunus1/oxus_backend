import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { MinioModule } from "src/common/utils/minio/minio.module";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { StudentPortraitModule } from "../studentportrait/studentportrait.module";
import { DocumentService } from "./service/document.service";
import { DocumentRepository } from "./repository/document.repository";
import { DocumentController } from "./api/document.controller";
import { JwtModule } from "@nestjs/jwt";

import { UserJourneyModule } from "src/modules/user-journey/user-journey.module";

@Module({
  imports: [PrismaModule, JwtModule, MinioModule, AuditLogModule, StudentPortraitModule, UserJourneyModule],
  providers: [DocumentService, DocumentRepository],
  exports: [DocumentService],
  controllers: [DocumentController],
})
export class DocumentModule {}
