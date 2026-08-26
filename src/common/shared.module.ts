import { Module } from "@nestjs/common";
import { ValidatorsModule } from "./validators/validators.module";
import { PrismaModule } from "../database/prisma.module";
import { PrismaService } from "../database/prisma.service";

@Module({
  imports: [ValidatorsModule, PrismaModule],
  providers: [PrismaService],
  exports: [ValidatorsModule],
})
export class SharedModule {}
