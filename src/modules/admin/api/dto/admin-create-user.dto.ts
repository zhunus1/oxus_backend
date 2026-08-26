import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, MinLength } from "class-validator";
import { Exists } from "src/common/validators/exists.validator";
import messages from "src/configs/messages";

/** Создание пользователя из админ-панели. */
export class AdminCreateUserDto {
  @ApiProperty({ example: "Alex" })
  @IsString({ message: messages.MUST_BE_STRING("firstname") })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("firstname") })
  firstname!: string;

  @ApiProperty({ example: "Ivanov" })
  @IsString({ message: messages.MUST_BE_STRING("lastname") })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("lastname") })
  lastname!: string;

  @ApiProperty({ example: "user@oxusedu.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: "Password123!", minLength: 8 })
  @IsString()
  @MinLength(8, { message: "password must be at least 8 characters" })
  password!: string;

  @ApiProperty({ example: "+77010000001" })
  @IsPhoneNumber()
  phoneNumber!: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("roleId") })
  @Exists("role", { message: args => messages.INVALID_RELATION("role", args.value) })
  roleId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Exists("organisation", {
    message: args => messages.INVALID_RELATION("organisation", args.value),
  })
  organisationId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Exists("country", { message: args => messages.INVALID_RELATION("country", args.value) })
  countryId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Exists("country", { message: args => messages.INVALID_RELATION("country", args.value) })
  citizenshipCountryId?: number;
}
