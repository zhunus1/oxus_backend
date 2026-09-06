import { SalesLeadService } from "../service/sales-lead.service";
import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Permissions } from "src/modules/admin/auth/rbac/permissions.decorator";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { GetAvailableSlotsDto } from "src/modules/expert-schedule/api/dto/get-available-slots.dto";
import { LEAD_PERMISSION, SALES_MANAGER_ROLE } from "../domain/lead.constants";
import { CalculatorQuestionnaireService } from "../service/calculator-questionnaire.service";
import { ManualLeadV2Service } from "../service/manual-lead-v2.service";
import { LeadAvailabilityService } from "../service/lead-availability.service";
import { LeadExpertCallService } from "../service/lead-expert-call.service";
import { CalculatorAnswersDto, CreateManualLeadV2Dto, PreviewLeadMeetingDto, SaveLeadMeetingDto } from "./dto/sales/sales-v2.dto";

/** Exposes Sales-only questionnaire and consultation workflows using existing lead permissions. */
@ApiTags("Sales v2")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SALES_MANAGER_ROLE)
@Controller("sales/v2")
export class SalesV2Controller {
  constructor(
    private readonly manual: ManualLeadV2Service,
    private readonly calculator: CalculatorQuestionnaireService,
    private readonly availability: LeadAvailabilityService,
    private readonly meetings: LeadExpertCallService,
    private readonly sales: SalesLeadService,
  ) {}
  /** Returns status counts and combines online and office consultations into the design card. */
  @Get("leads/summary")
  @Permissions(LEAD_PERMISSION.READ_UNASSIGNED)
  async summary(@Req() req: UserRequest) {
    const counts = await this.sales.summary(req.user.id);
    return { counts, cards: { newLeads: counts.NEW, consultations: counts.CALL_SCHEDULED + counts.OFFICE_INVITED, callbacks: counts.RECALL, rejected: counts.REJECTED } };
  }
  /** Returns the versioned calculator form definitions for manual entry. */
  @Get("questionnaires/calculator")
  @Permissions(LEAD_PERMISSION.CREATE)
  questionnaire() {
    return this.calculator.definition();
  }
  /** Previews questionnaire scoring without saving a lead. */
  @Post("questionnaires/calculator/preview")
  @Permissions(LEAD_PERMISSION.CREATE)
  calculate(@Body() dto: CalculatorAnswersDto) {
    return this.calculator.calculate(dto);
  }
  /** Creates a manual lead that must subsequently be opened and accepted by Sales. */
  @Post("leads")
  @Permissions(LEAD_PERMISSION.CREATE)
  create(@Req() req: UserRequest, @Body() dto: CreateManualLeadV2Dto) {
    return this.manual.create(req.user.id, dto);
  }
  /** Saves a questionnaire snapshot for the authenticated manager owned lead. */
  @Patch("leads/:id/questionnaire")
  @Permissions(LEAD_PERMISSION.MANAGE_OWN)
  answers(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: CalculatorAnswersDto) {
    return this.manual.saveAnswers(req.user.id, id, dto);
  }
  /** Returns the supported offices for consultation invitations. */
  @Get("offices")
  @Permissions(LEAD_PERMISSION.READ_EXPERT_SLOTS)
  offices() {
    return this.meetings.offices();
  }
  /** Returns expert-configured slots and their booking availability. */
  @Get("experts/:id/slots")
  @Permissions(LEAD_PERMISSION.READ_EXPERT_SLOTS)
  slots(@Param("id", ParseIntPipe) id: number, @Query() query: GetAvailableSlotsDto) {
    return this.availability.slots(id, query);
  }
  /** Creates a copyable invitation before booking the consultation. */
  @Post("leads/:id/meeting-preview")
  @Permissions(LEAD_PERMISSION.MANAGE_OWN)
  preview(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: PreviewLeadMeetingDto) {
    return this.meetings.preview(req.user.id, id, dto);
  }
  /** Books the referenced preview after rechecking ownership and availability. */
  @Post("leads/:id/meetings")
  @Permissions(LEAD_PERMISSION.MANAGE_OWN)
  save(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: SaveLeadMeetingDto) {
    return this.meetings.savePreview(req.user.id, id, dto.invitationId);
  }
  /** Cancels an unused preview owned by the authenticated manager. */
  @Delete("leads/:id/meeting-preview/:invitationId")
  @Permissions(LEAD_PERMISSION.MANAGE_OWN)
  cancel(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Param("invitationId", ParseUUIDPipe) invitationId: string) {
    return this.meetings.cancelPreview(req.user.id, id, invitationId);
  }
}
