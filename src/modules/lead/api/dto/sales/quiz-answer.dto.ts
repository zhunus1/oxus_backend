import { ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class QuizAnswerDto {
  @ApiPropertyOptional({ example: "Из какого вы города?" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  question?: string;

  @ApiPropertyOptional({ example: "Алматы" })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  answer?: string;

  @ApiPropertyOptional({ example: "city" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  questionId?: string;

  @ApiPropertyOptional({ example: ["almaty"], type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(120, { each: true })
  optionIds?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  freeText?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  questionText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  answerText?: string;
}
