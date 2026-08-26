import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";
import messages from "src/configs/messages";

export class CreateCommentDto {
  @ApiProperty({ example: "Загрузил готовый документ, проверьте пожалуйста" })
  @IsString({ message: messages.MUST_BE_STRING("body") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("body") })
  body: string;
}
