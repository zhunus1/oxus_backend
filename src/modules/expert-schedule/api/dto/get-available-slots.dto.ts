import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsNotEmpty } from "class-validator";

export class GetAvailableSlotsDto {
  @ApiProperty({ example: "2026-04-01" })
  @IsDateString()
  @IsNotEmpty()
  from: string;

  @ApiProperty({ example: "2026-04-07" })
  @IsDateString()
  @IsNotEmpty()
  to: string;
}
