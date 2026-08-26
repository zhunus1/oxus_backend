import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { QuizAnswerDto } from "./quiz-answer.dto";

export class LandingCalculatorSubmissionDto {
  @ApiPropertyOptional({ format: "uuid", description: "Client-generated idempotency key" })
  @IsOptional()
  @IsUUID()
  submissionId?: string;

  @ApiPropertyOptional({ example: "2026-08-26" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  quizVersion?: string;

  @ApiProperty({ example: "2026-08-26T18:41:07.221Z" })
  @IsISO8601({ strict: true })
  submittedAt: string;

  @ApiProperty({ enum: ["parent", "student"] })
  @IsIn(["parent", "student"])
  role: "parent" | "student";

  @ApiProperty({ enum: ["ru", "kk"] })
  @IsIn(["ru", "kk"])
  locale: "ru" | "kk";

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

  @ApiProperty({ example: 935 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  score: number;

  @ApiProperty({ example: 93 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  percent: number;

  @ApiProperty({ example: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  universities: number;

  @ApiProperty({ type: [QuizAnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers: QuizAnswerDto[];
}
