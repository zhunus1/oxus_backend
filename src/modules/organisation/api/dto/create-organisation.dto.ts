import { IsString, IsEnum, IsInt, IsPositive, IsOptional, IsUrl } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Unique } from "src/common/validators/unique.validator";
import { OrgType } from "generated/prisma/client";
import messages from "src/configs/messages";
import { Exists } from "src/common/validators/exists.validator";

export class CreateOrganisationDto {
  @ApiProperty({ example: "Cambridge School Kk" })
  @IsString({ message: messages.MUST_BE_STRING("nameKk") })
  nameKk: string;

  @ApiProperty({ example: "Cambridge School Ru" })
  @IsString({ message: messages.MUST_BE_STRING("nameRu") })
  nameRu: string;

  @ApiProperty({ example: "Cambridge School En" })
  @IsString({ message: messages.MUST_BE_STRING("nameEn") })
  nameEn: string;

  @ApiProperty({ example: "cambridge_school" })
  @IsString({ message: messages.MUST_BE_STRING("slug") })
  @Unique("Organisation", "slug")
  slug: string;

  @ApiProperty({ enum: OrgType, example: OrgType.SCHOOL })
  @IsEnum(OrgType, { message: messages.MUST_BE_VALID_ENUM("type", Object.values(OrgType)) })
  type: OrgType;

  @ApiProperty({ example: 1 })
  @IsInt({ message: messages.MUST_BE_INT("countryId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("countryId") })
  @Exists("country", { message: args => messages.INVALID_RELATION("country", args.value) })
  countryId: number;

  @ApiPropertyOptional({ example: "https://www.example.edu/admissions" })
  @IsOptional()
  @IsUrl({}, { message: messages.MUST_BE_URL("websiteUrl") })
  websiteUrl?: string;
}
