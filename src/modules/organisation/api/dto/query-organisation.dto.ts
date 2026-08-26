import { IsOptional, IsEnum, IsString, IsInt, Min, IsNumber } from "class-validator";
import { Type } from "class-transformer";
import { OrgType } from "generated/prisma/enums";

export class QueryOrganisationDto {
  @IsOptional()
  @IsEnum(OrgType)
  type?: OrgType;

  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  degreeLevel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tuitionMax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  gpaMax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ieltsMax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;
}
