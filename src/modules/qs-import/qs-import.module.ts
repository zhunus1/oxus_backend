import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "src/database/prisma.module";
import { QsImportController } from "./api/qs-import.controller";
import { QsImportRepository } from "./repository/qs-import.repository";
import { QsImportProcessor } from "./service/qs-import.processor";
import { QsImportService } from "./service/qs-import.service";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "organisation-imports",
    }),
    PrismaModule,
    JwtModule,
  ],
  controllers: [QsImportController],
  providers: [QsImportRepository, QsImportService, QsImportProcessor],
})
export class QsImportModule {}
