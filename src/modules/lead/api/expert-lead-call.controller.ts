import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Permissions } from "src/modules/admin/auth/rbac/permissions.decorator";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { LEAD_PERMISSION } from "../domain/lead.constants";
import { LeadExpertCallService } from "../service/lead-expert-call.service";
import { ExpertLeadCallQueryDto } from "./dto/sales/expert-lead-call-query.dto";
import { RespondLeadExpertCallDto } from "./dto/sales/respond-lead-expert-call.dto";

@ApiTags("Expert Lead Calls")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT")
@Permissions(LEAD_PERMISSION.RESPOND_EXPERT_CALL)
@Controller("expert/lead-calls")
export class ExpertLeadCallController {
  constructor(private readonly service: LeadExpertCallService) {}

  @Get()
  list(@Req() req: UserRequest, @Query() query: ExpertLeadCallQueryDto) {
    return this.service.listForExpert(req.user.id, query);
  }

  @Get("pending")
  pending(@Req() req: UserRequest) {
    return this.service.pendingForExpert(req.user.id);
  }

  @Get(":id")
  detail(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.service.detailForExpert(req.user.id, id);
  }

  @Patch(":id/respond")
  respond(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: RespondLeadExpertCallDto) {
    return this.service.respond(req.user.id, id, dto);
  }
}
