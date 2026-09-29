import { leadPrepareResponse, leadSignatureResponse, leadConfirmResponse, leadDetailResponse, manualConflictResponse } from "src/common/openapi/flow-responses";
import { LeadStudentInvitationService } from "../service/lead-student-invitation.service";
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Permissions } from "src/modules/admin/auth/rbac/permissions.decorator";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { LEAD_PERMISSION } from "../domain/lead.constants";
import { ExpertLeadService } from "../service/expert-lead.service";
import { LeadContractService } from "../service/lead-contract.service";
import { LeadGuestMeetingService } from "../service/lead-guest-meeting.service";
import { ExpertFollowUpDto, ExpertQuestionnaireDto } from "./dto/sales/sales-v2.dto";
import { ExpertLeadFiltersDto, ExpertLeadQueryDto } from "./dto/sales/expert-lead-query.dto";
import { PrepareLeadContractDto } from "./dto/sales/prepare-lead-contract.dto";
import { ConfirmManualContractDto, RecordContractSignatureDto } from "src/modules/contract/api/dto/manual-contract.dto";
/** Exposes assigned-lead workflows to authenticated experts with lead-call permission. */
@ApiTags("Expert Leads")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT")
@Permissions(LEAD_PERMISSION.RESPOND_EXPERT_CALL)
@Controller("expert/leads")
export class ExpertLeadController {
  constructor(
    private readonly leads: ExpertLeadService,
    private readonly contracts: LeadContractService,
    private readonly meetings: LeadGuestMeetingService,
    private readonly invitations: LeadStudentInvitationService,
  ) {}
  /** Returns the authenticated expert paginated lead tab. */
  @Get() list(@Req() req: UserRequest, @Query() query: ExpertLeadQueryDto) {
    return this.leads.list(req.user.id, query);
  }
  /** Returns counters for the authenticated expert lead tabs. */
  @ApiOperation({
    summary: "Lead counters using the same search/source filters as the list",
    description: "CONTRACTS = SIGNING + SIGNED: these counters overlap and must not be summed as independent totals.",
  })
  @Get("summary")
  summary(@Req() req: UserRequest, @Query() query: ExpertLeadFiltersDto) {
    return this.leads.summary(req.user.id, query);
  }
  /** Returns a lead card only to its assigned expert. */
  @ApiResponse({ status: 200, schema: leadDetailResponse })
  @ApiResponse({ status: 409, schema: manualConflictResponse, description: "Business conflict; inspect code when present" })
  @Get(":id")
  detail(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.leads.detail(req.user.id, id);
  }
  /** Marks the beginning of work with a card independently of meeting confirmation. */
  @Post(":id/start") start(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.leads.start(req.user.id, id);
  }
  /** Saves partial Expert questionnaire fields on an editable assigned lead. */
  @Patch(":id/questionnaire") questionnaire(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: ExpertQuestionnaireDto) {
    return this.leads.saveQuestionnaire(req.user.id, id, dto);
  }
  /** Returns the consultation outcome to Sales follow-up. */
  @Post(":id/follow-up") followUp(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: ExpertFollowUpDto) {
    return this.leads.followUp(req.user.id, id, dto);
  }
  /** Saves a pre-account draft and moves the lead to signing. */
  @ApiResponse({ status: 201, schema: leadPrepareResponse })
  @ApiResponse({ status: 409, schema: manualConflictResponse, description: "Business conflict; inspect code when present" })
  @Post(":id/contract")
  contract(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: PrepareLeadContractDto) {
    return this.contracts.prepare(req.user.id, id, dto);
  }
  @ApiResponse({ status: 200, schema: leadPrepareResponse })
  @ApiResponse({ status: 409, schema: manualConflictResponse, description: "Business conflict; inspect code when present" })
  @Patch(":id/contract")
  updateContract(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: PrepareLeadContractDto) {
    return this.contracts.prepare(req.user.id, id, dto, true);
  }
  @ApiResponse({ status: 201, schema: leadSignatureResponse })
  @ApiResponse({ status: 409, schema: manualConflictResponse, description: "Business conflict; inspect code when present" })
  @Post(":id/contract/signature")
  signature(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: RecordContractSignatureDto) {
    return this.contracts.recordSignature(req.user.id, id, dto);
  }
  @ApiResponse({ status: 201, schema: leadConfirmResponse })
  @ApiResponse({ status: 409, schema: manualConflictResponse, description: "Business conflict; inspect code when present" })
  @Post(":id/contract/confirm")
  confirmContract(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: ConfirmManualContractDto) {
    return this.contracts.confirm(req.user.id, id, dto);
  }
  /** Requests another activation email for the student linked to this expert lead. */
  @Post(":id/student-invitation/resend") resend(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.invitations.resend(req.user.id, id);
  }
  /** Returns short-lived moderator access for the assigned expert meeting. */
  @Post("calls/:id/access") access(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.meetings.expertAccess(req.user.id, id);
  }
}
