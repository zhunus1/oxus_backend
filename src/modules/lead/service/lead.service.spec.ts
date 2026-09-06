import { InternalServerErrorException } from "@nestjs/common";
import type { LeadRepository } from "../repository/lead.repository";
import type { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import type { LeadIngestionService } from "./lead-ingestion.service";
import type { CreateLeadDto } from "../api/dto/create-lead.dto";
import { LeadService } from "./lead.service";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("./lead-ingestion.service", () => ({ LeadIngestionService: class {} }));

describe("Legacy lead creation events", () => {
  const ingestLegacy = jest.fn(),
    emitLeadCreated = jest.fn();
  const service = new LeadService({} as LeadRepository, { ingestLegacy } as unknown as LeadIngestionService, { emitLeadCreated } as unknown as LeadRealtimeGateway);
  beforeEach(() => jest.clearAllMocks());

  it("preserves legacy phone response and emits the persisted Sales lead", async () => {
    const lead = { id: 31, phoneNumber: "+77770112233", status: "NEW" };
    ingestLegacy.mockResolvedValue({ lead, created: true });
    const result = await service.create({} as CreateLeadDto);
    expect(result.phone).toBe(lead.phoneNumber);
    expect(emitLeadCreated).toHaveBeenCalledTimes(1);
    expect(emitLeadCreated).toHaveBeenCalledWith(lead);
  });

  it("does not emit a second creation event for an ingestion replay", async () => {
    ingestLegacy.mockResolvedValue({ lead: { id: 31 }, created: false });
    await service.create({} as CreateLeadDto);
    expect(emitLeadCreated).not.toHaveBeenCalled();
  });

  it("does not emit when persistence fails", async () => {
    ingestLegacy.mockRejectedValue(new Error("Database unavailable"));
    await expect(service.create({} as CreateLeadDto)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(emitLeadCreated).not.toHaveBeenCalled();
  });
});
