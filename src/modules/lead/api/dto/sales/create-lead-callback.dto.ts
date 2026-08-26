import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateLeadCallbackDto {
  @ApiProperty({ example: "2026-08-28T05:00:00.000Z" })
  @IsISO8601({ strict: true })
  scheduledFor: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
