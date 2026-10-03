import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, Max, Min, ValidateIf } from "class-validator";

/** JSON integers only: coercing booleans or blank strings would fabricate valid results. */
export class FrontendLeadMetricsDto {
  @ApiPropertyOptional({ type: "integer", minimum: 0, maximum: 1000, description: "Frontend result; send score, percent and universities together or omit all three" })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(1000)
  score?: number;

  @ApiPropertyOptional({ type: "integer", minimum: 0, maximum: 100, description: "Frontend result; required when score or universities is supplied" })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100)
  percent?: number;

  @ApiPropertyOptional({ type: "integer", minimum: 0, maximum: 10000, description: "Frontend result; required when score or percent is supplied" })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(10000)
  universities?: number;
}
