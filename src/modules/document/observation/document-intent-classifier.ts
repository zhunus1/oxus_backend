export const INTENT_NAMESPACES = ["DocumentStorageIntent", "StudentPortrait"] as const;
export const INTENT_STATES = ["PENDING", "ROLLED_BACK", "COMMITTED", "CLEANED"] as const;
export const OBSERVATION_CATEGORIES = [
  "IN_FLIGHT_OR_UNKNOWN",
  "UNRESOLVED_PENDING",
  "ROLLED_BACK_UNRESOLVED",
  "COMMITTED_REFERENCED",
  "COMMITTED_MISSING_REFERENCE",
  "CLEANED_TERMINAL",
  "REFERENCED_OBJECT",
  "MANUAL_REVIEW_REQUIRED",
  "MALFORMED_INTENT",
] as const;
export type IntentState = (typeof INTENT_STATES)[number];
export type ObservationCategory = (typeof OBSERVATION_CATEGORIES)[number];
export const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = new RegExp(`^${UUID_PATTERN}$`);
const privateKey = new RegExp(`^documents/${UUID_PATTERN}$`);
export interface ObservedIntent {
  id: number;
  action: string;
  entityType: string;
  entityId: number;
  details: unknown;
  createdAt: Date;
}
export interface ReferenceFacts {
  count: number;
  archived: number;
  firstPortraitId: number | null;
  lastPortraitId: number | null;
}
export const NO_REFERENCES: ReferenceFacts = { count: 0, archived: 0, firstPortraitId: null, lastPortraitId: null };
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function observedPrivateKey(details: unknown): string | undefined {
  return object(details) && typeof details.fileKey === "string" && privateKey.test(details.fileKey) ? details.fileKey : undefined;
}
export function validIntent(intent: ObservedIntent): boolean {
  const d = intent.details;
  return (
    positiveId(intent.id) &&
    intent.action === "DOCUMENT_STORAGE_PENDING" &&
    INTENT_NAMESPACES.some(namespace => namespace === intent.entityType) &&
    object(d) &&
    typeof d.operationId === "string" &&
    uuid.test(d.operationId) &&
    observedPrivateKey(d) !== undefined &&
    positiveId(d.studentPortraitId) &&
    d.studentPortraitId === intent.entityId &&
    positiveId(d.ownerUserId) &&
    (d.documentId === null || positiveId(d.documentId)) &&
    INTENT_STATES.some(state => state === d.state) &&
    intent.createdAt instanceof Date &&
    Number.isFinite(intent.createdAt.getTime())
  );
}
/** Facts at read time only. This contract deliberately has no action, proof or mutation output. */
export function classifyIntent(
  intent: ObservedIntent,
  references: ReferenceFacts,
  now: Date,
  staleAfterMs: number,
): { category: ObservationCategory; state: IntentState | "UNKNOWN"; referenced: boolean } {
  const d = object(intent.details) ? intent.details : {};
  const state = INTENT_STATES.find(value => value === d.state) ?? "UNKNOWN";
  const referenced = references.count > 0;
  let category: ObservationCategory;
  if (!validIntent(intent)) category = "MALFORMED_INTENT";
  else if (
    (referenced && (references.firstPortraitId !== d.studentPortraitId || references.lastPortraitId !== d.studentPortraitId || state === "CLEANED")) ||
    (object(d.recovery) && (d.recovery.deleteFenced === true || typeof d.recovery.manualReason === "string"))
  )
    category = "MANUAL_REVIEW_REQUIRED";
  else if (referenced) category = state === "COMMITTED" ? "COMMITTED_REFERENCED" : "REFERENCED_OBJECT";
  else if (state === "COMMITTED") category = "COMMITTED_MISSING_REFERENCE";
  else if (state === "CLEANED") category = "CLEANED_TERMINAL";
  else if (state === "ROLLED_BACK") category = "ROLLED_BACK_UNRESOLVED";
  else category = now.getTime() - intent.createdAt.getTime() < staleAfterMs ? "IN_FLIGHT_OR_UNKNOWN" : "UNRESOLVED_PENDING";
  return { category, state, referenced };
}
