import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { CreateOrganisationRequestDto } from "./dto/create-organisation-request.dto";
import { QueryOrganisationRequestDto } from "./dto/query-organisation-request.dto";
import { ResolveOrganisationRequestDto } from "./dto/resolve-organisation-request.dto";
import { ReviewOrganisationRequestDto } from "./dto/review-organisation-request.dto";
import { OrganisationRequestService } from "../service/organisation-request.service";

@ApiTags("Organisation Requests")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class OrganisationRequestController {
  constructor(private readonly organisationRequestService: OrganisationRequestService) {}

  @Post("expert/organisation-requests")
  @Roles("EXPERT")
  @ApiOperation({ summary: "Create a request for a university that is missing from the platform" })
  async create(@Req() req: UserRequest, @Body() dto: CreateOrganisationRequestDto) {
    return this.organisationRequestService.create(req.user.id, dto);
  }

  @Get("expert/organisation-requests")
  @Roles("EXPERT")
  @ApiOperation({ summary: "List the current expert's organisation requests" })
  async listMine(@Req() req: UserRequest, @Query() query: QueryOrganisationRequestDto) {
    return this.organisationRequestService.listMine(req.user.id, query);
  }

  @Get("expert/organisation-requests/:id")
  @Roles("EXPERT")
  @ApiOperation({ summary: "Get one organisation request belonging to the current expert" })
  async findMineById(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.organisationRequestService.findMineById(id, req.user.id);
  }

  @Get("admin/organisation-requests")
  @Roles("ADMIN")
  @ApiOperation({ summary: "List organisation requests for admins" })
  async listAll(@Query() query: QueryOrganisationRequestDto) {
    return this.organisationRequestService.listAll(query);
  }

  @Get("admin/organisation-requests/:id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Get organisation request details for admins" })
  async findById(@Param("id", ParseIntPipe) id: number) {
    return this.organisationRequestService.findById(id);
  }

  @Post("admin/organisation-requests/:id/approve")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Approve an organisation request" })
  async approve(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: ReviewOrganisationRequestDto) {
    return this.organisationRequestService.approve(id, req.user.id, dto);
  }

  @Post("admin/organisation-requests/:id/reject")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Reject an organisation request" })
  async reject(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: ReviewOrganisationRequestDto) {
    return this.organisationRequestService.reject(id, req.user.id, dto);
  }

  @Post("admin/organisation-requests/:id/resolve")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Resolve an organisation request to an imported organisation" })
  async resolve(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: ResolveOrganisationRequestDto) {
    return this.organisationRequestService.resolve(id, req.user.id, dto);
  }
}
