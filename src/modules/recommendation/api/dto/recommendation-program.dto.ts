// src/modules/recommendation/api/dto/recommendation-program.dto.ts
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from "class-validator";
import messages from "src/configs/messages";
import { DegreeLevel, EducationLevel } from "generated/prisma/enums";

export class RecommendationProgramDto {
  @ApiProperty({ example: DegreeLevel.BACHELOR, enum: DegreeLevel })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("degreeLevel") })
  @IsIn(Object.values(DegreeLevel), { message: messages.MUST_BE_VALID_ENUM("degreeLevel", Object.values(DegreeLevel)) })
  degreeLevel: DegreeLevel;

  @ApiProperty({ example: 3.4 })
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("gpa") })
  @Min(0, { message: messages.MUST_BE_MIN("gpa", 0) })
  gpa: number;

  @ApiProperty({ example: 4.0 })
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("gpaScale") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("gpaScale") })
  gpaScale: number;

  @ApiPropertyOptional({ enum: EducationLevel, example: EducationLevel.BACHELOR })
  @IsOptional()
  educationLevel?: EducationLevel;

  @ApiPropertyOptional({ example: "Computer Science" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("major") })
  major?: string;

  @ApiPropertyOptional({ example: 7.0, description: "IELTS overall score" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("ielts") })
  @Min(0, { message: messages.MUST_BE_MIN("ielts", 0) })
  @Max(9, { message: messages.MUST_BE_LESS_OR_EQUAL("ielts", 9) })
  ielts?: number;

  @ApiPropertyOptional({ example: 1550, description: "SAT overall score" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("sat") })
  @Min(0, { message: messages.MUST_BE_MIN("sat", 0) })
  @Max(1600, { message: messages.MUST_BE_LESS_OR_EQUAL("sat", 1600) })
  sat?: number;

  @ApiProperty({ example: 12000, description: "Max yearly tuition fee in USD (Phase 1 required)" })
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("maxTuitionFee") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("maxTuitionFee") })
  maxTuitionFee: number;

  @ApiPropertyOptional({ example: ["KZ", "RU"], description: "ISO country codes (filters organisations by country)" })
  @IsOptional()
  @IsArray({ message: messages.MUST_BE_ARRAY("countryIsoCodes") })
  @IsString({ each: true, message: messages.MUST_BE_STRING("countryIsoCodes") })
  countryIsoCodes?: string[];

  @ApiPropertyOptional({ example: [1, 2, 3], description: "Filter by organisation IDs" })
  @IsOptional()
  @IsArray({ message: messages.MUST_BE_ARRAY("organisationIds") })
  @Type(() => Number)
  @IsInt({ each: true, message: messages.MUST_BE_INT("organisationIds") })
  @IsPositive({ each: true, message: messages.MUST_BE_POSITIVE("organisationIds") })
  organisationIds?: number[];

  @ApiPropertyOptional({ example: [10, 11], description: "Filter by program IDs" })
  @IsOptional()
  @IsArray({ message: messages.MUST_BE_ARRAY("programIds") })
  @Type(() => Number)
  @IsInt({ each: true, message: messages.MUST_BE_INT("programIds") })
  @IsPositive({ each: true, message: messages.MUST_BE_POSITIVE("programIds") })
  programIds?: number[];
}
