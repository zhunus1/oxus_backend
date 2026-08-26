import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { LanguageService } from "./service/language.service";
import { LanguageRepository } from "./repository/language.repository";
import { LanguageController } from "./api/language.controller";

@Module({
  imports: [PrismaModule],
  providers: [LanguageService, LanguageRepository],
  exports: [LanguageService],
  controllers: [LanguageController],
})
export class LanguageModule {}
