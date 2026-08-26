import { ApiPropertyOptional } from "@nestjs/swagger";
import { EducationLevel } from "generated/prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, IsIn } from "class-validator";
import messages from "src/configs/messages";
import { CRM_STUDENT_STATUSES } from "../../crm/crm-status.mapper";

export class CrmStudentsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("page") })
  @Min(1, { message: messages.MUST_BE_POSITIVE("page") })
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("limit") })
  @Min(1, { message: messages.MUST_BE_POSITIVE("limit") })
  @Max(100, { message: "limit must not exceed 100" })
  limit?: number = 20;

  @ApiPropertyOptional({ description: "Search firstname, lastname, email (case-insensitive)" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: CRM_STUDENT_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn([...CRM_STUDENT_STATUSES], { message: "Invalid CRM status filter" })
  status?: string;

  @ApiPropertyOptional({ description: "Target country ISO code (e.g. KZ)" })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ enum: EducationLevel })
  @IsOptional()
  @IsEnum(EducationLevel)
  educationLevel?: EducationLevel;
}
