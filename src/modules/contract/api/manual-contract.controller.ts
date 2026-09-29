import { contractResponse, scheduleResponse, manualConflictResponse } from "src/common/openapi/flow-responses";
import { Body, Controller, Param, ParseIntPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { ManualContractService } from "../service/manual-contract.service";
import { ConfirmInstallmentDto, ConfirmManualContractDto, RecordContractSignatureDto } from "./dto/manual-contract.dto";
import { ContractSchedulePreviewDto } from "./dto/contract-schedule-preview.dto";
import { installmentSchedule, paymentTerms } from "../domain/manual-contract";

@ApiTags("Contract")
@ApiBearerAuth()
@ApiResponse({ status: 409, description: "Business conflict; historical benefits may require operator review", schema: manualConflictResponse })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT", "ADMIN")
@Controller("contracts")
export class ManualContractController {
  constructor(private readonly contracts: ManualContractService) {}

  @ApiResponse({ status: 201, schema: scheduleResponse })
  @Post("payment-schedule/preview")
  preview(@Body() dto: ContractSchedulePreviewDto) {
    const terms = paymentTerms(dto.price, dto.currency, dto.paymentType, dto.installmentCount);
    return { ...terms, price: dto.price, currency: dto.currency, installments: installmentSchedule(dto.price, terms.installmentCount, new Date(dto.firstPaidAt)) };
  }

  @ApiResponse({ status: 201, schema: contractResponse })
  @Post(":id/manual-signature")
  signature(@Req() req: UserRequest, @Param("id") id: string, @Body() dto: RecordContractSignatureDto) {
    return this.contracts.recordSignature(id, req.user.id, dto, req.user.roleCode === "ADMIN");
  }

  @ApiResponse({ status: 201, schema: contractResponse })
  @Post(":id/confirm-manual")
  confirm(@Req() req: UserRequest, @Param("id") id: string, @Body() dto: ConfirmManualContractDto) {
    return this.contracts.confirm(id, req.user.id, dto, req.user.roleCode === "ADMIN");
  }

  @ApiResponse({ status: 201, schema: contractResponse })
  @Post(":id/installments/:number/confirm")
  confirmInstallment(@Req() req: UserRequest, @Param("id") id: string, @Param("number", ParseIntPipe) number: number, @Body() dto: ConfirmInstallmentDto) {
    return this.contracts.confirmInstallment(id, number, req.user.id, dto, req.user.roleCode === "ADMIN");
  }
}
