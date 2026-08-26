import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsEnum, IsInt, Min, IsDateString } from "class-validator";
import { Type } from "class-transformer";
import { ConsultationStatus } from "generated/prisma/enums";
import messages from "src/configs/messages";

export class ConsultationQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("clientId") })
  clientId?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("consultantId") })
  consultantId?: number;

  @ApiPropertyOptional({ enum: ConsultationStatus })
  @IsOptional()
  @IsEnum(ConsultationStatus, { message: messages.MUST_BE_VALID_ENUM("status", Object.values(ConsultationStatus)) })
  status?: ConsultationStatus;

  @ApiPropertyOptional({ example: "2026-01-01T00:00:00Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("startDate") })
  startDate?: string;

  @ApiPropertyOptional({ example: "2026-12-31T23:59:59Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("endDate") })
  endDate?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("skip") })
  @Min(0)
  skip?: number = 0;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("take") })
  @Min(1)
  take?: number = 10;
}
