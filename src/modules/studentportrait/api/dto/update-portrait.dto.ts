import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString, Min } from "class-validator";
import { EducationLevel } from "generated/prisma/enums";
import messages from "src/configs/messages";

export class UpdatePortraitDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean({ message: messages.MUST_BE_BOOLEAN("hasVisa") })
  hasVisa?: boolean;

  @ApiPropertyOptional({ example: "2005-06-15T00:00:00.000Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("birthDate") })
  birthDate?: string;

  @ApiPropertyOptional({ enum: EducationLevel, example: EducationLevel.HIGH_SCHOOL })
  @IsOptional()
  @IsEnum(EducationLevel, {
    message: messages.MUST_BE_VALID_ENUM("educationLevel", Object.values(EducationLevel)),
  })
  educationLevel?: EducationLevel;

  @ApiPropertyOptional({ example: "Computer Science" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("major") })
  major?: string;

  @ApiPropertyOptional({ example: 3.7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("gpa") })
  @Min(0, { message: messages.MUST_BE_MIN("gpa", 0) })
  gpa?: number;

  @ApiPropertyOptional({ example: 4.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("gpaScale") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("gpaScale") })
  gpaScale?: number;

  @ApiPropertyOptional({ example: 15000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("budgetLimit") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("budgetLimit") })
  budgetLimit?: number;

  @ApiPropertyOptional({ example: "USD" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("budgetCurrency") })
  budgetCurrency?: string;
}
