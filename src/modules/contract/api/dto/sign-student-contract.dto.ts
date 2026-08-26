import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Length, Matches } from "class-validator";
import messages from "src/configs/messages";

export class SignStudentContractDto {
  @ApiProperty({ example: "Иванов Иван Иванович" })
  @IsString()
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("clientFullName") })
  clientFullName: string;

  @ApiProperty({ example: "Иванов Иван" })
  @IsString()
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("studentName") })
  studentName: string;

  @ApiProperty({ example: "123456789012" })
  @IsString()
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("clientIin") })
  @Length(12, 12, { message: "IIN must be exactly 12 digits" })
  @Matches(/^\d{12}$/, { message: "IIN must contain only digits" })
  clientIin: string;

  @ApiProperty({ example: "г. Алматы, ул. Абая 1" })
  @IsString()
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("clientAddress") })
  clientAddress: string;

  @ApiProperty({ example: "+77001234567" })
  @IsString()
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("clientPhone") })
  clientPhone: string;

  @ApiProperty({ example: "123456" })
  @IsString()
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("otp") })
  @Length(6, 6, { message: "OTP must be exactly 6 digits" })
  @Matches(/^\d{6}$/, { message: "OTP must contain only digits" })
  otp: string;
}
