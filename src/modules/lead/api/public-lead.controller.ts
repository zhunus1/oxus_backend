import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Public } from "src/modules/admin/auth/rbac/public.decorator";
import { LandingCalculatorSubmissionDto } from "./dto/sales/landing-calculator-submission.dto";
import { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import { LeadIngestionService } from "../service/lead-ingestion.service";
import { ExpressSubmissionDto } from "./dto/express-submission.dto";

@ApiTags("Public Lead Sources")
@Controller("public/lead-sources")
export class PublicLeadController {
  constructor(
    private readonly ingestion: LeadIngestionService,
    private readonly realtime: LeadRealtimeGateway,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ "public-lead-submission": { limit: 30, ttl: 60_000 } })
  @Post("landing-calculator/submissions")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a lead from the public landing calculator" })
  @ApiResponse({ status: 201, description: "Submission accepted" })
  async submitLandingCalculator(@Body() dto: LandingCalculatorSubmissionDto) {
    const result = await this.ingestion.ingestLanding(dto);
    if (result.created) this.realtime.emitLeadCreated(result.lead);
    return { leadId: result.lead.id, created: result.created };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ "public-lead-submission": { limit: 30, ttl: 60_000 } })
  @Post("express/submissions")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Create a student lead from the public Express questionnaire",
    description:
      "Optionally provide score (0–1000), percent (0–100) and universities (0–10000) together as integers. Results are saved without recalculation. If all three are omitted, no metrics are stored. Reusing submissionId returns the original lead without updating its results.",
  })
  @ApiResponse({
    status: 201,
    description: "Submission accepted; created is false when the submissionId has already been received",
    schema: { type: "object", required: ["leadId", "created"], properties: { leadId: { type: "integer" }, created: { type: "boolean" } } },
  })
  @ApiResponse({ status: 400, description: "Invalid questionnaire or unknown country IDs" })
  @ApiResponse({ status: 404, description: "Express lead source is not active" })
  @ApiResponse({ status: 413, description: "Submission payload exceeds the size limit" })
  @ApiResponse({ status: 429, description: "Too many submissions" })
  async submitExpress(@Body() dto: ExpressSubmissionDto) {
    const result = await this.ingestion.ingestExpress(dto);
    if (result.created) this.realtime.emitLeadCreated(result.lead);
    return { leadId: result.lead.id, created: result.created };
  }
}
