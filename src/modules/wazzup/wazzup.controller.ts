import { Controller, Get, Header, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { WazzupService } from "./wazzup.service";

const iframeSchema = { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri", description: "Sensitive Wazzup iframe session URL" } } };

@ApiTags("Wazzup")
@ApiBearerAuth()
@ApiResponse({ status: 401, description: "Authentication required" })
@ApiResponse({ status: 403, description: "Active ADMIN or SALES_MANAGER with lead management permission required; channels are ADMIN-only" })
@ApiResponse({ status: 409, description: "No accepted leads with valid phones, selection exceeds 1000 leads, or access/phone changed while opening the window" })
@ApiResponse({ status: 502, description: "Wazzup rejected the request or returned an invalid response" })
@ApiResponse({ status: 503, description: "Integration disabled, API key missing, no active configured WhatsApp channel, or Wazzup rate limit reached" })
@ApiResponse({ status: 504, description: "Wazzup request timed out" })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SALES_MANAGER")
@Controller("integrations/wazzup")
export class WazzupController {
  constructor(private readonly wazzup: WazzupService) {}

  @Get("channels")
  @Header("Cache-Control", "no-store")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Check Wazzup connectivity and list account channels (ADMIN only)" })
  @ApiResponse({
    status: 200,
    schema: {
      type: "array",
      items: {
        type: "object",
        required: ["channelId", "transport", "plainId", "state"],
        properties: { channelId: { type: "string" }, transport: { type: "string" }, plainId: { type: "string" }, state: { type: "string" } },
      },
    },
  })
  channels(@Req() req: UserRequest) {
    return this.wazzup.channels(req.user.id);
  }

  @Post("iframe")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @ApiOperation({
    summary: "Open Wazzup chats for the current CRM user",
    description:
      "Uses global scope so Wazzup enforces employee roles and contact ownership. Sales synchronizes only assigned, accepted CRM leads; channel roles must also be configured in Wazzup.",
  })
  @ApiResponse({ status: 200, schema: iframeSchema })
  globalIframe(@Req() req: UserRequest) {
    return this.wazzup.globalIframe(req.user.id);
  }

  @Post("leads/:id/iframe")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @ApiOperation({
    summary: "Open WhatsApp for a lead",
    description: "Sales must own and have accepted the lead. The server loads the phone from the lead; client-supplied user IDs, roles, and phone numbers are not used.",
  })
  @ApiResponse({ status: 200, schema: iframeSchema })
  @ApiResponse({ status: 400, description: "Invalid lead ID or missing/invalid lead phone" })
  @ApiResponse({ status: 404, description: "Lead missing or deleted" })
  leadIframe(@Req() req: UserRequest, @Param("id", ParseIntPipe) leadId: number) {
    return this.wazzup.leadIframe(req.user.id, leadId);
  }
}
