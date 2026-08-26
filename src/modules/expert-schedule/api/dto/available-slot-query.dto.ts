import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsNotEmpty } from "class-validator";

export class AvailableSlotsQueryDto {
  @ApiProperty({ example: "2026-04-01" })
  @IsDateString()
  @IsNotEmpty()
  date: string;
}
