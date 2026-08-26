import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { ContractService } from "../service/contract.service";
import { SignStudentContractDto } from "./dto/sign-student-contract.dto";
import { SendStudentOtpDto } from "./dto/send-student-otp.dto";

@ApiTags("Contract")
@UseGuards(JwtAuthGuard)
@Controller("contracts")
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  @ApiOperation({ summary: "Get my contract (student)" })
  @ApiResponse({ status: 200, description: "Contract returned, or null if not yet created by expert" })
  @Get("my")
  async getMyContract(@Req() req: UserRequest) {
    return this.contractService.getMyContract(req.user.id);
  }

  @ApiOperation({ summary: "Send OTP to contract phone for signing (may be parent/guardian)" })
  @ApiResponse({ status: 200, description: "OTP sent" })
  @ApiParam({ name: "id", description: "Contract ID" })
  @ApiBody({ type: SendStudentOtpDto })
  @Post(":id/otp/student")
  async sendStudentOtp(@Req() req: UserRequest, @Param("id") id: string, @Body() dto: SendStudentOtpDto) {
    return this.contractService.sendStudentOtp(id, req.user.id, dto.clientPhone);
  }

  @ApiOperation({ summary: "Student signs contract with OTP and personal details" })
  @ApiResponse({ status: 200, description: "Contract signed, PDF sent to both parties" })
  @ApiParam({ name: "id", description: "Contract ID" })
  @ApiBody({ type: SignStudentContractDto })
  @Post(":id/sign/student")
  async signByStudent(@Req() req: UserRequest, @Param("id") id: string, @Body() dto: SignStudentContractDto) {
    return this.contractService.signByStudent(id, req.user.id, dto);
  }
}
