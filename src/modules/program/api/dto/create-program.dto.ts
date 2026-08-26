import { IsString, IsEnum, IsNumber, IsOptional, IsPositive, IsDateString, IsInt } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { DegreeLevel } from "generated/prisma/enums";
import { Type } from "class-transformer";
import { Exists } from "src/common/validators/exists.validator";
import messages from "src/configs/messages";

export class CreateProgramDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @IsPositive()
  @Exists("Organisation", { message: args => messages.INVALID_RELATION("organisation", args.value) })
  organisationId: number;

  @ApiProperty({ example: "Computer Science" })
  @IsString()
  name: string;

  @ApiProperty({ enum: DegreeLevel })
  @IsEnum(DegreeLevel)
  degreeLevel: DegreeLevel;

  @ApiPropertyOptional({ example: 15000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  tuitionFee?: number;

  @ApiPropertyOptional({ example: 3.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  minGPA?: number;

  @ApiPropertyOptional({ example: 6.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  minIELTS?: number;

  @ApiPropertyOptional({ example: "2026-12-31" })
  @IsOptional()
  @IsDateString()
  applicationDeadline?: string;

  @ApiPropertyOptional({ example: 0.75 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  baseAcceptanceRate?: number;
}
