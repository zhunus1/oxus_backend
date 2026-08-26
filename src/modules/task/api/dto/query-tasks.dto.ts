import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { TaskStatus } from "generated/prisma/enums";
import messages from "src/configs/messages";

export class QueryTasksDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("page") })
  @Min(1, { message: messages.MUST_BE_POSITIVE("page") })
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("limit") })
  @Min(1, { message: messages.MUST_BE_POSITIVE("limit") })
  @Max(100, { message: "limit must not exceed 100" })
  limit?: number = 20;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ description: "Filter by student user id (expert listing only)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("studentId") })
  studentId?: number;
}
