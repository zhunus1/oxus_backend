import { ApiPropertyOptional } from "@nestjs/swagger";
import { AttemptStatus } from "generated/prisma/enums";
import { IsEnum, IsInt, IsOptional } from "class-validator";

export class UpdateAttemptDto {
  @ApiPropertyOptional({ example: AttemptStatus.SUBMITTED })
  @IsOptional()
  @IsEnum(AttemptStatus)
  status?: AttemptStatus;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  userId?: number;
}
