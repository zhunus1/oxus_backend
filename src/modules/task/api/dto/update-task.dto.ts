import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsNotEmpty, IsOptional, IsString } from "class-validator";
import messages from "src/configs/messages";

export class UpdateTaskDto {
  @ApiPropertyOptional({ example: "Новое название задачи" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("title") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("title") })
  title?: string;

  @ApiPropertyOptional({ example: "Обновлённое описание" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("description") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("description") })
  description?: string;

  @ApiPropertyOptional({ example: "2026-06-10T23:59:00.000Z" })
  @IsOptional()
  @IsDateString()
  deadline?: string;
}
