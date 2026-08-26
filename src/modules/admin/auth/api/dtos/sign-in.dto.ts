import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString } from "class-validator";
import messages from "src/configs/messages";

export class SignInDto {
  @ApiProperty({ example: "admin@oxusedu.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "Password123!" })
  @IsString({ message: messages.MUST_BE_STRING("password") })
  password: string;
}
