import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PrismaService } from "src/database/prisma.service";
import { LEAD_PERMISSION } from "src/modules/lead/domain/lead.constants";
import type { WazzupClient } from "./wazzup.client";
import { WazzupService } from "./wazzup.service";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("WazzupService", () => {
  const findUser = jest.fn();
  const findLead = jest.fn();
  const listLeads = jest.fn();
  const iframe = jest.fn();
  const channels = jest.fn();
  const prisma = { user: { findUnique: findUser }, lead: { findFirst: findLead, findMany: listLeads } } as unknown as PrismaService;
  const client = { iframe, channels } as unknown as WazzupClient;
  const service = new WazzupService(prisma, client, new ConfigService({ WAZZUP_CHANNEL_ID: "test-channel" }));
  const actor = (role = "SALES_MANAGER") => ({
    id: 17,
    firstname: "Current",
    lastname: "User",
    deletedAt: null,
    role: { code: role, deletedAt: null, permissions: [{ code: LEAD_PERMISSION.MANAGE_OWN }] },
  });
  const lead = { id: 8, phoneNumber: "8 (700) 123-45-67", displayName: "Client" };

  beforeEach(() => {
    jest.resetAllMocks();
    findUser.mockResolvedValue(actor());
    findLead.mockResolvedValue(lead);
    listLeads.mockResolvedValue([lead]);
    iframe.mockResolvedValue({ url: "https://123.wazzup24.com/chat?token=fixture" });
  });

  it.each([
    null,
    actor("EXPERT"),
    actor("STUDENT"),
    { ...actor(), deletedAt: new Date() },
    { ...actor(), role: { ...actor().role, deletedAt: new Date() } },
    { ...actor(), role: { ...actor().role, permissions: [] } },
  ])("denies inactive or unauthorized actors without external calls: %j", async user => {
    findUser.mockResolvedValue(user);
    await expect(service.globalIframe(17)).rejects.toBeInstanceOf(ForbiddenException);
    expect(iframe).not.toHaveBeenCalled();
    expect(listLeads).not.toHaveBeenCalled();
  });

  it("restricts Sales to owned active leads and derives both user and phone from the database", async () => {
    await service.leadIframe(17, 8);
    expect(findLead).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 8, deletedAt: null, assignedSalesManagerId: 17, acceptedAt: { not: null } } }));
    expect(iframe).toHaveBeenCalledWith(
      {
        user: { id: "17", name: "Current User" },
        scope: "card",
        filter: [{ chatType: "whatsapp", chatId: "77001234567", name: "Client" }],
        activeChat: { chatType: "whatsapp", chatId: "77001234567", channelId: "test-channel" },
      },
      [{ id: "lead-8", responsibleUserId: "17", name: "Client", contactData: [{ chatType: "whatsapp", chatId: "77001234567" }] }],
      expect.any(Function),
    );
  });

  it("hides foreign, unassigned, or deleted lead cards without contacting Wazzup", async () => {
    findLead.mockResolvedValue(null);
    await expect(service.leadIframe(17, 8)).rejects.toBeInstanceOf(NotFoundException);
    expect(iframe).not.toHaveBeenCalled();
  });

  it.each([null, "", "invalid", "+7 700 123 45 67 ext 9", "+01234567890", "00000000000"])("rejects absent or malformed lead phones: %s", async phoneNumber => {
    findLead.mockResolvedValue({ ...lead, phoneNumber });
    await expect(service.leadIframe(17, 8)).rejects.toBeInstanceOf(BadRequestException);
    expect(iframe).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 2_147_483_648, NaN])("rejects invalid PostgreSQL lead IDs before querying: %s", async id => {
    await expect(service.leadIframe(17, id)).rejects.toBeInstanceOf(BadRequestException);
    expect(findLead).not.toHaveBeenCalled();
  });

  it("builds the Sales general window from assigned CRM phones, deduplicating chats and excluding invalid phones", async () => {
    listLeads.mockResolvedValue([lead, { ...lead, id: 9 }, { ...lead, id: 10, phoneNumber: "invalid" }]);
    await service.globalIframe(17);
    expect(listLeads).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assignedSalesManagerId: 17, acceptedAt: { not: null }, deletedAt: null, phoneNumber: { not: null } }, take: 1001 }),
    );
    const [payload, contacts] = iframe.mock.calls[0];
    expect(payload).toEqual({ user: { id: "17", name: "Current User" }, scope: "card", filter: [{ chatType: "whatsapp", chatId: "77001234567", name: "Client" }] });
    expect(contacts.map((contact: { id: string }) => contact.id)).toEqual(["lead-8", "lead-9"]);
  });

  it.each([[], [{ ...lead, phoneNumber: "invalid" }], Array.from({ length: 1001 }, () => lead)].map(leads => ({ leads })))(
    "never falls back to an unrestricted Sales session for empty or oversized selections",
    async ({ leads }) => {
      listLeads.mockResolvedValue(leads);
      await expect(service.globalIframe(17)).rejects.toBeInstanceOf(ConflictException);
      expect(iframe).not.toHaveBeenCalled();
    },
  );

  it("gives ADMIN a global window without querying or reassigning contacts", async () => {
    findUser.mockResolvedValue(actor("ADMIN"));
    await service.globalIframe(17);
    expect(iframe).toHaveBeenCalledWith({ user: { id: "17", name: "Current User" }, scope: "global" }, [], expect.any(Function));
    expect(listLeads).not.toHaveBeenCalled();
  });

  it("does not replace a lead's Wazzup owner when ADMIN opens its card", async () => {
    findUser.mockResolvedValue(actor("ADMIN"));
    await service.leadIframe(17, 8);
    expect(findLead).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 8, deletedAt: null } }));
    expect(iframe.mock.calls[0][1]).toEqual([]);
  });

  it("keeps account channel information ADMIN-only", async () => {
    await expect(service.channels(17)).rejects.toBeInstanceOf(ForbiddenException);
    expect(channels).not.toHaveBeenCalled();
    findUser.mockResolvedValue(actor("ADMIN"));
    channels.mockResolvedValue([]);
    await expect(service.channels(17)).resolves.toEqual([]);
  });

  it.each(["owner", "phone", "deleted", "not accepted"])("withholds an issued URL after a lead %s change", async change => {
    iframe.mockImplementation(async () => {
      listLeads.mockResolvedValue(change === "phone" ? [{ ...lead, phoneNumber: "+77007654321" }] : []);
      return { url: "https://123.wazzup24.com/chat?token=withheld" };
    });
    await expect(service.leadIframe(17, 8)).rejects.toMatchObject({ response: { code: "WAZZUP_ACCESS_CHANGED" } });
  });

  it.each(["permission", "role", "account"])("withholds an issued URL after a user %s change", async change => {
    iframe.mockImplementation(async () => {
      findUser.mockResolvedValue(change === "permission" ? { ...actor(), role: { ...actor().role, permissions: [] } } : change === "role" ? actor("ADMIN") : null);
      return { url: "https://123.wazzup24.com/chat?token=withheld" };
    });
    await expect(service.leadIframe(17, 8)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("checks access before writes and before requesting a session, not only after the provider returns", async () => {
    iframe.mockImplementation(async (_payload, _contacts, revalidate: () => Promise<void>) => {
      await revalidate();
      findUser.mockResolvedValue({ ...actor(), role: { ...actor().role, permissions: [] } });
      await revalidate();
      throw new Error("must not issue a session");
    });
    await expect(service.leadIframe(17, 8)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
