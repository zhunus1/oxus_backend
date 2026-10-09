import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";

export type StudentDocumentOperation = "read" | "staff-read" | "review" | "self";

@Injectable()
export class StudentDocumentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async portraitWhere(actorId: number, operation: StudentDocumentOperation, db: Prisma.TransactionClient = this.prisma): Promise<Prisma.StudentPortraitWhereInput> {
    const actor = await db.user.findUnique({
      where: { id: actorId },
      select: { deletedAt: true, role: { select: { code: true, deletedAt: true } }, consultantProfile: { select: { isActive: true } } },
    });
    if (!actor || actor.deletedAt || actor.role.deletedAt) throw new ForbiddenException("Document access denied");
    const role = actor.role.code;
    if (operation !== "self" && role === "ADMIN") return {};
    if (operation !== "self" && role === "EXPERT" && actor.consultantProfile?.isActive) {
      return { assignedExpert: { userId: actorId, isActive: true, user: { deletedAt: null, role: { code: "EXPERT", deletedAt: null } } } };
    }
    if (["read", "self"].includes(operation) && ["STUDENT", "SCHOOLBOY"].includes(role)) return { userId: actorId };
    throw new ForbiddenException("Document access denied");
  }

  async assertPortrait(actorId: number, portraitId: number, operation: StudentDocumentOperation = "read", db: Prisma.TransactionClient = this.prisma) {
    const where = await this.portraitWhere(actorId, operation, db);
    if (!(await db.studentPortrait.findFirst({ where: { id: portraitId, ...where }, select: { id: true } }))) {
      throw new ForbiddenException("Document access denied");
    }
    return where;
  }

  async assertOwnTargetProgram(targetProgramId: number, portraitId: number) {
    if (!(await this.prisma.targetProgram.findFirst({ where: { id: targetProgramId, studentPortraitId: portraitId }, select: { id: true } }))) {
      // The same error for a missing program and a program owned by another student.
      throw new ForbiddenException("Target program is not available for this student");
    }
  }
}
