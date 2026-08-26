import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import messages from "src/configs/messages";

export class CreateCollabTodoDto {
  @ApiProperty({ example: "Review the proposal" })
  @IsString()
  @MinLength(1)
  @IsNotEmpty({ message: messages.NOT_EMPTY("text") })
  text: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  assigneeId?: number;
}
