import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsEmail, IsInt, IsOptional, IsPositive, IsString, Matches, MaxLength, MinLength, ValidateIf } from "class-validator";
import messages from "src/configs/messages";

export class UpdateAccountProfileDto {
  @ApiPropertyOptional({ example: "Alex" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("firstname") })
  @MinLength(1, { message: messages.REQUIRED_FIELD("firstname") })
  firstname?: string;

  @ApiPropertyOptional({ example: "Noony" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("lastname") })
  @MinLength(1, { message: messages.REQUIRED_FIELD("lastname") })
  lastname?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, description: "Patronymic; null or blank clears the value, omission preserves it" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() || null : value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middlename?: string | null;

  @ApiPropertyOptional({ example: "student@example.com" })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: "+77010000001" })
  @IsOptional()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: "phoneNumber must be a valid international phone number in E.164 format" })
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 1, nullable: true, description: "Country of residence; null clears the value" })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("countryId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("countryId") })
  countryId?: number | null;

  @ApiPropertyOptional({ example: 2, nullable: true, description: "Citizenship country; null clears the value" })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("citizenshipCountryId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("citizenshipCountryId") })
  citizenshipCountryId?: number | null;
}
