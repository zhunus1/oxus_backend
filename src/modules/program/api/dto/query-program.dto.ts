import { IsOptional, IsEnum, IsString, IsNumber, IsPositive, IsDateString } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { DegreeLevel } from "generated/prisma/enums";
import { Type } from "class-transformer";

export class QueryProgramDto {
  @ApiPropertyOptional({ enum: DegreeLevel, description: "Filter by degree level" })
  @IsOptional()
  @IsEnum(DegreeLevel)
  degreeLevel?: DegreeLevel;

  @ApiPropertyOptional({ example: 1, description: "Filter by organisation ID" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  organisationId?: number;

  @ApiPropertyOptional({ example: 20000, description: "Maximum tuition fee per year" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxTuitionFee?: number;

  @ApiPropertyOptional({ example: 5000, description: "Minimum tuition fee per year" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minTuitionFee?: number;

  @ApiPropertyOptional({ example: "2027-12-31", description: "Only include programs with deadline before this date (ISO 8601)" })
  @IsOptional()
  @IsDateString()
  deadlineBefore?: string;

  @ApiPropertyOptional({ example: "2026-01-01", description: "Only include programs with deadline after this date (ISO 8601)" })
  @IsOptional()
  @IsDateString()
  deadlineAfter?: string;

  @ApiPropertyOptional({ example: "Computer Science", description: "Search by program name" })
  @IsOptional()
  @IsString()
  query?: string;
}
