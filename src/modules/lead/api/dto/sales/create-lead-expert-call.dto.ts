import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateLeadExpertCallDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expertUserId: number;

  @ApiProperty({ example: "2026-08-27T05:30:00.000Z" })
  @IsISO8601({ strict: true })
  startTime: string;

  @ApiProperty({ example: "2026-08-27T06:00:00.000Z" })
  @IsISO8601({ strict: true })
  endTime: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
