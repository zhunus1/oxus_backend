import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ContractService } from "../service/contract.service";
import { CreateContractForStudentDto } from "./dto/create-contract-for-student.dto";
import { UpdateContractMetaDto } from "./dto/update-contract-meta.dto";
import { ContractStatus } from "generated/prisma/enums";

/** Exposes expert contract operations with assigned-expert checks for CRM contracts. */
@ApiTags("Contract")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT", "ADMIN")
@Controller("contracts")
export class ExpertContractController {
  constructor(private readonly contractService: ContractService) {}

  @ApiOperation({ summary: "Create a contract for a student (expert/admin)" })
  @ApiResponse({ status: 201, description: "Contract created, pending expert signature" })
  @ApiBody({ type: CreateContractForStudentDto })
  @Post()
  async createContract(@Body() dto: CreateContractForStudentDto) {
    return this.contractService.createContractForStudent(dto);
  }

  /** Lists contracts using the authenticated expert CRM visibility scope. */
  @ApiOperation({ summary: "List all contracts, optionally filtered by status" })
  @ApiResponse({ status: 200, description: "Contracts returned" })
  @ApiQuery({ name: "status", enum: ContractStatus, required: false })
  @Get()
  async getAllContracts(@Req() req: UserRequest, @Query("status") status?: ContractStatus) {
    return this.contractService.getAllContracts(status, req.user.roleCode === "ADMIN" ? undefined : req.user.id);
  }

  /** Loads a student contract subject to CRM ownership checks. */
  @ApiOperation({ summary: "Get contract for a specific student" })
  @ApiResponse({ status: 200, description: "Contract returned" })
  @ApiParam({ name: "studentId" })
  @Get("student/:studentId")
  async getStudentContract(@Req() req: UserRequest, @Param("studentId", ParseIntPipe) studentId: number) {
    return this.contractService.getContractByStudentId(studentId, req.user.roleCode === "ADMIN" ? undefined : req.user.id);
  }

  /** Updates editable contract terms as the authenticated expert. */
  @ApiOperation({ summary: "Update contract metadata (before signing — price, currency, dates, number)" })
  @ApiResponse({ status: 200, description: "Contract updated" })
  @ApiParam({ name: "id" })
  @ApiBody({ type: UpdateContractMetaDto })
  @Patch(":id/meta")
  async updateMeta(@Req() req: UserRequest, @Param("id") id: string, @Body() dto: UpdateContractMetaDto) {
    return this.contractService.updateMeta(id, dto, req.user.id);
  }

  @ApiOperation({ summary: "Send OTP to expert email for contract signing" })
  @ApiResponse({ status: 200, description: "OTP sent" })
  @ApiParam({ name: "id" })
  @Post(":id/otp/expert")
  async sendExpertOtp(@Req() req: UserRequest, @Param("id") id: string) {
    return this.contractService.sendExpertOtp(id, req.user.id);
  }

  @ApiOperation({ summary: "Expert signs contract → student is notified by email" })
  @ApiResponse({ status: 200, description: "Contract signed by expert" })
  @ApiParam({ name: "id" })
  @Post(":id/sign/expert")
  async signByExpert(@Req() req: UserRequest, @Param("id") id: string) {
    return this.contractService.signByExpert(id, req.user.id);
  }
}
