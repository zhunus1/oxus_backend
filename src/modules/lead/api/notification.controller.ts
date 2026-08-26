import { Controller, Get, Param, ParseIntPipe, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { LeadNotificationService } from "../service/lead-notification.service";
import { NotificationQueryDto } from "./dto/sales/notification-query.dto";

@ApiTags("Notifications")
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationController {
  constructor(private readonly service: LeadNotificationService) {}

  @Get()
  list(@Req() req: UserRequest, @Query() query: NotificationQueryDto) {
    return this.service.list(req.user.id, query);
  }

  @Get("unread-count")
  unreadCount(@Req() req: UserRequest) {
    return this.service.unreadCount(req.user.id);
  }

  @Patch("read-all")
  markAllRead(@Req() req: UserRequest) {
    return this.service.markAllRead(req.user.id);
  }

  @Patch(":id/read")
  markRead(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.service.markRead(req.user.id, id);
  }
}
