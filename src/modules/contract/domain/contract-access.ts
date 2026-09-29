import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "generated/prisma/client";
import { LEAD_PERMISSION } from "src/modules/lead/domain/lead.constants";

export type ContractOperation = "read" | "manage" | "meta";

/** Recheck roles and permissions at the domain boundary, including calls without HTTP guards. */
export async function contractActor(tx: Prisma.TransactionClient, actorId: number, operation: ContractOperation = "read") {
  const user = await tx.user.findUnique({
    where: { id: actorId },
    select: {
      id: true,
      deletedAt: true,
      role: { select: { code: true, deletedAt: true, permissions: { where: { deletedAt: null }, select: { code: true } } } },
      consultantProfile: { select: { isActive: true } },
    },
  });
  if (!user || user.deletedAt || user.role.deletedAt || !["EXPERT", "ADMIN"].includes(user.role.code)) throw new ForbiddenException("Contract access denied");
  const isAdmin = user.role.code === "ADMIN";
  if (!isAdmin && (!user.consultantProfile?.isActive || (operation !== "read" && !user.role.permissions.some(p => p.code === LEAD_PERMISSION.RESPOND_EXPERT_CALL))))
    throw new ForbiddenException("Active expert with contract management permission required");
  return { id: user.id, isAdmin };
}

export const liveContractStudent = { deletedAt: null, role: { code: { in: ["STUDENT", "SCHOOLBOY"] }, deletedAt: null } } satisfies Prisma.UserWhereInput;

/** Current portrait assignment wins. A pending CRM lead is only a pre-assignment fallback. */
export function contractAccessWhere(actor: Awaited<ReturnType<typeof contractActor>>): Prisma.ContractWhereInput {
  return {
    AND: [
      { student: liveContractStudent },
      { OR: [{ lead: null }, { lead: { deletedAt: null } }] },
      ...(actor.isAdmin
        ? []
        : [
            {
              OR: [
                { student: { portrait: { assignedExpert: { userId: actor.id, isActive: true } } } },
                {
                  student: { OR: [{ portrait: null }, { portrait: { consultantProfileId: null } }] },
                  lead: { status: "CONTRACT_PENDING" as const, assignedExpertUserId: actor.id },
                },
              ],
            },
          ]),
    ],
  };
}

export async function assertContractAccess(tx: Prisma.TransactionClient, id: string, actorId: number, operation: ContractOperation = "read") {
  const actor = await contractActor(tx, actorId, operation);
  const contract = await tx.contract.findUnique({ where: { id }, select: { id: true } });
  if (!contract) throw new NotFoundException("Contract not found");
  if (!(await tx.contract.findFirst({ where: { id, ...contractAccessWhere(actor) }, select: { id: true } }))) throw new ForbiddenException("Contract access denied");
  return actor;
}

export async function assertStudentContractCreation(tx: Prisma.TransactionClient, studentId: number, actorId: number) {
  const actor = await contractActor(tx, actorId, "manage");
  const student = await tx.user.findFirst({
    where: { id: studentId, ...liveContractStudent, ...(actor.isAdmin ? {} : { portrait: { assignedExpert: { userId: actorId, isActive: true } } }) },
    select: { id: true },
  });
  if (!student) throw new ForbiddenException("Only the current expert may create this student's contract");
}

export async function assertStudentContractRead(tx: Prisma.TransactionClient, studentId: number, contractId?: string) {
  if (!(await tx.user.findFirst({ where: { id: studentId, ...liveContractStudent }, select: { id: true } }))) throw new ForbiddenException("Student contract access denied");
  if (contractId && !(await tx.contract.findFirst({ where: { id: contractId, studentId, ...contractAccessWhere({ id: studentId, isAdmin: true }) }, select: { id: true } })))
    throw new ForbiddenException("Student contract access denied");
}
