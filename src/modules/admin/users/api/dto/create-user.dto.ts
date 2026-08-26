import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsInt, IsPositive, IsString, MinLength, IsOptional, IsPhoneNumber } from "class-validator";
import { Exists } from "src/common/validators/exists.validator";
import messages from "src/configs/messages";
import { Unique } from "src/common/validators/unique.validator";
import { Type } from "class-transformer";

export class CreateUserDto {
  @ApiProperty({ example: "Alex" })
  @IsString({ message: messages.MUST_BE_STRING("firstname") })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("firstname") })
  firstname: string;

  @ApiProperty({ example: "Noony" })
  @IsString({ message: messages.MUST_BE_STRING("lastname") })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("lastname") })
  lastname: string;

  @ApiProperty({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("organisationId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("organisationId") })
  @Exists("organisation", { message: args => messages.INVALID_RELATION("organisation", args.value) })
  organisationId?: number;

  @ApiProperty({ example: "admin@oxusedu.com" })
  @IsEmail()
  @Unique("user", "email", { message: args => messages.UNIQUE_CONSTRAINT_FAILED("user", "email", args.value) })
  email: string;

  @ApiProperty({ example: "Password123!" })
  @IsString({ message: messages.MUST_BE_STRING("password") })
  @MinLength(8)
  password: string;

  @ApiProperty({ example: "+77010000001" })
  @IsPhoneNumber()
  @Unique("user", "phoneNumber", { message: args => messages.UNIQUE_CONSTRAINT_FAILED("user", "phoneNumber", args.value) })
  phoneNumber: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("roleId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("roleId") })
  @Exists("role", { message: args => messages.INVALID_RELATION("role", args.value) })
  roleId: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("countryId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("countryId") })
  @Exists("country", { message: args => messages.INVALID_RELATION("country", args.value) })
  countryId: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("citizenshipCountryId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("citizenshipCountryId") })
  @Exists("country", { message: args => messages.INVALID_RELATION("country", args.value) })
  citizenshipCountryId: number;
}
