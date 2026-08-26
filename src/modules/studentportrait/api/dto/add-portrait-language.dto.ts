import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsPositive, IsString } from "class-validator";
import { Exists } from "src/common/validators/exists.validator";
import messages from "src/configs/messages";

export class AddPortraitLanguageDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("languageId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("languageId") })
  @Exists("Language", { message: args => messages.INVALID_RELATION("Language", args.value) })
  languageId: number;

  @ApiProperty({ example: "C2" })
  @IsString({ message: messages.MUST_BE_STRING("level") })
  level: string;
}
