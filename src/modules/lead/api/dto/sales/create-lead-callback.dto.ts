import { LeadCallbackReason } from "generated/prisma/enums";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";

/** Validates the callback time, optional comment, and follow-up reason. */
export class CreateLeadCallbackDto {
  @ApiPropertyOptional({ enum: LeadCallbackReason })
  @IsOptional()
  @IsEnum(LeadCallbackReason)
  reason?: LeadCallbackReason;

  @ApiProperty({ example: "2026-08-28T05:00:00.000Z" })
  @IsISO8601({ strict: true })
  scheduledFor: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
