import { classifyIntent, NO_REFERENCES, observedPrivateKey, validIntent, type ObservedIntent } from "./document-intent-classifier";
const key = "documents/550e8400-e29b-41d4-a716-446655440000";
const now = new Date("2026-10-10T00:00:00Z");
const row = (state = "PENDING", details: unknown = {}) => ({
  id: 1,
  action: "DOCUMENT_STORAGE_PENDING",
  entityType: "DocumentStorageIntent",
  entityId: 2,
  createdAt: new Date(now.getTime() - 60_000),
  details: { operationId: "550e8400-e29b-41d4-a716-446655440001", fileKey: key, studentPortraitId: 2, ownerUserId: 3, documentId: null, state, ...(details as object) },
});
const refs = { count: 2, archived: 1, firstPortraitId: 2, lastPortraitId: 2 };
describe("read-only intent classification", () => {
  it.each([
    ["PENDING", NO_REFERENCES, "IN_FLIGHT_OR_UNKNOWN"],
    ["ROLLED_BACK", NO_REFERENCES, "ROLLED_BACK_UNRESOLVED"],
    ["COMMITTED", NO_REFERENCES, "COMMITTED_MISSING_REFERENCE"],
    ["CLEANED", NO_REFERENCES, "CLEANED_TERMINAL"],
    ["PENDING", refs, "REFERENCED_OBJECT"],
    ["ROLLED_BACK", refs, "REFERENCED_OBJECT"],
    ["COMMITTED", refs, "COMMITTED_REFERENCED"],
    ["CLEANED", refs, "MANUAL_REVIEW_REQUIRED"],
    ["OTHER", NO_REFERENCES, "MALFORMED_INTENT"],
  ])("classifies %s with reference facts", (state, references, category) => {
    expect(classifyIntent(row(state), references, now, 300_000).category).toBe(category);
  });
  it("staleness changes observation only at the exact threshold", () => {
    const intent = row();
    expect(classifyIntent(intent, NO_REFERENCES, now, 60_000).category).toBe("UNRESOLVED_PENDING");
    expect(classifyIntent(intent, NO_REFERENCES, now, 60_001).category).toBe("IN_FLIGHT_OR_UNKNOWN");
    intent.createdAt = new Date(now.getTime() + 1000);
    expect(classifyIntent(intent, NO_REFERENCES, now, 60_000).category).toBe("IN_FLIGHT_OR_UNKNOWN");
  });
  it.each(["DocumentStorageIntent", "StudentPortrait"])("accepts %s technical namespace", entityType => {
    expect(validIntent({ ...row(), entityType })).toBe(true);
  });
  it.each([null, undefined, [], 1, "PENDING", true])("rejects malformed JSON %p", details => {
    expect(classifyIntent({ ...row(), details }, NO_REFERENCES, now, 1000).category).toBe("MALFORMED_INTENT");
    expect(observedPrivateKey(details)).toBeUndefined();
  });
  it.each([
    ["operationId", undefined],
    ["operationId", 1],
    ["operationId", "invalid"],
    ["fileKey", undefined],
    ["fileKey", 1],
    ["fileKey", "../secret"],
    ["fileKey", "https://example.test/file"],
    ["studentPortraitId", "2"],
    ["studentPortraitId", 0],
    ["studentPortraitId", 2.5],
    ["studentPortraitId", 4],
    ["ownerUserId", -1],
    ["ownerUserId", "3"],
    ["ownerUserId", Number.MAX_SAFE_INTEGER + 1],
    ["ownerUserId", NaN],
    ["ownerUserId", Infinity],
    ["documentId", undefined],
    ["documentId", "1"],
    ["documentId", 0],
    ["documentId", 1.5],
    ["state", null],
    ["state", 1],
    ["state", "UNKNOWN"],
  ])("rejects typed field %s=%p", (field, value) => {
    expect(validIntent(row("PENDING", { [field]: value }))).toBe(false);
  });
  it.each([{ id: 0 }, { action: "DOCUMENT_CREATED" }, { entityType: "Document" }, { entityId: 3 }, { createdAt: new Date(NaN) }])("rejects invalid envelope %p", change => {
    expect(validIntent({ ...row(), ...change })).toBe(false);
  });
  it("retains unknown fields without inventing proof or mutation outputs", () => {
    const intent = row("PENDING", { future: { retained: true }, documentId: 4 });
    const before = JSON.stringify(intent);
    const classification = classifyIntent(intent, NO_REFERENCES, now, 1000);
    expect(Object.keys(classification).sort()).toEqual(["category", "referenced", "state"]);
    expect(JSON.stringify(intent)).toEqual(before);
    expect(JSON.stringify(classification)).not.toMatch(/fileKey|operationId|deleteFenced|CLEANED|action|proof/);
  });
  it("archived-only references protect the observed object", () => {
    expect(classifyIntent(row(), { ...refs, count: 1, archived: 1 }, now, 1000).category).toBe("REFERENCED_OBJECT");
  });
  it("foreign portrait references require manual investigation", () => {
    expect(classifyIntent(row("COMMITTED"), { ...refs, lastPortraitId: 9 }, now, 1000).category).toBe("MANUAL_REVIEW_REQUIRED");
  });
  it.each([{ deleteFenced: true }, { manualReason: "unknown" }])("preserves preexisting manual/fence metadata %p", recovery => {
    expect(classifyIntent(row("ROLLED_BACK", { recovery }), NO_REFERENCES, now, 1000).category).toBe("MANUAL_REVIEW_REQUIRED");
  });
  it("canonical key validation rejects high-bit and non-v4 mutations", () => {
    expect(observedPrivateKey({ fileKey: key })).toBe(key);
    expect(observedPrivateKey({ fileKey: key.replace("41d4", "11d4") })).toBeUndefined();
    expect(observedPrivateKey({ fileKey: key.replace("documents", "documentś") })).toBeUndefined();
  });
  it("accepts JSON numeric integer representations", () => {
    expect(validIntent(row("PENDING", JSON.parse('{"ownerUserId":3.0}')) as ObservedIntent)).toBe(true);
  });
});
