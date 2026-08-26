import { Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Public } from "src/modules/admin/auth/rbac/public.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ExpertCatalogService } from "../service/expert-catalog.service";
import { ExpertCatalogQueryDto } from "./dto/expert-catalog-query.dto";

@ApiTags("Expert Catalog")
@UseGuards(JwtAuthGuard)
@Controller("experts")
export class ExpertCatalogController {
  constructor(private readonly expertCatalogService: ExpertCatalogService) {}

  @ApiOperation({ summary: "Browse expert catalog" })
  @ApiResponse({ status: 200, description: "Expert catalog fetched successfully" })
  @Public()
  @Get()
  async findMany(@Query() query: ExpertCatalogQueryDto) {
    return this.expertCatalogService.findMany(query);
  }

  @ApiOperation({
    summary: "List active expert peers excluding the current user (for transferring assigned students)",
  })
  @ApiResponse({ status: 200 })
  @UseGuards(RolesGuard)
  @Roles("EXPERT")
  @Get("list")
  async listExpertsForPeerTransfer(@Req() req: UserRequest) {
    return this.expertCatalogService.listExpertsForPeerTransfer(req.user.id);
  }

  @ApiOperation({ summary: "Get expert profile by id" })
  @ApiResponse({ status: 200, description: "Expert profile fetched successfully" })
  @Public()
  @Get(":id")
  async findById(@Param("id", ParseIntPipe) id: number) {
    return this.expertCatalogService.findById(id);
  }

  @ApiOperation({ summary: "Select expert for mentorship" })
  @ApiResponse({ status: 200, description: "Expert selected successfully" })
  @Post(":id/select")
  async selectExpert(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.expertCatalogService.selectExpert(req.user.id, id);
  }
}
