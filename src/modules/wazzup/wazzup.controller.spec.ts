import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "src/database/prisma.service";
import { LEAD_PERMISSION } from "src/modules/lead/domain/lead.constants";
import { WazzupClient } from "./wazzup.client";
import { WazzupModule } from "./wazzup.module";
import { WazzupAccessService } from "./wazzup-access.service";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("Wazzup HTTP authorization", () => {
  let app: INestApplication;
  const jwt = new JwtService();
  const previousSecret = process.env.JWT_SECRET;
  const secret = "wazzup-http-fixture-secret";
  const user = (id: number, code: string) => ({
    id,
    firstname: "Database",
    lastname: `User ${id}`,
    deletedAt: null as Date | null,
    role: { code, deletedAt: null as Date | null, permissions: [{ code: LEAD_PERMISSION.MANAGE_OWN }] },
  });
  const users = new Map([
    [1, user(1, "ADMIN")],
    [2, user(2, "SALES_MANAGER")],
    [3, user(3, "SALES_MANAGER")],
    [4, user(4, "EXPERT")],
    [5, user(5, "STUDENT")],
    [6, { ...user(6, "ADMIN"), deletedAt: new Date() }],
    [7, { ...user(7, "ADMIN"), role: { ...user(7, "ADMIN").role, deletedAt: new Date() } }],
    [8, { ...user(8, "SALES_MANAGER"), role: { ...user(8, "SALES_MANAGER").role, permissions: [] } }],
  ]);
  const leads = [
    { id: 10, assignedSalesManagerId: 2, acceptedAt: new Date(), deletedAt: null, phoneNumber: "+7 (700) 111-22-33", displayName: "Own client" },
    { id: 11, assignedSalesManagerId: 3, acceptedAt: new Date(), deletedAt: null, phoneNumber: "+77004445566", displayName: "Other client" },
    { id: 12, assignedSalesManagerId: null, acceptedAt: null, deletedAt: null, phoneNumber: "+77006667788", displayName: "Unassigned" },
    { id: 13, assignedSalesManagerId: 2, acceptedAt: new Date(), deletedAt: new Date(), phoneNumber: "+77009990011", displayName: "Deleted" },
    { id: 14, assignedSalesManagerId: 2, acceptedAt: null, deletedAt: null, phoneNumber: "+77009990022", displayName: "Assigned but not accepted" },
  ];
  const iframe = jest.fn().mockResolvedValue({ url: "https://123.wazzup24.com/chat/session?token=fixture" });
  const channels = jest.fn().mockResolvedValue([]);

  function http(id: number, path: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/integrations/wazzup/${path}`)
      .set("Authorization", `Bearer ${jwt.sign({ sub: id, roleCode: "ADMIN", firstname: "Forged" }, { secret })}`);
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const prisma = {
      user: { findUnique: jest.fn(({ where }: { where: { id: number } }) => Promise.resolve(users.get(where.id) ?? null)) },
      lead: {
        findFirst: jest.fn(({ where }: { where: { id: number; assignedSalesManagerId?: number; acceptedAt?: unknown } }) =>
          Promise.resolve(
            leads.find(
              lead =>
                lead.id === where.id &&
                !lead.deletedAt &&
                (!where.acceptedAt || lead.acceptedAt != null) &&
                (where.assignedSalesManagerId === undefined || lead.assignedSalesManagerId === where.assignedSalesManagerId),
            ) ?? null,
          ),
        ),
        findMany: jest.fn(({ where }: { where: { assignedSalesManagerId?: number; acceptedAt?: unknown; id?: { in: number[] } } }) =>
          Promise.resolve(
            leads.filter(
              lead =>
                !lead.deletedAt &&
                (!where.acceptedAt || lead.acceptedAt != null) &&
                (!where.id || where.id.in.includes(lead.id)) &&
                (where.assignedSalesManagerId === undefined || lead.assignedSalesManagerId === where.assignedSalesManagerId),
            ),
          ),
        ),
      },
    };
    const module = await Test.createTestingModule({ imports: [WazzupModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ WAZZUP_CHANNEL_ID: "fixture-channel" }))
      .overrideProvider(WazzupClient)
      .useValue({ iframe, channels })
      .overrideProvider(WazzupAccessService)
      .useValue({ withGrant: (id: number, work: (providerId: string, validate: () => Promise<void>) => Promise<unknown>) => work(String(id), async () => undefined) })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    await app.listen(0, "127.0.0.1");
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).post("/api/v1/integrations/wazzup/iframe").expect(401);
    expect(iframe).not.toHaveBeenCalled();
  });

  it.each([
    [4, 403],
    [5, 403],
    [6, 401],
    [7, 403],
    [8, 403],
    [999, 401],
  ])("rejects actor %i using current database state despite a forged ADMIN claim", async (id, status) => {
    await http(id, "iframe").expect(status);
    expect(iframe).not.toHaveBeenCalled();
  });

  it("ignores caller-supplied user, phone and scope, returning a non-cacheable owned lead session", async () => {
    const result = await http(2, "leads/10/iframe")
      .send({ user: { id: "1" }, phone: "+77004445566", scope: "card", filter: [{ chatType: "whatsapp", chatId: "77004445566" }] })
      .expect(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers.pragma).toBe("no-cache");
    const [payload, contacts] = iframe.mock.calls[0];
    expect(payload.user).toEqual({ id: "2", name: "Database User 2" });
    expect(payload.scope).toBe("global");
    expect(payload).not.toHaveProperty("filter");
    expect(payload.activeChat.chatId).toBe("77001112233");
    expect(contacts[0].responsibleUserId).toBe("2");
    expect(Object.keys(result.body)).toEqual(["url"]);
  });

  it.each([11, 12, 13, 14, 999])("does not expose foreign, unassigned, deleted, unaccepted, or missing lead %i to Sales", async id => {
    await http(2, `leads/${id}/iframe`).expect(404);
    expect(iframe).not.toHaveBeenCalled();
  });

  it.each(["invalid", "1.5", "0", "-1", "2147483648"])("validates lead ID %s", async id => {
    await http(2, `leads/${id}/iframe`).expect(400);
    expect(iframe).not.toHaveBeenCalled();
  });

  it("uses role-enforced global scope for Sales and synchronizes only owned contacts", async () => {
    await http(2, "iframe").expect(200);
    expect(iframe.mock.calls[0][0]).toEqual({
      user: { id: "2", name: "Database User 2" },
      scope: "global",
    });
    expect(iframe.mock.calls[0][1].map((contact: { id: string }) => contact.id)).toEqual(["lead-10"]);
  });

  it("allows ADMIN to open global chats and another manager's lead", async () => {
    await http(1, "iframe").expect(200);
    expect(iframe.mock.calls[0][0].scope).toBe("global");
    await http(1, "leads/11/iframe").expect(200);
    expect(iframe.mock.calls[1][1]).toEqual([]);
  });

  it("restricts channels to ADMIN", async () => {
    const authorization = (id: number) => `Bearer ${jwt.sign({ sub: id, roleCode: "ADMIN" }, { secret })}`;
    await request(app.getHttpServer()).get("/api/v1/integrations/wazzup/channels").set("Authorization", authorization(2)).expect(403);
    expect(channels).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get("/api/v1/integrations/wazzup/channels").set("Authorization", authorization(1)).expect(200);
    expect(channels).toHaveBeenCalledTimes(1);
  });

  it("isolates both Sales directions and rejects the previous owner after reassignment", async () => {
    await http(3, "leads/10/iframe").expect(404);
    await http(3, "leads/11/iframe").expect(200);
    const previousOwner = leads[0].assignedSalesManagerId;
    try {
      leads[0].assignedSalesManagerId = 3;
      await http(2, "leads/10/iframe").expect(404);
      await http(3, "leads/10/iframe").expect(200);
      await http(2, "iframe").expect(409);
    } finally {
      leads[0].assignedSalesManagerId = previousOwner;
    }
  });

  it("rejects the same JWT after the current role loses its management permission", async () => {
    await http(2, "leads/10/iframe").expect(200);
    const role = users.get(2)!.role;
    const permissions = role.permissions;
    try {
      role.permissions = [];
      await http(2, "leads/10/iframe").expect(403);
      await http(2, "iframe").expect(403);
    } finally {
      role.permissions = permissions;
    }
  });
});
