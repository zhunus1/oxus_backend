import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { CountryService } from "./service/country.service";
import { CountryRepository } from "./repository/country.repository";
import { CountryController } from "./api/country.controller";

@Module({
  imports: [PrismaModule],
  providers: [CountryService, CountryRepository],
  exports: [CountryService],
  controllers: [CountryController],
})
export class CountryModule {}
