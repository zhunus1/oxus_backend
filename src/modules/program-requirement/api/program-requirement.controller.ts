import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ProgramRequirementService } from "../service/program-requirement.service";
import { CreateProgramRequirementDto } from "./dto/create-program-requirement.dto";
import { UpdateProgramRequirementDto } from "./dto/update-program-requirement.dto";

@ApiTags("Program Requirement")
@UseGuards(JwtAuthGuard)
@Controller()
export class ProgramRequirementController {
  constructor(private readonly programRequirementService: ProgramRequirementService) {}

  @ApiOperation({ summary: "Get requirements for a program" })
  @ApiResponse({ status: 200, description: "Program requirements fetched successfully" })
  @Get("programs/:programId/requirements")
  async findByProgramId(@Param("programId", ParseIntPipe) programId: number) {
    return this.programRequirementService.findByProgramId(programId);
  }

  @ApiOperation({ summary: "Create requirement for a program" })
  @ApiResponse({ status: 201, description: "Program requirement created successfully" })
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "EXPERT")
  @Post("programs/:programId/requirements")
  async create(@Param("programId", ParseIntPipe) programId: number, @Body() dto: CreateProgramRequirementDto) {
    return this.programRequirementService.create(programId, dto);
  }

  @ApiOperation({ summary: "Update a program requirement" })
  @ApiResponse({ status: 200, description: "Program requirement updated successfully" })
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "EXPERT")
  @Patch("program-requirements/:id")
  async update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateProgramRequirementDto) {
    return this.programRequirementService.update(id, dto);
  }

  @ApiOperation({ summary: "Delete a program requirement" })
  @ApiResponse({ status: 200, description: "Program requirement deleted successfully" })
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "EXPERT")
  @Delete("program-requirements/:id")
  async delete(@Param("id", ParseIntPipe) id: number) {
    return this.programRequirementService.delete(id);
  }

  @ApiOperation({ summary: "Get requirement submission status for my target program" })
  @ApiResponse({ status: 200, description: "Requirement status fetched successfully" })
  @Get("target-programs/:targetProgramId/requirements-status")
  async getRequirementStatus(@Param("targetProgramId", ParseIntPipe) targetProgramId: number, @Req() req: UserRequest) {
    return this.programRequirementService.getRequirementStatus(targetProgramId, req.user.id, req.user.roleCode);
  }
}
