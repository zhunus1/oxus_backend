import { Cron } from "@nestjs/schedule";
import { Logger, OnModuleDestroy } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Namespace, Socket } from "socket.io";
import { PrismaService } from "src/database/prisma.service";
import { resolveUserIdFromJwtPayload } from "src/modules/admin/auth/jwt-user-id.util";
import { validateCorsOrigin } from "src/configs/cors-origin";
import { SALES_MANAGER_ROLE } from "../domain/lead.constants";
import type { NotificationLog } from "generated/prisma/client";
import { notificationPayload } from "../domain/notification-payload";

const UNASSIGNED_ROOM = "sales:unassigned";

/** Authenticates Sales and Expert sockets and emits CRM changes to role-specific user rooms. */
@WebSocketGateway({
  namespace: "/sales",
  cors: { origin: validateCorsOrigin, credentials: true },
})
export class LeadRealtimeGateway implements OnModuleDestroy {
  private readonly sessions = new Map<string, { client: Socket; expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
  private readonly logger = new Logger(LeadRealtimeGateway.name);

  @WebSocketServer()
  private server: Namespace;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Joins the revocation room before reading permissions, closing the block-versus-handshake race. */
  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) return client.disconnect(true);

      const payload = this.jwtService.verify(token, { secret: process.env.JWT_SECRET });
      const userId = resolveUserIdFromJwtPayload(payload);
      const expiresAt = Number(payload.exp) * 1000;
      if (userId == null || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return client.disconnect(true);
      await client.join(this.sessionRoom(userId));
      if (!client.connected) return;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { deletedAt: true, role: { select: { code: true } } },
      });
      if (!user || user.deletedAt || ![SALES_MANAGER_ROLE, "EXPERT"].includes(user.role.code)) {
        return client.disconnect(true);
      }

      if (!client.connected || expiresAt <= Date.now()) return client.disconnect(true);
      client.data.userId = userId;
      client.data.roleCode = user.role.code;

      if (user.role.code === SALES_MANAGER_ROLE) {
        await client.join(UNASSIGNED_ROOM);
        if (!client.connected) return;
        await client.join(this.salesManagerRoom(userId));
      } else {
        await client.join(this.expertRoom(userId));
      }
      if (!client.connected) return;
      const timer = setTimeout(() => client.disconnect(true), Math.min(expiresAt - Date.now(), 2_147_483_647));
      timer.unref();
      this.sessions.set(client.id, { client, expiresAt, timer });
    } catch (error) {
      this.logger.warn(`Rejected WebSocket connection: ${error instanceof Error ? error.message : String(error)}`);
      client.disconnect(true);
    }
  }

  /** Removes the local expiry timer and session when a socket disconnects. */
  handleDisconnect(client: Socket) {
    const session = this.sessions.get(client.id);
    if (session) clearTimeout(session.timer);
    this.sessions.delete(client.id);
  }

  /** Revokes this user's CRM sockets on every server connected through the Redis adapter. */
  revokeUser(userId: number) {
    this.server?.in(this.sessionRoom(userId)).disconnectSockets(true);
  }

  /** Revalidates local sessions in batches; fail closed if access cannot be verified. */
  @Cron("*/30 * * * * *", { waitForCompletion: true })
  async revalidateSessions() {
    const sessions = [...this.sessions.values()];
    for (let index = 0; index < sessions.length; index += 100) {
      const batch = sessions.slice(index, index + 100);
      try {
        const users = await this.prisma.user.findMany({
          where: { id: { in: [...new Set(batch.map(s => s.client.data.userId as number))] } },
          select: { id: true, deletedAt: true, role: { select: { code: true } } },
        });
        const byId = new Map(users.map(user => [user.id, user]));
        for (const session of batch) {
          const user = byId.get(session.client.data.userId);
          if (!user || user.deletedAt || user.role.code !== session.client.data.roleCode || session.expiresAt <= Date.now()) session.client.disconnect(true);
        }
      } catch {
        this.logger.warn("Could not revalidate CRM sessions; disconnecting affected sockets");
        for (const session of batch) session.client.disconnect(true);
      }
    }
  }

  /** Releases session timers during application shutdown. */
  onModuleDestroy() {
    for (const session of this.sessions.values()) {
      clearTimeout(session.timer);
      session.client.disconnect(true);
    }
    this.sessions.clear();
  }

  /** Returns a role-independent room so access changes also revoke handshakes in progress. */
  private sessionRoom(userId: number) {
    return `crm:user:${userId}`;
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

  /** Sends card and counter invalidations to one expert without broadcasting questionnaire contents. */
  emitExpertLeadUpdated(expertUserId: number, leadId: number) {
    // Do not broadcast questionnaire or health data. Authorized clients refetch the card.
    this.server?.to(this.expertRoom(expertUserId)).emit("expert-lead.updated", { leadId });
    this.server?.to(this.expertRoom(expertUserId)).emit("expert-lead.summary.updated", { leadId });
  }

  emitExpertCallUpdated(expertUserId: number, managerId: number, call: unknown) {
    this.server?.to(this.expertRoom(expertUserId)).emit("expert-call.updated", call);
    this.server?.to(this.salesManagerRoom(managerId)).emit("expert-call.updated", call);
  }

  emitExpertCallRemoved(expertUserId: number, callId: number) {
    this.server?.to(this.expertRoom(expertUserId)).emit("expert-call.removed", { callId });
  }

  emitNotification(userId: number, notification: NotificationLog) {
    const payload = notificationPayload(notification);
    this.server?.to(this.salesManagerRoom(userId)).emit("notification.created", payload);
    this.server?.to(this.expertRoom(userId)).emit("notification.created", payload);
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
