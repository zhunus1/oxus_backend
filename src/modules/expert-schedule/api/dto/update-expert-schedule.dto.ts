import { ApiProperty } from "@nestjs/swagger";
import { IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ExpertScheduleItemDto } from "./expert-schedule-item.dto";

export class UpdateExpertScheduleDto {
  @ApiProperty({
    type: [ExpertScheduleItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpertScheduleItemDto)
  items: ExpertScheduleItemDto[];
}
