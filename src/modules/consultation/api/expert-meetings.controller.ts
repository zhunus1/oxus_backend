import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ConsultationService } from "../service/consultation.service";
import { ConsultationQueryDto } from "./dto/consultation-query.dto";
import { ExpertBookConsultationDto } from "./dto/expert-book-consultation.dto";
import { ExpertMeetingHistoryQueryDto } from "./dto/expert-meeting-history-query.dto";
import { RespondMeetingDto } from "./dto/respond-meeting.dto";

@ApiTags("Expert Meetings")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT")
@Controller("expert")
export class ExpertMeetingsController {
  constructor(private readonly consultationService: ConsultationService) {}

  @ApiOperation({ summary: "Schedule a consultation for an assigned student" })
  @ApiResponse({ status: 201, description: "Meeting booked successfully" })
  @HttpCode(HttpStatus.CREATED)
  @Post("meetings/book")
  async bookForStudent(@Req() req: UserRequest, @Body() dto: ExpertBookConsultationDto) {
    return this.consultationService.bookForStudentByExpert(req.user.id, dto);
  }

  @ApiOperation({ summary: "Confirm or decline a student-requested meeting" })
  @ApiParam({ name: "id", type: Number, description: "Consultation ID" })
  @ApiResponse({ status: 200, description: "Meeting status updated" })
  @Patch("meetings/:id/respond")
  async respondToMeeting(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: RespondMeetingDto) {
    return this.consultationService.respondToMeetingRequest(req.user.id, id, dto.action);
  }

  @ApiOperation({ summary: "Get all booked meetings for current expert" })
  @ApiResponse({ status: 200, description: "Expert meetings fetched successfully" })
  @Get("meetings")
  async findMyExpertMeetings(@Req() req: UserRequest, @Query() query: ConsultationQueryDto) {
    return this.consultationService.findMyExpertMeetings(req.user.id, query);
  }

  @ApiOperation({ summary: "Get every pending meeting request for current expert" })
  @ApiResponse({ status: 200, description: "Pending meeting requests fetched successfully" })
  @Get("meetings/pending")
  async findMyPendingExpertMeetings(@Req() req: UserRequest) {
    return this.consultationService.findMyPendingExpertMeetings(req.user.id);
  }

  @ApiOperation({ summary: "Get paginated non-pending meetings for current expert" })
  @ApiResponse({ status: 200, description: "Expert meeting history fetched successfully" })
  @Get("meetings/history")
  async findMyExpertMeetingHistory(@Req() req: UserRequest, @Query() query: ExpertMeetingHistoryQueryDto) {
    return this.consultationService.findMyExpertMeetingHistory(req.user.id, query);
  }
}
