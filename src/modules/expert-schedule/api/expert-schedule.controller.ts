import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ExpertScheduleService } from "../service/expert-schedule.service";
import { UpdateExpertScheduleDto } from "./dto/update-expert-schedule.dto";

@ApiTags("Expert Schedule")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT")
@Controller("expert/schedule")
export class ExpertScheduleController {
  constructor(private readonly service: ExpertScheduleService) {}

  @ApiOperation({ summary: "Get my weekly schedule" })
  @ApiResponse({ status: 200, description: "Schedule fetched successfully" })
  @Get()
  async getMySchedule(@Req() req: UserRequest) {
    return this.service.getMySchedule(req.user.id);
  }

  @ApiOperation({ summary: "Replace my weekly schedule" })
  @ApiResponse({ status: 200, description: "Schedule updated successfully" })
  @Put()
  async updateMySchedule(@Req() req: UserRequest, @Body() dto: UpdateExpertScheduleDto) {
    return this.service.updateMySchedule(req.user.id, dto);
  }
}
