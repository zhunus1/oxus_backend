import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsNumber, IsOptional, IsString, Min } from "class-validator";
import messages from "src/configs/messages";

export class UpdatePortraitTestDto {
  @ApiPropertyOptional({ example: "IELTS" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("testType") })
  testType?: string;

  @ApiPropertyOptional({ example: 7.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("totalScore") })
  @Min(0, { message: messages.MUST_BE_MIN("totalScore", 0) })
  totalScore?: number;

  @ApiPropertyOptional({ example: 7.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("reading") })
  @Min(0, { message: messages.MUST_BE_MIN("reading", 0) })
  reading?: number;

  @ApiPropertyOptional({ example: 7.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("listening") })
  @Min(0, { message: messages.MUST_BE_MIN("listening", 0) })
  listening?: number;

  @ApiPropertyOptional({ example: 7.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("writing") })
  @Min(0, { message: messages.MUST_BE_MIN("writing", 0) })
  writing?: number;

  @ApiPropertyOptional({ example: 7.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("speaking") })
  @Min(0, { message: messages.MUST_BE_MIN("speaking", 0) })
  speaking?: number;

  @ApiPropertyOptional({ example: "2025-06-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("testDate") })
  testDate?: string;
}
