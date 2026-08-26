import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ConsultationService } from "../service/consultation.service";

@ApiTags("Student Meetings")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STUDENT")
@Controller("student")
export class StudentMeetingsController {
  constructor(private readonly consultationService: ConsultationService) {}

  @ApiOperation({ summary: "Get all booked meetings for current student" })
  @ApiResponse({ status: 200, description: "Student meetings fetched successfully" })
  @Get("meetings")
  async findMyMeetings(@Req() req: UserRequest) {
    return this.consultationService.findMyConsultations(req.user.id);
  }
}
