import { ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { SalesLeadQueryDto } from "./sales-lead-query.dto";
/** Validates Expert tab selection, source filtering, and pagination. */
export class ExpertLeadQueryDto extends OmitType(SalesLeadQueryDto, ["status"] as const) {
  @ApiPropertyOptional({
    enum: ["NEW", "FOLLOW_UP", "CONTRACTS", "ARCHIVE"],
    default: "NEW",
    description: "NEW: latest lead status change first (then ID descending). Other tabs: latest creation first.",
  })
  @IsOptional()
  @IsIn(["NEW", "FOLLOW_UP", "CONTRACTS", "ARCHIVE"])
  tab: "NEW" | "FOLLOW_UP" | "CONTRACTS" | "ARCHIVE" = "NEW";
}
