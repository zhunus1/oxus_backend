import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsPositive } from "class-validator";
import { ConsultationStatus } from "generated/prisma/enums";
import { Exists } from "src/common/validators/exists.validator";
import messages from "src/configs/messages";

export class CreateConsultationDto {
  @ApiProperty({ example: 1 })
  @IsInt({ message: messages.MUST_BE_INT("clientId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("clientId") })
  @Exists("user", { message: args => messages.INVALID_RELATION("client", args.value) })
  clientId: number;

  @ApiProperty({ example: 2 })
  @IsInt({ message: messages.MUST_BE_INT("consultantId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("consultantId") })
  @Exists("user", { message: args => messages.INVALID_RELATION("consultant", args.value) })
  consultantId: number;

  @ApiProperty({ example: "2026-01-26T23:00:00Z" })
  @IsDateString({}, { message: messages.MUST_BE_DATE("startTime") })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("startTime") })
  startTime: string;

  @ApiProperty({ example: "2026-01-26T23:30:00Z" })
  @IsDateString({}, { message: messages.MUST_BE_DATE("endTime") })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("endTime") })
  endTime: string;

  @ApiPropertyOptional({ enum: ConsultationStatus, example: ConsultationStatus.REQUESTED })
  @IsOptional()
  @IsEnum(ConsultationStatus, { message: messages.MUST_BE_VALID_ENUM("status", Object.values(ConsultationStatus)) })
  status?: ConsultationStatus;
}
