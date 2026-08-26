import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { TargetProgramService } from "../service/target-program.service";
import { CreateTargetProgramDto } from "./dto/create-target-program.dto";
import { UpdateTargetProgramDto } from "./dto/update-target-program.dto";
import { StudentPortraitService } from "src/modules/studentportrait/service/studentportrait.service";

@ApiTags("Target Programs")
@UseGuards(JwtAuthGuard)
@Controller("target-programs")
export class TargetProgramController {
  constructor(
    private readonly targetProgramService: TargetProgramService,
    private readonly studentPortraitService: StudentPortraitService,
  ) {}

  private async getPortraitId(userId: number): Promise<number> {
    const portrait = await this.studentPortraitService.findMe(userId);
    return portrait.id;
  }

  @ApiOperation({ summary: "Create a target program" })
  @ApiResponse({ status: 201, description: "Target program created successfully" })
  @Post()
  async create(@Req() req: UserRequest, @Body() dto: CreateTargetProgramDto) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.targetProgramService.create(req.user.id, portraitId, dto);
  }

  @ApiOperation({ summary: "Get my target programs" })
  @ApiResponse({ status: 200, description: "Target programs fetched successfully" })
  @Get("me")
  async findMy(@Req() req: UserRequest) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.targetProgramService.findMyPrograms(portraitId);
  }

  @ApiOperation({ summary: "Get target program by id" })
  @ApiResponse({ status: 200, description: "Target program fetched successfully" })
  @ApiResponse({ status: 404, description: "Target program not found" })
  @Get(":id")
  async findById(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.targetProgramService.findById(portraitId, id);
  }

  @ApiOperation({ summary: "Update target program" })
  @ApiResponse({ status: 200, description: "Target program updated successfully" })
  @ApiResponse({ status: 404, description: "Target program not found" })
  @Patch(":id")
  async update(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateTargetProgramDto) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.targetProgramService.update(req.user.id, portraitId, id, dto);
  }

  @ApiOperation({ summary: "Delete target program" })
  @ApiResponse({ status: 200, description: "Target program deleted successfully" })
  @ApiResponse({ status: 404, description: "Target program not found" })
  @Delete(":id")
  async delete(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.targetProgramService.delete(req.user.id, portraitId, id);
  }
}
