import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, Min } from "class-validator";

export class TransferStudentDto {
  @ApiProperty({ description: "User id of the target expert (ConsultantProfile.userId)", example: 101 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  newExpertId!: number;
}
