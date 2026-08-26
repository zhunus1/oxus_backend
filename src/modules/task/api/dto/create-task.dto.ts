import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { TaskType } from "generated/prisma/enums";
import messages from "src/configs/messages";

export class CreateTaskDto {
  @ApiProperty({ example: "Сдать тест по математике" })
  @IsString({ message: messages.MUST_BE_STRING("title") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("title") })
  title: string;

  @ApiProperty({ example: "Пройдите тест до конца недели" })
  @IsString({ message: messages.MUST_BE_STRING("description") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("description") })
  description: string;

  @ApiProperty({ enum: TaskType, example: TaskType.TEST })
  @IsEnum(TaskType)
  type: TaskType;

  @ApiProperty({ example: 12, description: "User id (STUDENT role) the task is assigned to" })
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("studentId") })
  studentId: number;

  @ApiProperty({ example: "2026-06-01T23:59:00.000Z", description: "Deadline (ISO 8601)" })
  @IsDateString()
  deadline: string;

  @ApiPropertyOptional({ example: 3, description: "Required only when type is TEST" })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("testId") })
  testId?: number;
}
