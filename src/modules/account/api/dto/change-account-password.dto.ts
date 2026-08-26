import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";
import messages from "src/configs/messages";

export class ChangeAccountPasswordDto {
  @ApiProperty({ example: "CurrentPass123!" })
  @IsString({ message: messages.MUST_BE_STRING("currentPassword") })
  currentPassword: string;

  @ApiProperty({ example: "NewPassword456!" })
  @IsString({ message: messages.MUST_BE_STRING("newPassword") })
  @MinLength(8)
  newPassword: string;
}
