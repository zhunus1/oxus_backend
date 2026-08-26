import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class RejectLeadDto {
  @ApiProperty({ example: "Клиент больше не заинтересован" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}
