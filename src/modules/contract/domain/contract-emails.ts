import type { Contract, Prisma } from "generated/prisma/client";

export const CONTRACT_EMAIL_TYPES = ["CONTRACT_READY", "CONTRACT_SIGNED_COPY"] as const;

/** Records email intent in the signing transaction; each recipient can retry independently. */
export async function recordContractEmails(tx: Prisma.TransactionClient, contract: Contract, type: (typeof CONTRACT_EMAIL_TYPES)[number]): Promise<void> {
  const recipients = new Set([contract.studentId]);
  if (type === "CONTRACT_SIGNED_COPY" && contract.signedByUserId) recipients.add(contract.signedByUserId);
  await tx.notificationLog.createMany({
    data: [...recipients].map(userId => ({
      userId,
      channel: "EMAIL",
      type,
      status: "PENDING",
      content: type === "CONTRACT_READY" ? "Договор готов к подписанию" : "Копия подписанного договора",
      scheduledFor: new Date(),
      metadata: { contractId: contract.id },
    })),
  });
}
