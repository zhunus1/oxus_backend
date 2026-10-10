import type { Prisma } from "generated/prisma/client";

// New actions/fields require an explicit public contract; technical journal entries are excluded.
const DETAIL_FIELDS: Record<string, Record<string, readonly string[]>> = {
  StudentPortrait: {
    SUBSCRIPTION_UPDATE: ["fromSubscription", "toSubscription", "fromConsultationBalance", "toConsultationBalance"],
    PROCESS_STEP_CHANGE: ["from", "to"],
    DATA_FREEZE: ["subscription"],
    ROADMAP_GENERATED: [],
    ROADMAP_REGENERATED: [],
    EXPERT_SELECTED: ["consultantProfileId", "expertName"],
    EXPERT_ASSIGN_STUDENT: ["consultantProfileId"],
    EXPERT_TRANSFER_STUDENT: ["studentUserId", "fromConsultantProfileId", "toConsultantProfileId", "toExpertUserId", "toExpertName"],
    STALE_COMMENT: ["comment"],
  },
  TargetProgram: { STATUS_CHANGE: ["from", "to", "comment"] },
  Document: {
    DOCUMENT_CREATED: ["fromStatus", "toStatus", "fromVersion", "toVersion"],
    DOCUMENT_VERSION_UPLOADED: ["fromStatus", "toStatus", "fromVersion", "toVersion"],
    DOCUMENT_REVIEW: ["fromStatus", "toStatus", "feedback"],
  },
};

export const PUBLIC_AUDIT_SELECT = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  details: true,
  userId: true,
  createdAt: true,
  user: { select: { id: true, firstname: true, lastname: true } },
} satisfies Prisma.AuditLogSelect;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof PUBLIC_AUDIT_SELECT }>;

export function publicAuditActions(entityType: string): string[] {
  return Object.hasOwn(DETAIL_FIELDS, entityType) ? Object.keys(DETAIL_FIELDS[entityType]) : [];
}

export function toPublicAudit(row: AuditRow) {
  const actions = Object.hasOwn(DETAIL_FIELDS, row.entityType) ? DETAIL_FIELDS[row.entityType] : undefined;
  if (!actions || !Object.hasOwn(actions, row.action)) return null;
  const details: Record<string, string | number | boolean | null> = {};
  if (row.details && typeof row.details === "object" && !Array.isArray(row.details)) {
    for (const field of actions[row.action]) {
      const value = row.details[field];
      if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) details[field] = value;
    }
  }
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    details: row.details === null ? null : details,
    userId: row.userId,
    createdAt: row.createdAt,
    user: { id: row.user.id, firstname: row.user.firstname, lastname: row.user.lastname },
  };
}
