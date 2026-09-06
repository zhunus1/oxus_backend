import { ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { SalesLeadQueryDto } from "./sales-lead-query.dto";
/** Validates Expert tab selection, source filtering, and pagination. */
export class ExpertLeadQueryDto extends OmitType(SalesLeadQueryDto, ["status"] as const) {
  @ApiPropertyOptional({ enum: ["NEW", "FOLLOW_UP", "CONTRACTS", "ARCHIVE"], default: "NEW" })
  @IsOptional()
  @IsIn(["NEW", "FOLLOW_UP", "CONTRACTS", "ARCHIVE"])
  tab: "NEW" | "FOLLOW_UP" | "CONTRACTS" | "ARCHIVE" = "NEW";
}
