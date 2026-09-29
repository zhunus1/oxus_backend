import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "generated/prisma/client";

/** All contract writers call this inside Serializable transactions. Historical duplicates are retained. */
export async function lockStudentWithoutContract(tx: Prisma.TransactionClient, studentId: number) {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "User" WHERE id = ${studentId} FOR UPDATE`;
  if (!rows.length) throw new NotFoundException("Student not found");
  if (await tx.contract.findFirst({ where: { studentId }, select: { id: true } })) throw new ConflictException("Student already has a contract");
}

/** Serialize automatic allocation and skip occupied numbers, including gaps in historical data. */
export async function nextContractNumber(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(731924, 1)::text`;
  const year = new Date().getFullYear();
  let sequence = (await tx.contract.count()) + 1;
  for (;;) {
    const number = `OXUS-${year}-${String(sequence++).padStart(4, "0")}`;
    if (!(await tx.contract.findUnique({ where: { contractNumber: number }, select: { id: true } }))) return number;
  }
}
