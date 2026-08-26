import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsInt, IsOptional, IsPositive, IsString } from "class-validator";
import { Exists } from "src/common/validators/exists.validator";
import messages from "src/configs/messages";

export class UpdateEventDto {
  @ApiPropertyOptional({ example: "NIS Shymkent Presentation" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("title") })
  title?: string;

  @ApiPropertyOptional({ example: "nis-shymkent-2026" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("slug") })
  slug?: string;

  @ApiPropertyOptional({ example: "2026-03-02T22:00:00Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("eventDate") })
  eventDate?: string;

  @ApiPropertyOptional({ example: "Shymkent, NIS" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("location") })
  location?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean({ message: messages.MUST_BE_BOOLEAN("isActive") })
  isActive?: boolean;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt({ message: messages.MUST_BE_INT("testId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("testId") })
  @Exists("test", { message: args => messages.INVALID_RELATION("test", args.value) })
  testId?: number;

  @ApiPropertyOptional({ example: 2345 })
  @IsOptional()
  @IsInt({ message: messages.MUST_BE_INT("promoCodeId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("promoCodeId") })
  @Exists("promoCode", { message: args => messages.INVALID_RELATION("promoCode", args.value) })
  promoCodeId?: number;
}
