import { ValidationPipe } from "@nestjs/common";
import { PrepareLeadContractDto } from "./prepare-lead-contract.dto";
import { UpdateAccountProfileDto } from "src/modules/account/api/dto/update-account-profile.dto";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe.each([
  {
    name: "contract preparation",
    metatype: PrepareLeadContractDto,
    body: { firstname: "Алия", lastname: "Омарова", email: "student@example.test", phone: "+77010000001", subscriptionTier: "EXPERT_MENTORSHIP", price: 100000, currency: "KZT" },
  },
  { name: "account profile", metatype: UpdateAccountProfileDto, body: { firstname: "Алия" } },
])("optional patronymic in $name", ({ metatype, body }) => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false });
  const metadata = { type: "body" as const, metatype };

  it("accepts existing requests without patronymic", async () => {
    const result = await pipe.transform(body, metadata);
    expect(result).toMatchObject(body);
    expect(result.middlename).toBeUndefined();
  });

  it("trims the patronymic without splitting or changing the other name fields", async () => {
    await expect(pipe.transform({ ...body, middlename: "  Серік қызы  " }, metadata)).resolves.toMatchObject({ ...body, middlename: "Серік қызы" });
  });

  it.each([null, "", "   "])("normalizes absent patronymic %j to null", async middlename => {
    await expect(pipe.transform({ ...body, middlename }, metadata)).resolves.toMatchObject({ middlename: null });
  });

  it.each([123, false, ["Сериковна"], {}, "а".repeat(101)])("rejects invalid patronymic %j", async middlename => {
    await expect(pipe.transform({ ...body, middlename }, metadata)).rejects.toMatchObject({ status: 400 });
  });
});
