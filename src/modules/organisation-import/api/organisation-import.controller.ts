import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { CreateProgramSyncJobDto } from "./dto/create-program-sync-job.dto";
import { CreateOrgSuggestionDto } from "./dto/create-org-suggestion.dto";
import { CreateProgramSuggestionDto } from "./dto/create-program-suggestion.dto";
import { QueryProgramSyncJobDto } from "./dto/query-program-sync-job.dto";
import { OrganisationImportService } from "../service/organisation-import.service";
import { OrganisationCatalogAgentService } from "../service/organisation-catalog-agent.service";

@ApiTags("Organisation Program Sync")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
@Controller("admin")
export class OrganisationImportController {
  constructor(
    private readonly organisationImportService: OrganisationImportService,
    private readonly organisationCatalogAgentService: OrganisationCatalogAgentService,
  ) {}

  @Post("organisations/:organisationId/program-sync-jobs")
  @ApiOperation({ summary: "Create and enqueue a program population job for an organisation" })
  @ApiResponse({ status: 201, description: "Program sync job created successfully" })
  async createProgramSyncJob(@Param("organisationId", ParseIntPipe) organisationId: number, @Req() req: UserRequest, @Body() dto: CreateProgramSyncJobDto) {
    return this.organisationImportService.createProgramSyncJob(organisationId, req.user.id, dto);
  }

  @Get("organisations/:organisationId/program-sync-jobs")
  @ApiOperation({ summary: "List program sync jobs for an organisation" })
  async listProgramSyncJobs(@Param("organisationId", ParseIntPipe) organisationId: number, @Query() query: QueryProgramSyncJobDto) {
    return this.organisationImportService.listProgramSyncJobs(organisationId, query);
  }

  @Get("program-sync-jobs/:jobId")
  @ApiOperation({ summary: "Get program sync job details" })
  async findProgramSyncJobById(@Param("jobId", ParseIntPipe) jobId: number) {
    return this.organisationImportService.findProgramSyncJobById(jobId);
  }

  @Post("organisation-suggestions")
  @ApiOperation({ summary: "Use AI web search to suggest organisations for import" })
  @ApiResponse({ status: 201, description: "List of organisation suggestions (not saved to DB)" })
  async suggestOrganisations(@Body() dto: CreateOrgSuggestionDto) {
    return this.organisationCatalogAgentService.suggestOrganisations(dto);
  }

  @Post("organisations/:organisationId/program-suggestions")
  @ApiOperation({ summary: "Use AI web search to suggest programs for a specific organisation" })
  @ApiResponse({ status: 201, description: "List of program suggestions (not saved to DB)" })
  async suggestPrograms(@Param("organisationId", ParseIntPipe) organisationId: number, @Body() dto: CreateProgramSuggestionDto) {
    return this.organisationImportService.suggestProgramsForOrg(organisationId, dto);
  }
}
