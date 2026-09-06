import { LeadStudentInvitationService } from "../service/lead-student-invitation.service";
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
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
import { ExpertLeadQueryDto } from "./dto/sales/expert-lead-query.dto";
import { PrepareLeadContractDto } from "./dto/sales/prepare-lead-contract.dto";
/** Exposes assigned-lead workflows to authenticated experts with lead-call permission. */
@ApiTags("Expert Leads")
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
  @Get("summary") summary(@Req() req: UserRequest) {
    return this.leads.summary(req.user.id);
  }
  /** Returns a lead card only to its assigned expert. */
  @Get(":id") detail(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
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
  /** Prepares the agreed contract and creates or explicitly reuses the student account. */
  @Post(":id/contract") contract(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: PrepareLeadContractDto) {
    return this.contracts.prepare(req.user.id, id, dto);
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
