import { ApiPropertyOptional } from "@nestjs/swagger";
import { LeadCallbackStatus } from "generated/prisma/enums";
import { IsISO8601, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateLeadCallbackDto {
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
