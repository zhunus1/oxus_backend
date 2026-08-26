import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";
import messages from "src/configs/messages";

export class StaleCommentDto {
  @ApiProperty({ example: "Студент ждет справку из банка" })
  @IsString({ message: messages.MUST_BE_STRING("comment") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("comment") })
  comment: string;
}
