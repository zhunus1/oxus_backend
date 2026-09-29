import { contractResponse, onlineSigningConflict } from "src/common/openapi/flow-responses";
import { OnlineSigningDisabledGuard } from "./online-signing-disabled.guard";
import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ContractService } from "../service/contract.service";
import { SignStudentContractDto } from "./dto/sign-student-contract.dto";
import { SendStudentOtpDto } from "./dto/send-student-otp.dto";

@ApiTags("Contract")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("contracts")
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  @ApiOperation({ summary: "Get my contract (student)" })
  @ApiResponse({ status: 200, description: "Contract returned, or null if not yet created by expert", schema: { ...contractResponse, nullable: true } })
  @Get("my")
  async getMyContract(@Req() req: UserRequest) {
    return this.contractService.getMyContract(req.user.id);
  }

  @ApiOperation({ summary: "Online signing disabled; use manual confirmation", deprecated: true })
  @ApiResponse({ status: 409, description: "MANUAL_SIGNATURE_REQUIRED", schema: onlineSigningConflict })
  @ApiParam({ name: "id", description: "Contract ID" })
  @ApiBody({ type: SendStudentOtpDto })
  @UseGuards(OnlineSigningDisabledGuard)
  @Post(":id/otp/student")
  async sendStudentOtp(@Req() req: UserRequest, @Param("id") id: string, @Body() dto: SendStudentOtpDto) {
    return this.contractService.sendStudentOtp(id, req.user.id, dto.clientPhone);
  }

  @ApiOperation({ summary: "Online signing disabled; use manual confirmation", deprecated: true })
  @ApiResponse({ status: 409, description: "MANUAL_SIGNATURE_REQUIRED", schema: onlineSigningConflict })
  @ApiParam({ name: "id", description: "Contract ID" })
  @ApiBody({ type: SignStudentContractDto })
  @UseGuards(OnlineSigningDisabledGuard)
  @Post(":id/sign/student")
  async signByStudent(@Req() req: UserRequest, @Param("id") id: string, @Body() dto: SignStudentContractDto) {
    return this.contractService.signByStudent(id, req.user.id, dto);
  }
}
