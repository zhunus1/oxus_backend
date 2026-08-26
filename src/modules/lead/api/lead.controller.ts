import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { LeadService } from "../service/lead.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { LeadEntity } from "./dto/lead.entity";
import { Public } from "src/modules/admin/auth/rbac/public.decorator";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";

@ApiTags("Leads")
@Controller("leads")
export class LeadController {
  constructor(private readonly service: LeadService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Submit a pre-login lead (contact form)" })
  @ApiBody({ type: CreateLeadDto })
  @ApiResponse({ status: 201, description: "Lead created successfully" })
  async create(@Body() dto: CreateLeadDto): Promise<LeadEntity> {
    return this.service.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EXPERT", "ADMIN")
  @Get()
  @ApiOperation({ summary: "Get all leads (experts and admins only)" })
  @ApiResponse({ status: 200, description: "List of all leads" })
  async findAll(): Promise<LeadEntity[]> {
    return this.service.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EXPERT", "ADMIN")
  @Patch(":id/contact")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Toggle contacted status for a lead" })
  @ApiResponse({ status: 200, description: "Lead contact status toggled" })
  async markContacted(@Param("id", ParseIntPipe) id: number, @Req() req: UserRequest): Promise<LeadEntity> {
    return this.service.markContacted(id, req.user.id);
  }
}
