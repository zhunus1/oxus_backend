import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateContractMetaDto } from "./update-contract-meta.dto";

describe("UpdateContractMetaDto contract numbers", () => {
  it.each(["OXUS-2026-0001", "OXUS-2026-CRM-000001", "OXUS-2026-CRM-1234567", "OXUS-2026-CRM-2147483647"])(
    "accepts %s when returning the current number with a price edit",
    async contractNumber => {
      expect(await validate(plainToInstance(UpdateContractMetaDto, { contractNumber, price: 120000 }))).toEqual([]);
    },
  );
  it.each(["OXUS-2026-CRM-1", "OXUS-2026-CRM-12345678901", "OXUS-2026-12345", "other", "OXUS-2026-CRM-000001\n"])("rejects malformed number %j", async contractNumber => {
    expect((await validate(plainToInstance(UpdateContractMetaDto, { contractNumber }))).map(error => error.property)).toContain("contractNumber");
  });
});
