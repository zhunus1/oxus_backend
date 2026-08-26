import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { Type } from "class-transformer";
import messages from "src/configs/messages";

export class CreateTargetProgramDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_NUMBER("programId") })
  programId: number;

  @ApiPropertyOptional({ example: "2026-09-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("deadline") })
  deadline?: string;

  @ApiProperty({ example: "Fall 2026" })
  @IsString({ message: messages.MUST_BE_STRING("intake") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("intake") })
  intake: string;
}
