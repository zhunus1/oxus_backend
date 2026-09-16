import { ApiPropertyOptional } from "@nestjs/swagger";
import { LeadCallbackReason, LeadCallbackStatus } from "generated/prisma/enums";
import { IsEnum, IsISO8601, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";

export class UpdateLeadCallbackDto {
  @ApiPropertyOptional({ enum: LeadCallbackReason })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(LeadCallbackReason)
  reason?: LeadCallbackReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledFor?: string;

  @ApiPropertyOptional({ enum: [LeadCallbackStatus.COMPLETED, LeadCallbackStatus.CANCELLED] })
  @IsOptional()
  @IsIn([LeadCallbackStatus.COMPLETED, LeadCallbackStatus.CANCELLED])
  status?: LeadCallbackStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
