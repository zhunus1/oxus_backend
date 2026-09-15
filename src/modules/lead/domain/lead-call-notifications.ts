import type { LeadExpertCall, Prisma } from "generated/prisma/client";

export const LEAD_CALL_NOTIFICATION_TYPES = ["LEAD_EXPERT_CALL_ASSIGNED", "LEAD_EXPERT_CALL_REMINDER"] as const;
export const LEAD_CALL_REMINDER_MS = 10 * 60 * 1000;

type ScheduledCall = Pick<LeadExpertCall, "id" | "leadId" | "expertUserId" | "startTime" | "endTime" | "updatedAt">;

/** Persists delivery intents in the booking transaction. Only email is enabled for now. */
export async function scheduleLeadCallNotifications(tx: Prisma.TransactionClient, call: ScheduledCall) {
  const now = new Date();
  const data = LEAD_CALL_NOTIFICATION_TYPES.map(type => ({
    userId: call.expertUserId,
    leadId: call.leadId,
    channel: "EMAIL",
    type,
    status: "PENDING",
    content: "",
    deliveryKey: `lead-call-${call.id}-${call.updatedAt.toISOString()}-${type}-EMAIL`,
    scheduledFor: type === "LEAD_EXPERT_CALL_ASSIGNED" ? now : new Date(Math.max(now.getTime(), call.startTime.getTime() - LEAD_CALL_REMINDER_MS)),
    metadata: { callId: call.id, startTime: call.startTime.toISOString(), endTime: call.endTime.toISOString() },
  }));

  await tx.notificationLog.updateMany({
    where: {
      leadId: call.leadId,
      channel: "EMAIL",
      type: { in: [...LEAD_CALL_NOTIFICATION_TYPES] },
      status: { in: ["PENDING", "SENDING"] },
      metadata: { path: ["callId"], equals: call.id },
      deliveryKey: { notIn: data.map(notification => notification.deliveryKey) },
    },
    data: { status: "CANCELLED", deliveryLeaseUntil: null },
  });
  await tx.notificationLog.createMany({ data, skipDuplicates: true });
}

/** Plain text can be reused by another delivery channel without changing booking rules. */
export function formatLeadCallNotification(
  call: { startTime: Date; timezone: string; leadName: string | null; leadId: number; confirmed: boolean; office: boolean },
  reminder: boolean,
) {
  const time = call.startTime.toLocaleString("ru-RU", {
    timeZone: call.timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const name = call.leadName?.trim().slice(0, 200) || `№${call.leadId}`;
  const event = call.office ? "встреча в офисе" : "созвон";
  const subject = reminder ? "Напоминание о встрече с лидом" : "Вам назначена встреча с лидом";
  const text = reminder
    ? `Скоро начнётся ${event} с лидом ${name}. Начало: ${time} (${call.timezone}).`
    : `Вам назначен${call.office ? "а" : ""} ${event} с лидом ${name} на ${time} (${call.timezone}).${call.confirmed ? "" : " Подтвердите встречу в личном кабинете."}`;
  return { subject, text };
}
