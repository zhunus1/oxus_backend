import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Min } from "class-validator";
import messages from "src/configs/messages";

export class QueryEventDto {
  @ApiPropertyOptional({ example: "nis shymkent", description: "Search in title, slug, and location" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("search") })
  search?: string;

  @ApiPropertyOptional({ example: "2026-03-02T10:00:00Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("dateFrom") })
  dateFrom?: string;

  @ApiPropertyOptional({ example: "2026-03-10T10:00:00Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("dateTo") })
  dateTo?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: messages.MUST_BE_BOOLEAN("isActive") })
  isActive?: boolean;

  @ApiPropertyOptional({ default: 10, example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("take") })
  @Min(1, { message: messages.MUST_BE_MIN("take", 1) })
  take?: number = 10;

  @ApiPropertyOptional({ default: 0, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("skip") })
  @Min(0, { message: messages.MUST_BE_MIN("skip", 0) })
  skip?: number = 0;
}
