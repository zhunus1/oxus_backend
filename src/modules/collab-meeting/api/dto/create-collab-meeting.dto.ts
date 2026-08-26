import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, MinLength } from "class-validator";
import messages from "src/configs/messages";

export class CreateCollabMeetingDto {
  @ApiProperty({ example: "Sprint planning" })
  @IsString()
  @MinLength(1)
  @IsNotEmpty({ message: messages.NOT_EMPTY("title") })
  title: string;

  @ApiProperty({ example: "2026-06-15T10:00:00.000Z" })
  @IsDateString({}, { message: messages.MUST_BE_DATE("startTime") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("startTime") })
  startTime: string;

  @ApiProperty({ example: "2026-06-15T11:00:00.000Z" })
  @IsDateString({}, { message: messages.MUST_BE_DATE("endTime") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("endTime") })
  endTime: string;

  @ApiProperty({ example: [2, 5], type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  inviteeUserIds: number[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @ApiPropertyOptional({ example: 4, description: "Number of weekly occurrences (2–12)" })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(12)
  recurrenceWeeks?: number;
}
