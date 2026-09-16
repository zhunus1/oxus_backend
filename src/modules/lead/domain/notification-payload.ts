import type { NotificationLog, Prisma } from "generated/prisma/client";

/** Exposes language-independent notifications through HTTP and realtime, including legacy records. */
export function notificationPayload<T extends Pick<NotificationLog, "type" | "metadata"> & { content?: string }>(
  notification: T,
): Omit<T, "content"> & { params: Prisma.JsonObject | null } {
  const payload = { ...notification };
  delete payload.content;
  const metadata = notification.metadata;
  const params = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata.params : null;
  return {
    ...payload,
    // Missing historical snapshots require a generic localized message on the client.
    params: params && typeof params === "object" && !Array.isArray(params) ? params : notification.type === "LEAD_EXPERT_CALL_REQUEST" ? {} : null,
  };
}
