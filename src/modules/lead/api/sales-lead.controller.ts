import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Permissions } from "src/modules/admin/auth/rbac/permissions.decorator";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { LEAD_PERMISSION, SALES_MANAGER_ROLE } from "../domain/lead.constants";
import { SalesLeadService } from "../service/sales-lead.service";
import { CreateLeadCallbackDto } from "./dto/sales/create-lead-callback.dto";
import { CreateManualLeadDto } from "./dto/sales/create-manual-lead.dto";
import { RejectLeadDto } from "./dto/sales/reject-lead.dto";
import { SalesLeadQueryDto } from "./dto/sales/sales-lead-query.dto";
import { UpdateLeadCallbackDto } from "./dto/sales/update-lead-callback.dto";
import { CreateLeadExpertCallDto } from "./dto/sales/create-lead-expert-call.dto";
import { LeadExpertCallService } from "../service/lead-expert-call.service";
import { SalesExpertQueryDto } from "./dto/sales/sales-expert-query.dto";
import { UpdateLeadExpertCallDto } from "./dto/sales/update-lead-expert-call.dto";

@ApiTags("Sales Leads")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SALES_MANAGER_ROLE)
@Controller("sales")
export class SalesLeadController {
  constructor(
    private readonly service: SalesLeadService,
    private readonly expertCallService: LeadExpertCallService,
  ) {}

  @Get("leads")
  @Permissions(LEAD_PERMISSION.READ_UNASSIGNED)
  @ApiOperation({ summary: "List leads visible to the current Sales Manager" })
  list(@Req() req: UserRequest, @Query() query: SalesLeadQueryDto) {
    return this.service.list(req.user.id, query);
  }

  @Get("leads/summary")
  @Permissions(LEAD_PERMISSION.READ_UNASSIGNED)
  summary(@Req() req: UserRequest) {
    return this.service.summary(req.user.id);
  }

  @Get("lead-sources")
  @Permissions(LEAD_PERMISSION.READ_UNASSIGNED)
  sources() {
    return this.service.sources();
  }

  @Get("experts")
  @Permissions(LEAD_PERMISSION.READ_EXPERT_SLOTS)
  experts(@Query() query: SalesExpertQueryDto) {
    return this.expertCallService.listExperts(query);
  }

  @Post("leads")
  @Permissions(LEAD_PERMISSION.CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create an unassigned office lead" })
  createManual(@Req() req: UserRequest, @Body() dto: CreateManualLeadDto) {
    return this.service.createManual(req.user.id, dto);
  }

  @Get("leads/:id")
  @Permissions(LEAD_PERMISSION.READ_UNASSIGNED)
  detail(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.service.detail(req.user.id, id);
  }

  @Post("leads/:id/accept")
  @Permissions(LEAD_PERMISSION.ACCEPT)
  @HttpCode(HttpStatus.OK)
  accept(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.service.accept(req.user.id, id);
  }

  @Post("leads/:id/callbacks")
  @Permissions(LEAD_PERMISSION.MANAGE_OWN)
  @HttpCode(HttpStatus.CREATED)
  createCallback(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: CreateLeadCallbackDto) {
    return this.service.createCallback(req.user.id, id, dto);
  }

  @Patch("leads/:id/callbacks/:callbackId")
  @Permissions(LEAD_PERMISSION.MANAGE_OWN)
  updateCallback(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Param("callbackId", ParseIntPipe) callbackId: number, @Body() dto: UpdateLeadCallbackDto) {
    return this.service.updateCallback(req.user.id, id, callbackId, dto);
  }

  @Post("leads/:id/reject")
  @Permissions(LEAD_PERMISSION.MANAGE_OWN)
  reject(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: RejectLeadDto) {
    return this.service.reject(req.user.id, id, dto.reason);
  }

  @Post("leads/:id/expert-calls")
  @Permissions(LEAD_PERMISSION.MANAGE_OWN)
  @HttpCode(HttpStatus.CREATED)
  createExpertCall(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: CreateLeadExpertCallDto) {
    return this.expertCallService.create(req.user.id, id, dto);
  }

  @Patch("leads/:id/expert-calls/:callId")
  @Permissions(LEAD_PERMISSION.MANAGE_OWN)
  updateExpertCall(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Param("callId", ParseIntPipe) callId: number, @Body() dto: UpdateLeadExpertCallDto) {
    return this.expertCallService.update(req.user.id, id, callId, dto);
  }

  @Get("leads/:id/activities")
  @Permissions(LEAD_PERMISSION.READ_UNASSIGNED)
  activities(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.service.activities(req.user.id, id);
  }
}
