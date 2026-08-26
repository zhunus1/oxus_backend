import { IsInt, IsOptional, IsString } from "class-validator";
import messages from "src/configs/messages";

export class GenerateJitsiTokenDto {
  @IsInt({ message: messages.MUST_BE_INT("userId") })
  userId: number;

  @IsString({ message: messages.MUST_BE_STRING("userName") })
  userName: string;

  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("userAvatar") })
  userAvatar?: string;
}
