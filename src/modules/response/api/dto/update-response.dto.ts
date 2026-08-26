import { IsOptional, IsNumber, IsString } from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateResponseDto {
  @ApiPropertyOptional({ example: "Answer" })
  @IsOptional()
  @IsString()
  valueText?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  valueNum?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  valueOptionId?: number;
}
