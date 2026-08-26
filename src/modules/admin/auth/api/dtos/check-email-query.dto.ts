import { ApiProperty } from "@nestjs/swagger";
import { IsEmail } from "class-validator";

export class CheckEmailQueryDto {
  @ApiProperty({ example: "student@oxusedu.com" })
  @IsEmail()
  email: string;
}

export class CheckEmailResponseDto {
  @ApiProperty({ example: true })
  available: boolean;
}
