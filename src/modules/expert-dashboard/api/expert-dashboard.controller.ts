import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ExpertDashboardService } from "../service/expert-dashboard.service";
import { KanbanQueryDto } from "./dto/kanban-query.dto";
import { StaleCommentDto } from "./dto/stale-comment.dto";

@ApiTags("Expert Dashboard")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT")
@Controller("expert/dashboard")
export class ExpertDashboardController {
  constructor(private readonly dashboardService: ExpertDashboardService) {}

  @ApiOperation({ summary: "Get kanban board with assigned students grouped by process step" })
  @ApiResponse({ status: 200, description: "Kanban board fetched successfully" })
  @Get("kanban")
  async getKanban(@Req() req: UserRequest, @Query() query: KanbanQueryDto) {
    return this.dashboardService.getKanban(req.user.id, query);
  }

  @ApiOperation({ summary: "Get stale students (no status change > 10 days)" })
  @ApiResponse({ status: 200, description: "Stale students fetched successfully" })
  @Get("stale")
  async getStaleStudents(@Req() req: UserRequest) {
    return this.dashboardService.getStaleStudents(req.user.id);
  }

  @ApiOperation({ summary: "Add mandatory comment on stale student" })
  @ApiResponse({ status: 200, description: "Comment added successfully" })
  @Post("stale/:portraitId/comment")
  async addStaleComment(@Req() req: UserRequest, @Param("portraitId", ParseIntPipe) portraitId: number, @Body() dto: StaleCommentDto) {
    return this.dashboardService.addStaleComment(req.user.id, portraitId, dto);
  }

  @ApiOperation({ summary: "Get student's answers for a specific test" })
  @ApiResponse({ status: 200, description: "Student answers fetched successfully" })
  @Get("students/:studentId/tests/:testId/answers")
  async getStudentTestAnswers(@Req() req: UserRequest, @Param("studentId", ParseIntPipe) studentId: number, @Param("testId", ParseIntPipe) testId: number) {
    return this.dashboardService.getStudentTestAnswers(req.user.id, studentId, testId);
  }
}
