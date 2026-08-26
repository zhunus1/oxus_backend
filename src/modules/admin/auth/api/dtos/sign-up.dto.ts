import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString, MinLength, IsBoolean, IsDateString, IsOptional, Matches } from "class-validator";
import { Unique } from "src/common/validators/unique.validator";
import messages from "src/configs/messages";

export class SignUpDto {
  @ApiProperty({ example: "Alex" })
  @IsString({ message: messages.MUST_BE_STRING("firstname") })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("firstname") })
  firstname: string;

  @ApiProperty({ example: "Noony" })
  @IsString({ message: messages.MUST_BE_STRING("lastname") })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("lastname") })
  lastname: string;

  @ApiProperty({ example: "student@oxusedu.com" })
  @IsEmail()
  @Unique("user", "email", { message: args => messages.UNIQUE_CONSTRAINT_FAILED("user", "email", args.value) })
  email: string;

  @ApiPropertyOptional({ example: "+77010000001" })
  @IsOptional()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: "phoneNumber must be a valid international phone number in E.164 format" })
  @Unique("user", "phoneNumber", { message: args => messages.UNIQUE_CONSTRAINT_FAILED("user", "phoneNumber", args.value) })
  phoneNumber?: string;

  @ApiProperty({ example: "Password123!" })
  @IsString({ message: messages.MUST_BE_STRING("password") })
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message: "password must be at least 8 characters and include uppercase, lowercase, a digit, and a special character",
  })
  password: string;

  @ApiPropertyOptional({ example: "Asia/Almaty" })
  @IsString({ message: messages.MUST_BE_STRING("timezone") })
  @IsOptional()
  timezone?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  hasAcceptedTerms: boolean;

  @ApiPropertyOptional({ example: "2026-03-02T16:22:34.000Z" })
  @IsDateString()
  @IsOptional()
  termsAcceptedAt?: string;

  @ApiPropertyOptional({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." })
  @IsString({ message: messages.MUST_BE_STRING("attemptAccessToken") })
  @IsOptional()
  attemptAccessToken?: string;
}
