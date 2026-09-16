import type { JwtService } from "@nestjs/jwt";
import type { Socket } from "socket.io";
import type { NotificationLog } from "generated/prisma/client";
import type { PrismaService } from "src/database/prisma.service";
import { LeadRealtimeGateway } from "./lead-realtime.gateway";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("LeadRealtimeGateway connection authorization", () => {
  const verify = jest.fn();
  const jwt = { verify } as unknown as JwtService;
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const prisma = { user: { findUnique, findMany } } as unknown as PrismaService;
  const gateway = new LeadRealtimeGateway(jwt, prisma);

  function socket(token = "valid-token") {
    const join = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn();
    const client = {
      id: String(Math.random()),
      connected: true,
      handshake: { auth: { token }, headers: {} },
      data: {},
      join,
      disconnect,
    } as unknown as Socket;
    return { client, join, disconnect };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    verify.mockReturnValue({ sub: "17", exp: Math.floor(Date.now() / 1000) + 3600 });
  });

  afterEach(() => gateway.onModuleDestroy());

  it("emits translation parameters to the recipient's Sales and Expert rooms", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const realtime = new LeadRealtimeGateway(jwt, prisma);
    Object.assign(realtime, { server: { to } });
    const notification = {
      id: 5,
      type: "LEAD_CALLBACK_REMINDER",
      content: "Пора перезвонить: Әлия",
      metadata: { callbackId: 4, params: { leadName: "Әлия" } },
    } as unknown as NotificationLog;

    realtime.emitNotification(17, notification);

    expect(to.mock.calls).toEqual([["sales:user:17"], ["expert:user:17"]]);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith("notification.created", {
      id: 5,
      type: "LEAD_CALLBACK_REMINDER",
      metadata: { callbackId: 4, params: { leadName: "Әлия" } },
      params: { leadName: "Әлия" },
    });
  });

  it("joins a Sales Manager only to the shared new-lead room and their private room", async () => {
    findUnique.mockResolvedValue({ deletedAt: null, role: { code: "SALES_MANAGER" } });
    const { client, join, disconnect } = socket();

    await gateway.handleConnection(client);

    expect(join).toHaveBeenNthCalledWith(1, "crm:user:17");
    expect(join).toHaveBeenNthCalledWith(2, "sales:unassigned");
    expect(join).toHaveBeenNthCalledWith(3, "sales:user:17");
    expect(client.data).toEqual(expect.objectContaining({ userId: 17, roleCode: "SALES_MANAGER" }));
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("joins an expert only to that expert's private room", async () => {
    findUnique.mockResolvedValue({ deletedAt: null, role: { code: "EXPERT" } });
    const { client, join } = socket();

    await gateway.handleConnection(client);

    expect(join).toHaveBeenCalledTimes(2);
    expect(join).toHaveBeenCalledWith("expert:user:17");
  });

  it("disconnects a different role even when its token is valid", async () => {
    findUnique.mockResolvedValue({ deletedAt: null, role: { code: "STUDENT" } });
    const { client, join, disconnect } = socket();

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
    expect(join).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledWith("crm:user:17");
  });

  it("disconnects malformed JWT user ids before querying the database", async () => {
    verify.mockReturnValue({ sub: "17abc" });
    const { client, disconnect } = socket();

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, Math.floor(Date.now() / 1000) - 1])("rejects absent or expired JWT expiry %s", async exp => {
    verify.mockReturnValue({ sub: 17, exp });
    const { client, disconnect } = socket();
    await gateway.handleConnection(client);
    expect(disconnect).toHaveBeenCalledWith(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("does not restore role rooms when revoked during the authorization query", async () => {
    const { client, join, disconnect } = socket();
    findUnique.mockImplementationOnce(async () => {
      Object.defineProperty(client, "connected", { value: false });
      return { deletedAt: null, role: { code: "SALES_MANAGER" } };
    });
    await gateway.handleConnection(client);
    expect(join.mock.calls).toEqual([["crm:user:17"]]);
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it.each([null, { id: 17, deletedAt: new Date(), role: { code: "SALES_MANAGER" } }, { id: 17, deletedAt: null, role: { code: "EXPERT" } }])(
    "revokes stale sessions after a missed access-change signal",
    async user => {
      findUnique.mockResolvedValue({ deletedAt: null, role: { code: "SALES_MANAGER" } });
      const { client, disconnect } = socket();
      await gateway.handleConnection(client);
      findMany.mockResolvedValue(user ? [user] : []);
      await gateway.revalidateSessions();
      expect(disconnect).toHaveBeenCalledWith(true);
    },
  );

  it("fails closed when periodic permission verification fails", async () => {
    findUnique.mockResolvedValue({ deletedAt: null, role: { code: "SALES_MANAGER" } });
    const { client, disconnect } = socket();
    await gateway.handleConnection(client);
    findMany.mockRejectedValueOnce(new Error("Database offline"));
    await gateway.revalidateSessions();
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it("expires active sockets and removes timers on disconnect", async () => {
    jest.useFakeTimers();
    try {
      verify.mockReturnValue({ sub: 17, exp: Date.now() / 1000 + 10 });
      findUnique.mockResolvedValue({ deletedAt: null, role: { code: "SALES_MANAGER" } });
      const first = socket(),
        second = socket();
      await gateway.handleConnection(first.client);
      await gateway.handleConnection(second.client);
      gateway.handleDisconnect(second.client);
      jest.advanceTimersByTime(10000);
      expect(first.disconnect).toHaveBeenCalledWith(true);
      expect(second.disconnect).not.toHaveBeenCalled();
      gateway.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
