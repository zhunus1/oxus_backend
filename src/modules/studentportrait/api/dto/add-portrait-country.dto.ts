import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsPositive } from "class-validator";
import { Exists } from "src/common/validators/exists.validator";
import messages from "src/configs/messages";

export class AddPortraitCountryDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("countryId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("countryId") })
  @Exists("Country", { message: args => messages.INVALID_RELATION("Country", args.value) })
  countryId: number;
}
