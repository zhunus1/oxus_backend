import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class CreateOrgSuggestionDto {
  @ApiProperty({ example: "top universities in United Kingdom", description: "Search query for finding organisations" })
  @IsString()
  @MaxLength(500)
  searchQuery: string;

  @ApiPropertyOptional({ example: "https://unitap.org/universities", description: "Optional source URL to guide the AI search" })
  @IsOptional()
  @IsUrl()
  sourceUrl?: string;
}
