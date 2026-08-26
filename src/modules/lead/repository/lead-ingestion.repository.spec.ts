import type { PrismaService } from "src/database/prisma.service";
import { LeadIngestionRepository } from "./lead-ingestion.repository";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("LeadIngestionRepository", () => {
  it("stores source-specific JSON while leaving a manual lead unassigned", async () => {
    const leadCreate = jest.fn().mockResolvedValue({ id: 101 });
    const tx = { lead: { create: leadCreate } };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async operation => operation(tx)),
    } as unknown as PrismaService;
    const repository = new LeadIngestionRepository(prisma);
    const rawPayload = {
      name: "Аружан Сейдахмет",
      phone: "+7 777 482 19 33",
      answers: [{ question: "Из какого вы города?", answer: "Алматы" }],
    };

    await repository.createLeadWithSubmission({
      sourceId: 3,
      sourceCode: "office-manual",
      createdByUserId: 17,
      rawPayload,
      mapping: {
        normalized: { displayName: "Аружан Сейдахмет", phoneNumber: "+77774821933" },
        normalizedPayload: { displayName: "Аружан Сейдахмет", phoneNumber: "+77774821933" },
        metrics: { score: 935 },
        schemaVersion: "office-manual-v1",
      },
    });

    const createData = leadCreate.mock.calls[0][0].data;
    expect(createData.createdByUserId).toBe(17);
    expect(createData).not.toHaveProperty("assignedSalesManagerId");
    expect(createData.submissions.create.rawPayload).toEqual(rawPayload);
    expect(createData.submissions.create.metrics).toEqual({ score: 935 });
  });
});
