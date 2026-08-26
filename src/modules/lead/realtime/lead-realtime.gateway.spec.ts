import type { JwtService } from "@nestjs/jwt";
import type { Socket } from "socket.io";
import type { PrismaService } from "src/database/prisma.service";
import { LeadRealtimeGateway } from "./lead-realtime.gateway";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("LeadRealtimeGateway connection authorization", () => {
  const verify = jest.fn();
  const jwt = { verify } as unknown as JwtService;
  const findUnique = jest.fn();
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  const gateway = new LeadRealtimeGateway(jwt, prisma);

  function socket(token = "valid-token") {
    const join = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn();
    const client = {
      handshake: { auth: { token }, headers: {} },
      data: {},
      join,
      disconnect,
    } as unknown as Socket;
    return { client, join, disconnect };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    verify.mockReturnValue({ sub: "17" });
  });

  it("joins a Sales Manager only to the shared new-lead room and their private room", async () => {
    findUnique.mockResolvedValue({ deletedAt: null, role: { code: "SALES_MANAGER" } });
    const { client, join, disconnect } = socket();

    await gateway.handleConnection(client);

    expect(join).toHaveBeenNthCalledWith(1, "sales:unassigned");
    expect(join).toHaveBeenNthCalledWith(2, "sales:user:17");
    expect(client.data).toEqual(expect.objectContaining({ userId: 17, roleCode: "SALES_MANAGER" }));
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("joins an expert only to that expert's private room", async () => {
    findUnique.mockResolvedValue({ deletedAt: null, role: { code: "EXPERT" } });
    const { client, join } = socket();

    await gateway.handleConnection(client);

    expect(join).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledWith("expert:user:17");
  });

  it("disconnects a different role even when its token is valid", async () => {
    findUnique.mockResolvedValue({ deletedAt: null, role: { code: "STUDENT" } });
    const { client, join, disconnect } = socket();

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
    expect(join).not.toHaveBeenCalled();
  });

  it("disconnects malformed JWT user ids before querying the database", async () => {
    verify.mockReturnValue({ sub: "17abc" });
    const { client, disconnect } = socket();

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
