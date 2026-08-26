import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class CreateProgramSuggestionDto {
  @ApiPropertyOptional({ example: "https://www.tum.de/en/studies" })
  @IsOptional()
  @IsUrl()
  sourceUrl?: string;

  @ApiPropertyOptional({ example: "TU Munich official degree programs" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  searchQuery?: string;
}
