import { ConflictException, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { WazzupClient } from "./wazzup.client";

const LOCK_NAMESPACE = 0x575a5550;

/** Coordinates provider grants/revokes; durable generations never reuse a retired ID. */
@Injectable()
export class WazzupAccessService implements OnModuleDestroy {
  private readonly logger = new Logger(WazzupAccessService.name);
  private pool?: Pool;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: WazzupClient,
    private readonly config: ConfigService,
  ) {}

  async revocableUsers(tx: Prisma.TransactionClient, where: Prisma.UserWhereInput): Promise<number[]> {
    const users = await tx.user.findMany({
      where,
      select: { id: true },
    });
    return users.map(user => user.id);
  }

  /** Must run in the same short database transaction as the CRM permission change. */
  async invalidateUsers(tx: Prisma.TransactionClient, userIds: number[]): Promise<void> {
    if (!userIds.length) return;
    await tx.wazzupAccess.createMany({ data: userIds.map(userId => ({ userId })), skipDuplicates: true });
    // A pending generation has not been granted. Repeated blocks/retries must
    // keep its retired ID rather than lose track of a failed earlier DELETE.
    await tx.wazzupAccess.updateMany({
      where: { userId: { in: userIds }, revocationPending: false },
      data: { generation: { increment: 1 }, revocationPending: true },
    });
  }

  async withGrant<T>(userId: number, work: (providerId: string, revalidate: () => Promise<void>) => Promise<T>): Promise<T> {
    this.client.assertConfigured();
    return this.withLock(userId, async () => {
      let access = await this.prisma.wazzupAccess.upsert({ where: { userId }, create: { userId }, update: {} });
      if (access.revocationPending) {
        try {
          await this.synchronizeLocked(userId);
        } catch {
          throw this.pendingRevoke();
        }
        access = await this.prisma.wazzupAccess.findUniqueOrThrow({ where: { userId } });
      }
      if (access.revocationPending) throw this.pendingRevoke();
      const generation = access.generation;
      const revalidate = async () => {
        const current = await this.prisma.wazzupAccess.findUnique({ where: { userId } });
        if (!current || current.revocationPending || current.generation !== generation) {
          throw new ConflictException({ code: "WAZZUP_ACCESS_CHANGED", message: "Wazzup access changed; reopen the chat window" });
        }
      };
      return work(this.providerId(userId, generation), revalidate);
    });
  }

  /** CRM mutations remain successful on provider failure; the persisted pending
   * state denies grants and allows an explicit retry without a background job. */
  async synchronizeUsers(userIds: number[]): Promise<void> {
    if (!userIds.length || !this.client.isEnabled()) return;
    let pending: { userId: number }[];
    try {
      pending = await this.prisma.wazzupAccess.findMany({ where: { userId: { in: userIds }, revocationPending: true }, select: { userId: true } });
    } catch {
      this.logger.error("Wazzup revoke status unavailable after CRM mutation; explicit retry required");
      return;
    }
    const deadline = Date.now() + 30_000;
    for (const { userId } of pending) {
      if (Date.now() >= deadline) {
        this.logger.error("Wazzup batch revoke remains pending; explicit retry required");
        break;
      }
      try {
        await this.withLock(userId, () => this.synchronizeLocked(userId));
      } catch {
        this.logger.error(`Wazzup revoke remains pending for CRM user ${userId}; explicit retry required`);
      }
    }
  }

  private providerId(userId: number, generation: number): string {
    // Generation zero is the legacy numeric ID, retired before the first grant.
    // Every replacement requires fresh channel-role assignment.
    return generation === 0 ? String(userId) : `oxus-${userId}-${generation}`;
  }

  private async synchronizeLocked(userId: number): Promise<void> {
    const access = await this.prisma.wazzupAccess.findUnique({ where: { userId } });
    if (!access?.revocationPending) return;
    await this.client.revokeUser(this.providerId(userId, access.generation - 1));
    await this.prisma.wazzupAccess.updateMany({
      where: { userId, generation: access.generation, revocationPending: true },
      data: { revocationPending: false },
    });
  }

  private async withLock<T>(userId: number, work: () => Promise<T>): Promise<T> {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.config.get<string>("DATABASE_URL") ?? process.env.DATABASE_URL,
        max: 4,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30_000,
        options: "-c statement_timeout=35000 -c lock_timeout=35000",
      });
      this.pool.on("error", () => this.logger.error("Wazzup coordination connection failed"));
    }
    // Dedicated session lock, not a database transaction around HTTP calls.
    const connection = await this.pool.connect();
    let acquired = false;
    let discard = false;
    const lostConnection = () => {
      discard = true;
    };
    connection.on("error", lostConnection);
    try {
      await connection.query("SELECT pg_advisory_lock($1, $2)", [LOCK_NAMESPACE, userId]);
      acquired = true;
      const result = await work();
      if (discard) throw new ConflictException({ code: "WAZZUP_ACCESS_CHANGED", message: "Wazzup coordination lost; reopen the chat window" });
      return result;
    } finally {
      if (acquired && !discard) {
        try {
          await connection.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_NAMESPACE, userId]);
        } catch {
          discard = true;
        }
      } else {
        discard = true;
      }
      connection.removeListener("error", lostConnection);
      connection.release(discard);
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  private pendingRevoke() {
    return new ConflictException({ code: "WAZZUP_REVOKE_PENDING", message: "Previous Wazzup access has not been revoked; administrator action required" });
  }
}
