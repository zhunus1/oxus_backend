import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import messages from "src/configs/messages";

export class ExpertMeetingHistoryQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("page") })
  @Min(1, { message: messages.MUST_BE_POSITIVE("page") })
  page: number = 1;

  @ApiPropertyOptional({ default: 9, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("limit") })
  @Min(1, { message: messages.MUST_BE_POSITIVE("limit") })
  @Max(50, { message: "limit must not exceed 50" })
  limit: number = 9;
}
