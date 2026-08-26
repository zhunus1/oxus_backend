import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { ConsultationStatus } from "generated/prisma/enums";
import messages from "src/configs/messages";

export class UpdateConsultationDto {
  @ApiPropertyOptional({ example: "2026-01-26T23:00:00Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("startTime") })
  startTime?: string;

  @ApiPropertyOptional({ example: "2026-01-26T23:30:00Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("endTime") })
  endTime?: string;

  @ApiPropertyOptional({ enum: ConsultationStatus, example: ConsultationStatus.CONFIRMED })
  @IsOptional()
  @IsEnum(ConsultationStatus, { message: messages.MUST_BE_VALID_ENUM("status", Object.values(ConsultationStatus)) })
  status?: ConsultationStatus;
}
