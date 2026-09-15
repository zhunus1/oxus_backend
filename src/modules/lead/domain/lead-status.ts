import type { LeadStatus } from "generated/prisma/enums";

/** Apply together with the status inside the transaction that read the lead. */
export function leadStatusUpdate(currentStatus: LeadStatus, status: LeadStatus) {
  return { status, ...(currentStatus !== status ? { statusChangedAt: new Date() } : {}) };
}
