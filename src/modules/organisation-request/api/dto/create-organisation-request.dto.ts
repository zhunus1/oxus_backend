import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import messages from "src/configs/messages";

export class CreateOrganisationRequestDto {
  @ApiProperty({ example: "Imperial College London" })
  @IsString({ message: messages.MUST_BE_STRING("universityName") })
  universityName: string;

  @ApiPropertyOptional({ example: "United Kingdom" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("countryName") })
  countryName?: string;

  @ApiPropertyOptional({ example: "Need this university and its programs for a student shortlist." })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("notes") })
  notes?: string;
}
