import { BadRequestException } from "@nestjs/common";
import { CreateManualLeadDto } from "../api/dto/sales/create-manual-lead.dto";
import { OfficeManualAdapter } from "./office-manual.adapter";

describe("OfficeManualAdapter", () => {
  const adapter = new OfficeManualAdapter();
  const payload: CreateManualLeadDto = {
    name: "Аружан Сейдахмет",
    phone: "+7 777 482 19 33",
    role: "parent",
    locale: "kk",
    answers: [{ question: "Из какого вы города?", answer: "Алматы" }],
  };

  it("keeps a valid office submission source-specific and normalized", () => {
    const result = adapter.map(payload);

    expect(result.normalized).toEqual({
      displayName: "Аружан Сейдахмет",
      phoneNumber: "+77774821933",
      email: undefined,
      role: "parent",
      preferredLanguage: "kk",
    });
    expect(result.schemaVersion).toBe("office-manual-v1");
  });

  it("rejects an empty answer object just like the landing adapter", () => {
    expect(() => adapter.map({ ...payload, answers: [{}] })).toThrow(BadRequestException);
  });
});
