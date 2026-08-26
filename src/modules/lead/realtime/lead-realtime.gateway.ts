import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { PrismaService } from "src/database/prisma.service";
import { resolveUserIdFromJwtPayload } from "src/modules/admin/auth/jwt-user-id.util";
import { validateCorsOrigin } from "src/configs/cors-origin";
import { SALES_MANAGER_ROLE } from "../domain/lead.constants";

const UNASSIGNED_ROOM = "sales:unassigned";

@WebSocketGateway({
  namespace: "/sales",
  cors: { origin: validateCorsOrigin, credentials: true },
})
export class LeadRealtimeGateway {
  private readonly logger = new Logger(LeadRealtimeGateway.name);

  @WebSocketServer()
  private server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) return client.disconnect(true);

      const payload = this.jwtService.verify(token, { secret: process.env.JWT_SECRET });
      const userId = resolveUserIdFromJwtPayload(payload);
      if (userId == null) return client.disconnect(true);

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { deletedAt: true, role: { select: { code: true } } },
      });
      if (!user || user.deletedAt || ![SALES_MANAGER_ROLE, "EXPERT"].includes(user.role.code)) {
        return client.disconnect(true);
      }

      client.data.userId = userId;
      client.data.roleCode = user.role.code;

      if (user.role.code === SALES_MANAGER_ROLE) {
        await client.join(UNASSIGNED_ROOM);
        await client.join(this.salesManagerRoom(userId));
      } else {
        await client.join(this.expertRoom(userId));
      }
    } catch (error) {
      this.logger.warn(`Rejected WebSocket connection: ${error instanceof Error ? error.message : String(error)}`);
      client.disconnect(true);
    }
  }

  emitLeadCreated(lead: unknown) {
    this.server?.to(UNASSIGNED_ROOM).emit("lead.created", lead);
    this.server?.to(UNASSIGNED_ROOM).emit("lead.summary.updated", { reason: "lead.created" });
  }

  emitLeadAccepted(leadId: number, managerId: number, lead: unknown) {
    this.server?.to(UNASSIGNED_ROOM).emit("lead.accepted", { leadId, acceptedByUserId: managerId });
    this.server?.to(this.salesManagerRoom(managerId)).emit("lead.updated", lead);
    this.server?.to(UNASSIGNED_ROOM).emit("lead.summary.updated", { reason: "lead.accepted" });
  }

  emitLeadUpdated(managerId: number, lead: unknown) {
    this.server?.to(this.salesManagerRoom(managerId)).emit("lead.updated", lead);
    this.server?.to(this.salesManagerRoom(managerId)).emit("lead.summary.updated", { reason: "lead.updated" });
  }

  emitExpertCallRequested(expertUserId: number, call: unknown) {
    this.server?.to(this.expertRoom(expertUserId)).emit("expert-call.created", call);
  }

  emitExpertCallUpdated(expertUserId: number, managerId: number, call: unknown) {
    this.server?.to(this.expertRoom(expertUserId)).emit("expert-call.updated", call);
    this.server?.to(this.salesManagerRoom(managerId)).emit("expert-call.updated", call);
  }

  emitExpertCallRemoved(expertUserId: number, callId: number) {
    this.server?.to(this.expertRoom(expertUserId)).emit("expert-call.removed", { callId });
  }

  emitNotification(userId: number, notification: unknown) {
    this.server?.to(this.salesManagerRoom(userId)).emit("notification.created", notification);
    this.server?.to(this.expertRoom(userId)).emit("notification.created", notification);
  }

  private salesManagerRoom(userId: number) {
    return `sales:user:${userId}`;
  }

  private expertRoom(userId: number) {
    return `expert:user:${userId}`;
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === "string" && authToken.trim()) return authToken.replace(/^Bearer\s+/i, "");

    const authorization = client.handshake.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) return authorization.slice(7);

    const cookie = client.handshake.headers.cookie;
    if (!cookie) return null;
    const accessToken = cookie
      .split(";")
      .map(item => item.trim().split("="))
      .find(([name]) => name === "accessToken")?.[1];
    return accessToken ? decodeURIComponent(accessToken) : null;
  }
}
