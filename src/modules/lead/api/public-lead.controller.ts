import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Public } from "src/modules/admin/auth/rbac/public.decorator";
import { LandingCalculatorSubmissionDto } from "./dto/sales/landing-calculator-submission.dto";
import { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import { LeadIngestionService } from "../service/lead-ingestion.service";

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
}
