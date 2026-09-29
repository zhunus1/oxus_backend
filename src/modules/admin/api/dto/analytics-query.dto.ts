import { ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { EducationLevel } from "generated/prisma/client";

export class AnalyticsFunnelQueryDto {
  @ApiPropertyOptional({ description: "ISO date — фильтр по дате регистрации студента (с)" })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description:
      "Inclusive registration timestamp upper bound. Date-only means midnight UTC, not end of day. Summary conversions are lifetime events for this registration cohort.",
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: "ISO код страны проживания (User.country)" })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ enum: EducationLevel })
  @IsOptional()
  @IsEnum(EducationLevel)
  educationLevel?: EducationLevel;
}

export class AnalyticsEventsQueryDto extends OmitType(AnalyticsFunnelQueryDto, ["dateFrom", "dateTo"] as const) {
  @ApiPropertyOptional({ description: "Inclusive event occurredAt lower bound; legacy events fall back to createdAt. Does not filter student registration." })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: "Inclusive event occurredAt upper bound; use an explicit timezone for timestamps." })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: "Тип события UserJourneyEvent" })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
