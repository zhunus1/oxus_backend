import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class RespondLeadExpertCallDto {
  @ApiProperty({ enum: ["confirm", "decline"] })
  @IsIn(["confirm", "decline"])
  action: "confirm" | "decline";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
