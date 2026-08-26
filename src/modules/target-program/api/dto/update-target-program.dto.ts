import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString } from "class-validator";
import messages from "src/configs/messages";

export class UpdateTargetProgramDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_NUMBER("programId") })
  programId?: number;

  @ApiPropertyOptional({ example: "BSc Computer Science" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("programTitle") })
  programTitle?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_NUMBER("organisationId") })
  organisationId?: number;

  @ApiPropertyOptional({ example: "2026-09-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("deadline") })
  deadline?: string;

  @ApiPropertyOptional({ example: "Fall 2026" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("intake") })
  intake?: string;
}
