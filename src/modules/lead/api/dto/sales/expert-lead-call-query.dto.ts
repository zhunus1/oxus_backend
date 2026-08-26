import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { LeadExpertCallStatus } from "generated/prisma/enums";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";

export class ExpertLeadCallQueryDto {
  @ApiPropertyOptional({ enum: LeadExpertCallStatus })
  @IsOptional()
  @IsEnum(LeadExpertCallStatus)
  status?: LeadExpertCallStatus;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
