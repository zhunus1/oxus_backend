import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class UpdateLeadExpertCallDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expertUserId?: number;

  @ApiPropertyOptional({ example: "2026-08-27T05:30:00.000Z" })
  @IsOptional()
  @IsISO8601({ strict: true })
  startTime?: string;

  @ApiPropertyOptional({ example: "2026-08-27T06:00:00.000Z" })
  @IsOptional()
  @IsISO8601({ strict: true })
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
