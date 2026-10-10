import { publicAuditActions, toPublicAudit } from "./public-audit";

const row = {
  id: 1,
  action: "PROCESS_STEP_CHANGE",
  entityType: "StudentPortrait",
  entityId: 2,
  details: { from: "START", to: "DOCUMENTS", fileKey: "private", operationId: "private", futureSecret: { nested: "private" } },
  userId: 3,
  createdAt: new Date("2026-10-10T00:00:00Z"),
  user: { id: 3, firstname: "Synthetic", lastname: "Fixture", password: "private" },
  futureInternalField: "private",
};

describe("public audit allowlist", () => {
  it("preserves the business envelope while dropping sensitive and future fields", () => {
    expect(toPublicAudit(row)).toEqual({
      id: 1,
      action: "PROCESS_STEP_CHANGE",
      entityType: "StudentPortrait",
      entityId: 2,
      details: { from: "START", to: "DOCUMENTS" },
      userId: 3,
      createdAt: row.createdAt,
      user: { id: 3, firstname: "Synthetic", lastname: "Fixture" },
    });
  });

  it.each(["DOCUMENT_STORAGE_PENDING", "UNKNOWN_ACTION", "__proto__"])("excludes non-public action %s", action => {
    expect(toPublicAudit({ ...row, action })).toBeNull();
  });

  it.each(["DocumentStorageIntent", "UnknownEntity", "__proto__"])("excludes non-public entity %s", entityType => {
    expect(publicAuditActions(entityType)).toEqual([]);
    expect(toPublicAudit({ ...row, entityType })).toBeNull();
  });

  it("does not pass objects or arrays through allowed detail keys", () => {
    expect(toPublicAudit({ ...row, details: { from: { fileKey: "private" }, to: ["private"] } })?.details).toEqual({});
  });

  it("preserves null details for business actions without metadata", () => {
    expect(toPublicAudit({ ...row, action: "ROADMAP_GENERATED", details: null })?.details).toBeNull();
  });
});
