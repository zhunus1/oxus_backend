import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";

import { PortraitService } from "../service/portrait.service";
import { StudentPortraitQueryDto } from "./dto/student-portrait-query.dto";
import { UpdatePortraitKycLockDto } from "./dto/update-portrait-kyc-lock.dto";
import { UpdatePortraitSubscriptionDto } from "./dto/update-portrait-subscription.dto";
import { UpdatePortraitProcessStepDto } from "./dto/update-portrait-process-step.dto";
import { UpdateTargetProgramStatusDto } from "./dto/update-target-program-status.dto";
import { CreateTargetProgramDto } from "src/modules/target-program/api/dto/create-target-program.dto";

@ApiTags("Expert - Portraits")
@UseGuards(JwtAuthGuard)
@Controller("expert/portraits")
export class PortraitController {
  constructor(private readonly portraitService: PortraitService) {}

  @ApiOperation({ summary: "Get all student portraits (expert)" })
  @ApiResponse({ status: 200, description: "Student portraits fetched successfully" })
  @Get()
  async findMany(@Query() query: StudentPortraitQueryDto) {
    return this.portraitService.findMany(query);
  }

  @ApiOperation({ summary: "Get student portrait by id (expert)" })
  @ApiResponse({ status: 200, description: "Student portrait fetched successfully" })
  @ApiResponse({ status: 404, description: "Student portrait not found" })
  @Get(":id")
  async findById(@Param("id", ParseIntPipe) id: number) {
    return this.portraitService.findById(id);
  }
  @ApiOperation({ summary: "Update KYC lock for student portrait" })
  @ApiResponse({ status: 200, description: "KYC lock updated successfully" })
  @ApiResponse({ status: 404, description: "Student portrait not found" })
  @Patch(":id/kyc-lock")
  async updateKycLock(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdatePortraitKycLockDto) {
    return this.portraitService.updateKycLock(id, dto);
  }

  @ApiOperation({ summary: "Update subscription and consultation balance" })
  @ApiResponse({ status: 200, description: "Subscription updated successfully" })
  @ApiResponse({ status: 404, description: "Student portrait not found" })
  @Patch(":id/subscription")
  async updateSubscription(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdatePortraitSubscriptionDto) {
    return this.portraitService.updateSubscription(id, dto, req.user.id);
  }

  @ApiOperation({ summary: "Get full 360° student profile" })
  @ApiResponse({ status: 200, description: "Full profile fetched successfully" })
  @ApiResponse({ status: 404, description: "Student portrait not found" })
  @Get(":id/full")
  async findFullProfile(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.portraitService.findFullProfile(req.user.id, req.user.roleCode, id);
  }

  @ApiOperation({ summary: "Add a target program for this student (assigned expert or admin)" })
  @ApiResponse({ status: 201, description: "Target program created" })
  @HttpCode(HttpStatus.CREATED)
  @Post(":id/target-programs")
  async createTargetProgram(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: CreateTargetProgramDto) {
    return this.portraitService.createTargetProgramForPortrait(req.user.id, req.user.roleCode, id, dto);
  }

  @ApiOperation({ summary: "Update student pipeline step (ProcessStep) — assigned expert or admin" })
  @ApiResponse({ status: 200, description: "Process step updated" })
  @Patch(":id/status")
  async updatePortraitProcessStep(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdatePortraitProcessStepDto) {
    return this.portraitService.updatePortraitProcessStep(req.user.id, req.user.roleCode, id, dto);
  }

  @ApiOperation({ summary: "Update application status on target program (assigned expert or admin)" })
  @Patch(":id/target-programs/:tpId/status")
  async updateTargetProgramStatus(
    @Req() req: UserRequest,
    @Param("id", ParseIntPipe) id: number,
    @Param("tpId", ParseIntPipe) tpId: number,
    @Body() dto: UpdateTargetProgramStatusDto,
  ) {
    return this.portraitService.updateTargetProgramStatus(req.user.id, req.user.roleCode, id, tpId, dto);
  }

  @ApiOperation({ summary: "Get audit log for student portrait" })
  @ApiResponse({ status: 200, description: "Audit logs fetched successfully" })
  @Get(":id/audit-log")
  async findAuditLogs(@Param("id", ParseIntPipe) id: number) {
    return this.portraitService.findAuditLogs(id);
  }
}
