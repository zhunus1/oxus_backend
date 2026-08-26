import { QuestionType } from "generated/prisma/enums";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsPositive, IsString, ValidateNested } from "class-validator";

export class CreateQuestionDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  order: number;

  @ApiProperty({ example: "Question text" })
  @IsString()
  text: string;

  @ApiPropertyOptional({ example: "Additional context for the question" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: QuestionType.SINGLE_CHOICE })
  @IsEnum(QuestionType)
  type: QuestionType;

  @ApiPropertyOptional({ example: 1, description: "ID of the segment this question belongs to" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  segmentId?: number;

  @ApiProperty({
    type: () => [QuestionOptionDto],
    example: [
      { order: 1, text: "Option 1", label: "A" },
      { order: 2, text: "Option 2", label: "B" },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options: QuestionOptionDto[];

  @ApiProperty({ example: true })
  @IsBoolean()
  required: boolean;
}

export class QuestionOptionDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  order: number;

  @ApiProperty({ example: "Option text" })
  @IsString()
  text: string;

  @ApiPropertyOptional({ example: "A", description: "Display label for SINGLE_CHOICE / MULTIPLE_CHOICE options" })
  @IsOptional()
  @IsString()
  label?: string;
}
