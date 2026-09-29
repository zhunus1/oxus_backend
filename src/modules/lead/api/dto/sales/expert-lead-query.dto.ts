import { ApiPropertyOptional, OmitType, PickType } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { SalesLeadQueryDto } from "./sales-lead-query.dto";

export class ExpertLeadFiltersDto extends PickType(SalesLeadQueryDto, ["search", "source"] as const) {}
/** Validates Expert tab selection, source filtering, and pagination. */
export class ExpertLeadQueryDto extends OmitType(SalesLeadQueryDto, ["status"] as const) {
  @ApiPropertyOptional({
    enum: ["NEW", "FOLLOW_UP", "SIGNING", "SIGNED", "CONTRACTS", "ARCHIVE"],
    default: "NEW",
    description: "All tabs: latest stage entry first, then ID descending. CONTRACTS is the legacy combined view.",
  })
  @IsOptional()
  @IsIn(["NEW", "FOLLOW_UP", "SIGNING", "SIGNED", "CONTRACTS", "ARCHIVE"])
  tab: "NEW" | "FOLLOW_UP" | "SIGNING" | "SIGNED" | "CONTRACTS" | "ARCHIVE" = "NEW";
}
