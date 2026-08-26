import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import messages from "src/configs/messages";

export class ExpertStudentsQueryDto {
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

  @ApiPropertyOptional({
    description: "Case-insensitive match on student first name, last name or email",
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Filter registrations on/after this date (ISO 8601 date)" })
  @IsOptional()
  @IsDateString()
  registeredFrom?: string;

  @ApiPropertyOptional({ description: "Filter registrations on/before this date (ISO 8601 date)" })
  @IsOptional()
  @IsDateString()
  registeredTo?: string;
}
