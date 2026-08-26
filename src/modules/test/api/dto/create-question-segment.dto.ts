import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import messages from "src/configs/messages";

export class CreateQuestionSegmentDto {
  @ApiProperty({ example: "Section A: Reading Comprehension" })
  @IsString({ message: messages.MUST_BE_STRING("Title") })
  @MinLength(1)
  @Transform(({ value }) => value.trim())
  title: string;
}
