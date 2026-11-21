import { ConflictException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import type { Prisma } from "generated/prisma/client";
import type { PrismaService } from "src/database/prisma.service";
import type { WazzupClient } from "./wazzup.client";
import { WazzupAccessService } from "./wazzup-access.service";

jest.mock("pg", () => ({ Pool: jest.fn() }));
jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("Wazzup access generations", () => {
  type State = { userId: number; generation: number; revocationPending: boolean };
  const states = new Map<number, State>();
  const connection = { query: jest.fn(), release: jest.fn(), on: jest.fn(), removeListener: jest.fn() };
  const revokeUser = jest.fn();
  const isEnabled = jest.fn();
  const assertConfigured = jest.fn();
  const stateModel = {
    upsert: jest.fn(async ({ where }: { where: { userId: number } }) => {
      if (!states.has(where.userId)) states.set(where.userId, { userId: where.userId, generation: 1, revocationPending: true });
      return { ...states.get(where.userId)! };
    }),
    findUnique: jest.fn(async ({ where }: { where: { userId: number } }) => (states.has(where.userId) ? { ...states.get(where.userId)! } : null)),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: { userId: number } }) => ({ ...states.get(where.userId)! })),
    findMany: jest.fn(async () => [...states.values()].filter(x => x.revocationPending)),
    createMany: jest.fn(async ({ data }: { data: { userId: number }[] }) => {
      for (const { userId } of data) if (!states.has(userId)) states.set(userId, { userId, generation: 1, revocationPending: true });
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { userId: number | { in: number[] }; generation?: number; revocationPending: boolean };
        data: { generation?: { increment: number }; revocationPending: boolean };
      }) => {
        let count = 0;
        for (const s of states.values()) {
          const ids = typeof where.userId === "number" ? [where.userId] : where.userId.in;
          if (!ids.includes(s.userId) || s.revocationPending !== where.revocationPending || (where.generation !== undefined && s.generation !== where.generation)) continue;
          if (data.generation) s.generation += data.generation.increment;
          s.revocationPending = data.revocationPending;
          count++;
        }
        return { count };
      },
    ),
  };
  const prisma = { wazzupAccess: stateModel } as unknown as PrismaService;
  const client = { revokeUser, isEnabled, assertConfigured } as unknown as WazzupClient;
  const create = () => new WazzupAccessService(prisma, client, new ConfigService({ DATABASE_URL: "postgresql://unused-fixture" }));
  let service: WazzupAccessService;

  beforeEach(() => {
    states.clear();
    jest.clearAllMocks();
    connection.query.mockResolvedValue({ rows: [] });
    revokeUser.mockResolvedValue(undefined);
    isEnabled.mockReturnValue(true);
    assertConfigured.mockReturnValue(undefined);
    jest.mocked(Pool).mockImplementation(() => ({ connect: async () => connection, on: jest.fn(), end: async () => undefined }) as unknown as Pool);
    service = create();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("retires the legacy card-session identity before the first global grant", async () => {
    await expect(service.withGrant(17, async id => id)).resolves.toBe("oxus-17-1");
    expect(revokeUser).toHaveBeenCalledWith("17");
    expect(connection.query.mock.calls.map(x => x[0])).toEqual(["SELECT pg_advisory_lock($1, $2)", "SELECT pg_advisory_unlock($1, $2)"]);
    expect(connection.release).toHaveBeenCalledWith(false);
  });

  it("retains a failed revocation across retries and a new service instance; never grants the old ID again", async () => {
    const tx = prisma as unknown as Prisma.TransactionClient;
    await service.invalidateUsers(tx, [17]);
    revokeUser.mockRejectedValueOnce(new Error("withheld"));
    await service.synchronizeUsers([17]);
    expect(states.get(17)).toEqual({ userId: 17, generation: 1, revocationPending: true });
    await service.invalidateUsers(tx, [17]);
    expect(states.get(17)!.generation).toBe(1);
    service = create();
    await expect(service.withGrant(17, async id => id)).resolves.toBe("oxus-17-1");
    expect(revokeUser.mock.calls.map(x => x[0])).toEqual(["17", "17"]);
    await service.invalidateUsers(tx, [17]);
    await expect(service.withGrant(17, async id => id)).resolves.toBe("oxus-17-2");
    expect(revokeUser).toHaveBeenLastCalledWith("oxus-17-1");
  });

  it("does not run grant work when provider revocation is still failing", async () => {
    states.set(17, { userId: 17, generation: 1, revocationPending: true });
    revokeUser.mockRejectedValue(new Error("withheld"));
    const work = jest.fn();
    await expect(service.withGrant(17, work)).rejects.toMatchObject({ response: { code: "WAZZUP_REVOKE_PENDING" } });
    expect(work).not.toHaveBeenCalled();
    expect(states.get(17)!.revocationPending).toBe(true);
  });

  it("withholds a grant when its durable generation changes during the external operation", async () => {
    await expect(
      service.withGrant(17, async (_id, validate) => {
        await service.invalidateUsers(prisma, [17]);
        await validate();
        return "must-not-return";
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(connection.release).toHaveBeenCalledWith(false);
  });

  it("does not clear a later generation with an old DELETE acknowledgement", async () => {
    states.set(17, { userId: 17, generation: 1, revocationPending: true });
    revokeUser.mockImplementationOnce(async () => {
      states.set(17, { userId: 17, generation: 2, revocationPending: true });
    });
    await service.synchronizeUsers([17]);
    expect(states.get(17)).toEqual({ userId: 17, generation: 2, revocationPending: true });
  });

  it("preserves pending state without external requests or coordination connections while OFF", async () => {
    states.set(17, { userId: 17, generation: 1, revocationPending: true });
    isEnabled.mockReturnValue(false);
    await service.synchronizeUsers([17]);
    expect(revokeUser).not.toHaveBeenCalled();
    expect(Pool).not.toHaveBeenCalled();
    assertConfigured.mockImplementation(() => {
      throw new Error("OFF");
    });
    await expect(service.withGrant(17, async id => id)).rejects.toThrow("OFF");
    expect(Pool).not.toHaveBeenCalled();
    expect(states.get(17)!.revocationPending).toBe(true);
  });

  it("discards a session when unlock fails so a held lock never returns to the pool", async () => {
    connection.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("withheld"));
    await service.withGrant(17, async id => id);
    expect(connection.release).toHaveBeenCalledWith(true);
  });

  it("withholds a result after the coordination session is lost", async () => {
    await expect(
      service.withGrant(17, async id => {
        const listener = connection.on.mock.calls.find(([event]) => event === "error")![1];
        listener();
        return id;
      }),
    ).rejects.toMatchObject({ response: { code: "WAZZUP_ACCESS_CHANGED" } });
    expect(connection.release).toHaveBeenCalledWith(true);
  });
});
