import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsOptional } from "class-validator";
import { Type } from "class-transformer";
import { ProcessStep } from "generated/prisma/client";
import messages from "src/configs/messages";

export class KanbanQueryDto {
  @ApiPropertyOptional({ enum: ProcessStep })
  @IsOptional()
  @IsEnum(ProcessStep, { message: messages.MUST_BE_VALID_ENUM("currentStep", Object.values(ProcessStep)) })
  currentStep?: ProcessStep;

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
