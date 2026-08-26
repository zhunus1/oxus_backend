import { ApiProperty } from "@nestjs/swagger";
import { IsDateString } from "class-validator";
import messages from "src/configs/messages";

export class UpdateProgramDeadlineDto {
  @ApiProperty({
    example: "2026-10-15T00:00:00.000Z",
    description: "New canonical application deadline for the program in ISO 8601 format.",
  })
  @IsDateString({}, { message: messages.MUST_BE_DATE("applicationDeadline") })
  applicationDeadline: string;
}
