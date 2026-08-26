import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNumber, IsOptional } from "class-validator";
import { Type } from "class-transformer";
import messages from "src/configs/messages";

export class ExpertCatalogQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_NUMBER("countryId") })
  countryId?: number;

  @ApiPropertyOptional({ example: 4.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: messages.MUST_BE_NUMBER("minRating") })
  minRating?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("skip") })
  skip?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("take") })
  take?: number;
}
