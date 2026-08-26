import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Length, Matches } from "class-validator";
import messages from "src/configs/messages";

export class SignExpertContractDto {
  @ApiProperty({ example: "123456" })
  @IsString()
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("otp") })
  @Length(6, 6, { message: "OTP must be exactly 6 digits" })
  @Matches(/^\d{6}$/, { message: "OTP must contain only digits" })
  otp: string;
}
