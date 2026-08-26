import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { EducationLevel } from "generated/prisma/client";

export class AnalyticsFunnelQueryDto {
  @ApiPropertyOptional({ description: "ISO date — фильтр по дате регистрации студента (с)" })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: "ISO date — по (включительно день может потребовать уточнения TZ)" })
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

export class AnalyticsEventsQueryDto extends AnalyticsFunnelQueryDto {
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
