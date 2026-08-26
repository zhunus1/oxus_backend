import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";
import messages from "src/configs/messages";

export class SubmitTextAnswerDto {
  @ApiProperty({ example: "Мой ответ на задание..." })
  @IsString({ message: messages.MUST_BE_STRING("textAnswer") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("textAnswer") })
  textAnswer: string;
}
