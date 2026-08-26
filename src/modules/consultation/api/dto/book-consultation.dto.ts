import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsNotEmpty } from "class-validator";
import messages from "src/configs/messages";

export class BookConsultationDto {
  @ApiProperty({ example: "2026-04-15T10:00:00.000Z" })
  @IsDateString({}, { message: messages.MUST_BE_DATE("startTime") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("startTime") })
  startTime: string;

  @ApiProperty({ example: "2026-04-15T11:00:00.000Z" })
  @IsDateString({}, { message: messages.MUST_BE_DATE("endTime") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("endTime") })
  endTime: string;
}
