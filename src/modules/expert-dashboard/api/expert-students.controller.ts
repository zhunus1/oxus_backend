import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ExpertDashboardService } from "../service/expert-dashboard.service";
import { ExpertStudentsQueryDto } from "./dto/expert-students-query.dto";
import { TransferStudentDto } from "./dto/transfer-student.dto";

@ApiTags("Expert — Students")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT")
@Controller("students")
export class ExpertStudentsController {
  constructor(private readonly dashboardService: ExpertDashboardService) {}

  @ApiOperation({
    summary: "Students assigned to the current expert (consultant)",
  })
  @ApiResponse({ status: 200, description: "Paginated assigned students" })
  @Get("assigned")
  async listAssigned(@Req() req: UserRequest, @Query() query: ExpertStudentsQueryDto) {
    return this.dashboardService.listAssignedStudents(req.user.id, query);
  }

  @ApiOperation({
    summary: "Registered students without an assigned expert yet",
  })
  @ApiResponse({ status: 200, description: "Paginated available students" })
  @Get("available")
  async listAvailable(@Query() query: ExpertStudentsQueryDto) {
    return this.dashboardService.listAvailableStudents(query);
  }

  @ApiOperation({ summary: "Claim a student portrait (assign current expert)" })
  @ApiResponse({ status: 200, description: "Student assigned successfully" })
  @ApiResponse({ status: 404, description: "Portrait not found or expert profile missing" })
  @ApiResponse({ status: 409, description: "Portrait already assigned to another expert" })
  @Patch(":portraitId/assign")
  async assign(@Req() req: UserRequest, @Param("portraitId", ParseIntPipe) portraitId: number) {
    return this.dashboardService.assignStudentPortrait(req.user.id, portraitId);
  }

  @ApiOperation({ summary: "Reassign portrait to another active expert user" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: "You are not the assigned expert on this portrait" })
  @ApiResponse({ status: 404, description: "Portrait or target expert not found" })
  @Patch(":portraitId/transfer")
  async transfer(@Req() req: UserRequest, @Param("portraitId", ParseIntPipe) portraitId: number, @Body() dto: TransferStudentDto) {
    return this.dashboardService.transferStudentPortrait(req.user.id, portraitId, dto.newExpertId);
  }
}
