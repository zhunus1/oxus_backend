import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { NoFilesInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiResponse, ApiTags, ApiOperation, ApiBody } from "@nestjs/swagger";
import { InitPaymentDto } from "./dtos/init-payment.dto";
import { PaymentService } from "../service/payment.service";
import { freedomCallbackBody } from "src/common/openapi/flow-responses";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Public } from "src/modules/admin/auth/rbac/public.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";

@ApiTags("Billing")
@UseGuards(JwtAuthGuard)
@Controller("payment")
export class PaymentController {
  constructor(private service: PaymentService) {}

  @ApiOperation({ summary: "Initiate payment for a subscription tier (AI_ROADMAP or EXPERT_MENTORSHIP)" })
  @ApiBearerAuth()
  @Post("")
  async initPayment(@Req() req: UserRequest, @Body() data: InitPaymentDto) {
    return await this.service.createPayment(req.user.id, data.subscriptionTier);
  }

  @ApiOperation({ summary: "Get transaction status by ID" })
  @ApiBearerAuth()
  @Get(":id")
  async findOne(@Param("id") id: string) {
    return await this.service.findOne(id);
  }

  @ApiOperation({ summary: "FreedomPay webhook callback" })
  @Public()
  @ApiConsumes("application/x-www-form-urlencoded", "multipart/form-data", "application/json")
  @ApiBody({ schema: freedomCallbackBody })
  @ApiResponse({ status: 200, description: "Signed XML ACK after successful verification and settlement", content: { "application/xml": { schema: { type: "string" } } } })
  @ApiResponse({ status: 400, description: "Invalid/unsuccessful/uncaptured payment or amount/currency mismatch" })
  @ApiResponse({ status: 403, description: "Invalid signature or merchant/mode context" })
  @ApiResponse({ status: 409, description: "Settlement conflict" })
  @ApiResponse({ status: 503, description: "Verifier configuration unavailable" })
  @UseInterceptors(NoFilesInterceptor())
  @HttpCode(200)
  @Header("Content-Type", "application/xml")
  @Post("freedompay-webhook")
  async handleFreedomWebhook(@Body() data: Record<string, unknown>) {
    // Deliberately retain raw scalar values and unknown signed fields before DTO coercion/whitelisting.
    await this.service.handleFreedomWebhook(data);
    return this.service.freedomWebhookAcknowledgement();
  }
}
