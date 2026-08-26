import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { QuizAnswerDto } from "./quiz-answer.dto";

export class CreateManualLeadDto {
  @ApiProperty({ example: "Аружан Сейдахмет" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: "+7 777 482 19 33" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiProperty({ enum: ["parent", "student"] })
  @IsIn(["parent", "student"])
  role: "parent" | "student";

  @ApiProperty({ enum: ["ru", "kk"] })
  @IsIn(["ru", "kk"])
  locale: "ru" | "kk";

  @ApiPropertyOptional({ example: "2026-08-26" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  quizVersion?: string;

  @ApiPropertyOptional({ example: 935 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  score?: number;

  @ApiPropertyOptional({ example: 93 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  percent?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  universities?: number;

  @ApiProperty({ type: [QuizAnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers: QuizAnswerDto[];
}
