import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, MinLength } from "class-validator";
import { Exists } from "src/common/validators/exists.validator";
import messages from "src/configs/messages";

/** Частичное обновление пользователя из админ-панели (ADMIN only). */
export class AdminPatchUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("firstname") })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("firstname") })
  firstname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("lastname") })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("lastname") })
  lastname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPhoneNumber()
  phoneNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("roleId") })
  @Exists("role", { message: args => messages.INVALID_RELATION("role", args.value) })
  roleId?: number;

  @ApiPropertyOptional({
    description: "Новый пароль; если не передан — не меняется",
  })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: "password must be at least 8 characters" })
  password?: string;
}
