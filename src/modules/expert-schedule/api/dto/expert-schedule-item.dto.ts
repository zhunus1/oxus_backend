import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min, Validate } from "class-validator";
import { IsTimeRangeValidValidator } from "src/common/validators/is-time-range-valid.validator";

export class ExpertScheduleItemDto {
  @ApiProperty({ example: 1, description: "1=Monday, 7=Sunday" })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @ApiProperty({ example: 540, description: "Minutes from midnight (09:00)" })
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute: number;

  @ApiProperty({ example: 600, description: "Minutes from midnight (10:00)" })
  @IsInt()
  @Min(1)
  @Max(1440)
  @Validate(IsTimeRangeValidValidator)
  endMinute: number;
}
