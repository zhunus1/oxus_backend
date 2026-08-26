import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

export class RespondMeetingDto {
  @ApiProperty({ enum: ["confirm", "decline"], example: "confirm" })
  @IsIn(["confirm", "decline"], { message: 'action must be either "confirm" or "decline"' })
  action: "confirm" | "decline";
}
