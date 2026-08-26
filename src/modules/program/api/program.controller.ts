import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { ProgramService } from "../service/program.service";
import { QueryProgramDto } from "./dto/query-program.dto";
import { ProgramDetailEntity, ProgramEntity } from "./dto/program.entity";
import { UpdateProgramDeadlineDto } from "./dto/update-program-deadline.dto";
import { CreateProgramDto } from "./dto/create-program.dto";
import { UpdateProgramDto } from "./dto/update-program.dto";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";

@ApiTags("Program")
@UseGuards(JwtAuthGuard)
@Controller("program")
export class ProgramController {
  constructor(private readonly service: ProgramService) {}

  @ApiOperation({ summary: "Get all programs with optional filters" })
  @ApiResponse({ status: 200, description: "List of programs", type: [ProgramEntity] })
  @Get()
  findAll(@Query() query: QueryProgramDto): Promise<ProgramEntity[]> {
    return this.service.findAll(query);
  }

  @ApiOperation({
    summary:
      "Get program details by ID including organisation, requirements and deadline. Logs PROGRAM_VIEWED for the current user unless trackView=false (e.g. bulk/recommendation fetches).",
  })
  @ApiParam({ name: "id", type: Number })
  @ApiResponse({ status: 200, description: "Program detail", type: ProgramDetailEntity })
  @ApiResponse({ status: 404, description: "Program not found" })
  @Get(":id")
  findById(@Param("id", ParseIntPipe) id: number, @Req() req: UserRequest, @Query("trackView") trackViewRaw?: string): Promise<ProgramDetailEntity> {
    const logView = trackViewRaw !== "false" && trackViewRaw !== "0";
    return this.service.findById(id, logView ? req.user.id : undefined);
  }

  @ApiOperation({ summary: "Manually update a program deadline" })
  @ApiResponse({ status: 200, description: "Program deadline updated", type: ProgramDetailEntity })
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "EXPERT")
  @Patch(":id/deadline")
  updateDeadline(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateProgramDeadlineDto): Promise<ProgramDetailEntity> {
    return this.service.updateDeadline(id, dto);
  }

  @ApiOperation({ summary: "Create a new program" })
  @ApiBody({ type: CreateProgramDto })
  @ApiResponse({ status: 201, description: "Program created", type: ProgramEntity })
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "EXPERT")
  @Post()
  create(@Body() dto: CreateProgramDto): Promise<ProgramEntity> {
    return this.service.create(dto);
  }

  @ApiOperation({ summary: "Update a program" })
  @ApiParam({ name: "id", type: Number })
  @ApiBody({ type: UpdateProgramDto })
  @ApiResponse({ status: 200, description: "Program updated", type: ProgramDetailEntity })
  @ApiResponse({ status: 404, description: "Program not found" })
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "EXPERT")
  @Patch(":id")
  updateById(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateProgramDto): Promise<ProgramDetailEntity> {
    return this.service.updateById(id, dto);
  }

  @ApiOperation({ summary: "Delete a program" })
  @ApiParam({ name: "id", type: Number })
  @ApiResponse({ status: 200, description: "Program deleted", type: ProgramEntity })
  @ApiResponse({ status: 404, description: "Program not found" })
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "EXPERT")
  @Delete(":id")
  deleteById(@Param("id", ParseIntPipe) id: number): Promise<ProgramEntity> {
    return this.service.deleteById(id);
  }
}
