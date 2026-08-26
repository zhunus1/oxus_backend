import { IsOptional, IsNumber, IsString } from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Exists } from "src/common/validators/exists.validator";

export class CreateResponseDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Exists("Question")
  questionId: number;

  @ApiPropertyOptional({ example: "Answer" })
  @IsOptional()
  @IsString()
  valueText: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  valueNum: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Exists("QuestionOption")
  valueOptionId: number;
}
