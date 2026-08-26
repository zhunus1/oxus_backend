import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Min } from "class-validator";
import messages from "src/configs/messages";

export class QueryPromocodeDto {
  @ApiPropertyOptional({ example: "spring", description: "Search by promocode" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("search") })
  search?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: messages.MUST_BE_BOOLEAN("isActive") })
  isActive?: boolean;

  @ApiPropertyOptional({ example: "2026-01-01T00:00:00Z", description: "Promocodes expiring from this date" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("expiresFrom") })
  expiresFrom?: string;

  @ApiPropertyOptional({ example: "2026-12-31T23:59:59Z", description: "Promocodes expiring until this date" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("expiresTo") })
  expiresTo?: string;

  @ApiPropertyOptional({ example: 10, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("take") })
  @Min(1, { message: messages.MUST_BE_MIN("take", 1) })
  take?: number = 10;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("skip") })
  @Min(0, { message: messages.MUST_BE_MIN("skip", 0) })
  skip?: number = 0;
}
