import type { PrismaService } from "src/database/prisma.service";
import { LeadRepository } from "./lead.repository";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("LeadRepository legacy API isolation", () => {
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const update = jest.fn();
  const prisma = { lead: { findMany, findFirst, update } } as unknown as PrismaService;
  const repository = new LeadRepository();
  Object.assign(repository, { prisma });

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
  });

  it("does not expose landing or office CRM leads through the old expert endpoint", async () => {
    await repository.findAll();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { originSource: { code: "legacy-contact-form" }, deletedAt: null },
      }),
    );
  });

  it("maps phone_number back to the old response property named phone", async () => {
    findMany.mockResolvedValue([
      {
        id: 8,
        firstName: "Aisha",
        lastName: "Bekova",
        phoneNumber: "+77001234567",
        email: "aisha@example.com",
        topic: "Study",
        interests: "UK",
        role: "student",
        preferredLanguage: "en",
        isContacted: false,
        contactedAt: null,
        contactedByUserId: null,
        contactedByUser: null,
        createdAt: new Date("2026-08-26T10:00:00.000Z"),
      },
    ]);

    const [lead] = await repository.findAll();

    expect(lead.phone).toBe("+77001234567");
    expect(lead).not.toHaveProperty("phoneNumber");
  });
});
