import { BadRequestException, ConflictException } from "@nestjs/common";
import { assertDocumentSnapshot, nextDocumentTimestamp } from "./document-snapshot";
import { StaffCreateDocumentDto, StaffDocumentsQueryDto, StaffDocumentSnapshotDto, StaffUpdateDocumentDto, staffDocumentId, validateStaffDto } from "../api/dto/staff-document.dto";
import type { PublicDocument } from "src/common/serialization/public-document";

jest.mock("generated/prisma/client", () => ({ RequirementType: { OTHER: "OTHER" }, DocumentStatus: { DRAFT: "DRAFT" } }));
const updatedAt = new Date("2026-10-10T00:00:00.000Z");
const doc = { version: 3, updatedAt } as PublicDocument;
const snapshot = { expectedVersion: 3, expectedUpdatedAt: updatedAt.toISOString() };

describe("document timestamp CAS", () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([0, -1000, 1000])("strictly advances the snapshot despite wall clock delta %i", delta => {
    jest.spyOn(Date, "now").mockReturnValue(updatedAt.getTime() + delta);
    const next = nextDocumentTimestamp(updatedAt);
    expect(next.getTime()).toBe(Math.max(updatedAt.getTime() + delta, updatedAt.getTime() + 1));
    expect(nextDocumentTimestamp(next).getTime()).toBeGreaterThan(next.getTime());
  });
  it("accepts exactly the observed version and timestamp", () => expect(() => assertDocumentSnapshot(doc, snapshot)).not.toThrow());
  it.each([
    { ...snapshot, expectedVersion: 2 },
    { ...snapshot, expectedUpdatedAt: "2026-10-10T00:00:00.001Z" },
  ])("rejects stale snapshot %p", value => {
    expect(() => assertDocumentSnapshot(doc, value)).toThrow(ConflictException);
  });
  it.each(["2026-02-30T00:00:00.000Z", "2026-10-10T00:00:00Z", "2026-10-10T01:00:00.000+01:00", "invalid"])("rejects ambiguous timestamp %s", value => {
    expect(() => assertDocumentSnapshot(doc, { ...snapshot, expectedUpdatedAt: value })).toThrow(BadRequestException);
  });
});
describe("staff service input contract", () => {
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648, "1e2", "0x10", "01", "-1", "1.5", null])("rejects malformed DB identity %p", value => {
    expect(() => staffDocumentId(value)).toThrow(BadRequestException);
  });
  it("accepts positive Int identity without treating User.id as portrait identity", () => expect(staffDocumentId("2147483647")).toBe(2147483647));
  it.each(["studentPortraitId", "fileKey", "fileUrl", "status", "version", "feedback", "deletedAt", "documentType", "targetProgramId", "recovery"])(
    "rejects metadata mass assignment %s even in direct service input",
    field => {
      expect(() => validateStaffDto(StaffUpdateDocumentDto, { ...snapshot, title: "Valid", [field]: "private" })).toThrow(BadRequestException);
    },
  );
  it.each([null, "", "  ", "x".repeat(256)])("rejects unusable metadata title %p", title => {
    expect(() => validateStaffDto(StaffUpdateDocumentDto, { ...snapshot, title } as any)).toThrow(BadRequestException);
  });
  it("trims title without supplying protected metadata", () => expect(validateStaffDto(StaffUpdateDocumentDto, { ...snapshot, title: " Valid " }).title).toBe("Valid"));
  it("requires both snapshot fields on direct replacement/delete calls", () => expect(() => validateStaffDto(StaffDocumentSnapshotDto, {} as any)).toThrow(BadRequestException));
  it("does not coerce nullable target into an owned program", () =>
    expect(() => validateStaffDto(StaffCreateDocumentDto, { title: "Valid", documentType: "OTHER", targetProgramId: null } as any)).toThrow(BadRequestException));
});

describe("F-3-R01 raw numeric staff contract", () => {
  it.each([true, false, "1", null, [], [1], {}, 1.5, 0, -1, 2147483648, NaN, Infinity])("rejects raw JSON version %p before DTO coercion", expectedVersion => {
    for (const type of [StaffDocumentSnapshotDto, StaffUpdateDocumentDto])
      expect(() => validateStaffDto(type, { ...snapshot, ...(type === StaffUpdateDocumentDto ? { title: "Valid" } : {}), expectedVersion } as any)).toThrow(BadRequestException);
  });

  const encodedInputs = (value: unknown) => [
    () => validateStaffDto(StaffDocumentSnapshotDto, { ...snapshot, expectedVersion: value } as any, "decimal"),
    () => validateStaffDto(StaffCreateDocumentDto, { title: "Valid", documentType: "OTHER", targetProgramId: value } as any, "decimal"),
    ...["page", "limit", "targetProgramId"].map(field => () => validateStaffDto(StaffDocumentsQueryDto, { [field]: value } as any, "decimal")),
  ];
  it.each(["0x10", "1e2", " 1", "1 ", "01", "+1", "-1", "1.5", "0", "true", "false", ""])("rejects noncanonical decimal %p in every encoded staff field", value => {
    for (const run of encodedInputs(value)) expect(run).toThrow(BadRequestException);
    expect(() => staffDocumentId(value)).toThrow(BadRequestException);
  });
  it.each([true, false, [], ["1"], {}, null])("rejects nonscalar primitive %p even with decimal transport", value => {
    for (const run of encodedInputs(value)) expect(run).toThrow(BadRequestException);
    expect(() => staffDocumentId(value)).toThrow(BadRequestException);
  });
  it("does not invoke an object's numeric conversion hooks", () => {
    const valueOf = jest.fn(() => 1);
    for (const run of encodedInputs({ valueOf })) expect(run).toThrow(BadRequestException);
    expect(valueOf).not.toHaveBeenCalled();
  });
  it("accepts typed JSON version and canonical multipart version with the same timestamp", () => {
    expect(validateStaffDto(StaffDocumentSnapshotDto, snapshot)).toEqual(snapshot);
    expect(validateStaffDto(StaffDocumentSnapshotDto, { ...snapshot, expectedVersion: "3" } as any, "decimal")).toEqual(snapshot);
  });
  it("accepts typed service IDs and canonical query numbers within existing bounds", () => {
    expect(validateStaffDto(StaffCreateDocumentDto, { title: "Valid", documentType: "OTHER", targetProgramId: 2147483647 } as any).targetProgramId).toBe(2147483647);
    expect(validateStaffDto(StaffDocumentsQueryDto, { page: "1", limit: "100", targetProgramId: "2147483647" } as any, "decimal")).toMatchObject({
      page: 1,
      limit: 100,
      targetProgramId: 2147483647,
    });
    expect(validateStaffDto(StaffDocumentsQueryDto, { page: Number.MAX_SAFE_INTEGER, limit: 20 }).page).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("preserves version/program/pagination overflow boundaries", () => {
    for (const run of [
      () => validateStaffDto(StaffDocumentSnapshotDto, { ...snapshot, expectedVersion: "2147483648" } as any, "decimal"),
      () => validateStaffDto(StaffCreateDocumentDto, { title: "Valid", documentType: "OTHER", targetProgramId: "2147483648" } as any, "decimal"),
      () => validateStaffDto(StaffDocumentsQueryDto, { limit: "101" } as any, "decimal"),
      () => validateStaffDto(StaffDocumentsQueryDto, { page: "9007199254740992" } as any, "decimal"),
    ])
      expect(run).toThrow(BadRequestException);
  });
});
