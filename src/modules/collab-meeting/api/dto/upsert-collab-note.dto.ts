import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class UpsertCollabNoteDto {
  @ApiProperty({ example: "Key points from the meeting..." })
  @IsString()
  content: string;
}
