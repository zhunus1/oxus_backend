import { Module } from "@nestjs/common";
import { ExistsValidator } from "./exists.validator";
import { UniqueValidator } from "./unique.validator";
import { PrismaService } from "../../database/prisma.service";
import { ExistsUUIDValidator } from "./existsuuid.validator";
import { UniqueFieldsPipe } from "./unique-field.pipe";
import { UniqueForUpdateValidator } from "./unique-update.validator";
import { ExistsAllValidator } from "./exists-all.validator";

@Module({
  providers: [ExistsValidator, UniqueValidator, ExistsUUIDValidator, UniqueFieldsPipe, UniqueForUpdateValidator, ExistsAllValidator, PrismaService],
  exports: [ExistsValidator, UniqueValidator, ExistsUUIDValidator, UniqueFieldsPipe, UniqueForUpdateValidator, ExistsAllValidator],
})
export class ValidatorsModule {}
