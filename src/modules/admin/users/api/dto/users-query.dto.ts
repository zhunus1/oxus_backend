import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsInt, Min, IsPositive, IsIn } from "class-validator";
import { Type } from "class-transformer";
import messages from "src/configs/messages";
import { Exists } from "src/common/validators/exists.validator";

export class UsersQueryDto {
  @ApiPropertyOptional({ enum: ["ADMIN", "EXPERT", "STUDENT", "SCHOOLBOY", "SALES_MANAGER", "AGENT"] })
  @IsOptional()
  @IsString()
  @IsIn(["ADMIN", "EXPERT", "STUDENT", "SCHOOLBOY", "SALES_MANAGER", "AGENT"], { message: "Invalid role code" })
  roleCode?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("roleId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("roleId") })
  @Exists("role", { message: args => messages.INVALID_RELATION("role", args.value) })
  roleId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("countryId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("countryId") })
  countryId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("citizenshipCountryId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("citizenshipCountryId") })
  citizenshipCountryId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("organisationId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("organisationId") })
  organisationId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("search") })
  search?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("skip") })
  @Min(0, { message: messages.MUST_BE_POSITIVE("skip") })
  skip?: number = 0;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("take") })
  @Min(1, { message: messages.MUST_BE_POSITIVE("take") })
  take?: number = 10;
}
