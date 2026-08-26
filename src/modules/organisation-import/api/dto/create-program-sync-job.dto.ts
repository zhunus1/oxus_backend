import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class CreateProgramSyncJobDto {
  @ApiPropertyOptional({
    example: "https://www.tum.de/en/studies",
    description: "Optional official starting page. If omitted, the service will use Organisation.websiteUrl or search for the official site.",
  })
  @IsOptional()
  @IsUrl()
  sourceUrl?: string;

  @ApiPropertyOptional({
    example: "Technical University of Munich official programs degrees admissions",
    description: "Optional search query override used by the AI-powered discovery step.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  searchQuery?: string;
}
