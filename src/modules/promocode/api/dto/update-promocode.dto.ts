import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";
import messages from "src/configs/messages";

export class UpdatePromocodeDto {
  @ApiPropertyOptional({ example: "SPRING2026" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("code") })
  code?: string;

  @ApiPropertyOptional({ example: 15, description: "Discount percent" })
  @IsOptional()
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("discountPct") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("discountPct") })
  discountPct?: number;

  @ApiPropertyOptional({ example: 5000, description: "Discount absolute amount" })
  @IsOptional()
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("discountAbs") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("discountAbs") })
  discountAbs?: number;

  @ApiPropertyOptional({ example: 100, description: "Maximum number of uses" })
  @IsOptional()
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("maxUses") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("maxUses") })
  maxUses?: number;

  @ApiPropertyOptional({ example: "2026-12-31T23:59:59Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("expiresAt") })
  expiresAt?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean({ message: messages.MUST_BE_BOOLEAN("isActive") })
  isActive?: boolean;
}
