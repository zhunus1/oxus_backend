import { contractResponse, contractListResponse, onlineSigningConflict } from "src/common/openapi/flow-responses";
import { OnlineSigningDisabledGuard } from "./online-signing-disabled.guard";
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ContractService } from "../service/contract.service";
import { CreateContractForStudentDto } from "./dto/create-contract-for-student.dto";
import { UpdateContractMetaDto } from "./dto/update-contract-meta.dto";
import { ContractsQueryDto } from "./dto/contracts-query.dto";

/** Exposes expert contract operations with assigned-expert checks for CRM contracts. */
@ApiTags("Contract")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT", "ADMIN")
@Controller("contracts")
export class ExpertContractController {
  constructor(private readonly contractService: ContractService) {}

  @ApiOperation({ summary: "Create a contract for a student (expert/admin)" })
  @ApiResponse({ status: 201, description: "Contract created, pending manual confirmation", schema: contractResponse })
  @ApiBody({ type: CreateContractForStudentDto })
  @Post()
  async createContract(@Req() req: UserRequest, @Body() dto: CreateContractForStudentDto) {
    return this.contractService.createContractForStudent(dto, req.user.id);
  }

  /** Lists contracts using the authenticated expert CRM visibility scope. */
  @ApiOperation({ summary: "List contracts with pagination and optional status filter" })
  @ApiResponse({ status: 200, description: "Paginated contracts", schema: contractListResponse })
  @Get()
  async getAllContracts(@Req() req: UserRequest, @Query() query: ContractsQueryDto) {
    return this.contractService.getAllContracts(query.status, req.user.id, query);
  }

  /** Loads a student contract subject to CRM ownership checks. */
  @ApiOperation({ summary: "Get contract for a specific student" })
  @ApiResponse({ status: 200, description: "Contract returned", schema: contractResponse })
  @ApiParam({ name: "studentId" })
  @Get("student/:studentId")
  async getStudentContract(@Req() req: UserRequest, @Param("studentId", ParseIntPipe) studentId: number) {
    return this.contractService.getContractByStudentId(studentId, req.user.id);
  }

  /** Updates editable contract terms as the authenticated expert. */
  @ApiOperation({ summary: "Update contract metadata (before signing — price, currency, dates, number)" })
  @ApiResponse({ status: 200, description: "Contract updated", schema: contractResponse })
  @ApiParam({ name: "id" })
  @ApiBody({ type: UpdateContractMetaDto })
  @Patch(":id/meta")
  async updateMeta(@Req() req: UserRequest, @Param("id") id: string, @Body() dto: UpdateContractMetaDto) {
    return this.contractService.updateMeta(id, dto, req.user.id);
  }

  @ApiOperation({ summary: "Online signing disabled; use manual confirmation", deprecated: true })
  @ApiResponse({ status: 409, description: "MANUAL_SIGNATURE_REQUIRED", schema: onlineSigningConflict })
  @ApiParam({ name: "id" })
  @UseGuards(OnlineSigningDisabledGuard)
  @Post(":id/otp/expert")
  async sendExpertOtp(@Req() req: UserRequest, @Param("id") id: string) {
    return this.contractService.sendExpertOtp(id, req.user.id);
  }

  @ApiOperation({ summary: "Online signing disabled; use manual confirmation", deprecated: true })
  @ApiResponse({ status: 409, description: "MANUAL_SIGNATURE_REQUIRED", schema: onlineSigningConflict })
  @ApiParam({ name: "id" })
  @UseGuards(OnlineSigningDisabledGuard)
  @Post(":id/sign/expert")
  async signByExpert(@Req() req: UserRequest, @Param("id") id: string) {
    return this.contractService.signByExpert(id, req.user.id);
  }
}
