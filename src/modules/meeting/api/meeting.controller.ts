import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JitsiService } from "../service/jitsi.service";
import { ConsultationService } from "src/modules/consultation/service/consultation.service";
import { BookConsultationDto } from "src/modules/consultation/api/dto/book-consultation.dto";

@ApiTags("Meeting")
@Controller("meetings")
@UseGuards(JwtAuthGuard)
export class MeetingController {
  constructor(
    private readonly jitsiService: JitsiService,
    private readonly consultationService: ConsultationService,
  ) {}

  @ApiOperation({ summary: "Book a meeting with assigned expert" })
  @ApiResponse({ status: 201, description: "Meeting booked successfully" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("STUDENT", "SCHOOLBOY")
  @Post("book")
  async book(@Req() req: UserRequest, @Body() dto: BookConsultationDto) {
    return this.consultationService.book(req.user.id, dto);
  }

  @ApiOperation({ summary: "Get meeting access data" })
  @ApiResponse({ status: 200, description: "Meeting access granted" })
  @Get(":id/access")
  async getAccess(@Param("id") id: string, @Req() req: UserRequest) {
    return this.jitsiService.generateToken(id, {
      userId: req.user.id,
      userName: `${req.user.firstname} ${req.user.lastname}`,
      userAvatar: "https://example.com",
    });
  }
}
