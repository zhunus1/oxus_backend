import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { InitPaymentDto } from "./dtos/init-payment.dto";
import { PaymentService } from "../service/payment.service";
import { FreedomPaymentDto } from "./dtos/freedom-pay.dto";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Public } from "src/modules/admin/auth/rbac/public.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";

@ApiTags("Billing")
@UseGuards(JwtAuthGuard)
@Controller("payment")
export class PaymentController {
  constructor(private service: PaymentService) {}

  @ApiOperation({ summary: "Initiate payment for a subscription tier (AI_ROADMAP or EXPERT_MENTORSHIP)" })
  @Post("")
  async initPayment(@Req() req: UserRequest, @Body() data: InitPaymentDto) {
    return await this.service.createPayment(req.user.id, data.subscriptionTier);
  }

  @ApiOperation({ summary: "Get transaction status by ID" })
  @Get(":id")
  async findOne(@Param("id") id: string) {
    return await this.service.findOne(id);
  }

  @ApiOperation({ summary: "FreedomPay webhook callback" })
  @Public()
  @Post("freedompay-webhook")
  async handleFreedomWebhook(@Body() data: FreedomPaymentDto) {
    return await this.service.handleFreedomWebhook(data);
  }
}
