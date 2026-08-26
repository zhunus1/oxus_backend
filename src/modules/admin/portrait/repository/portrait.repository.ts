import { Injectable } from "@nestjs/common";
import { ApplicationStatus, Prisma, ProcessStep } from "generated/prisma/client";
import { BaseRepository } from "src/database/prisma.repository";
import { StudentPortraitQueryDto } from "../api/dto/student-portrait-query.dto";

@Injectable()
export class PortraitRepository extends BaseRepository {
  private readonly listInclude = {
    user: { omit: { password: true } },
  } satisfies Prisma.StudentPortraitInclude;

  private readonly detailInclude = {
    user: { omit: { password: true } },
    languages: {
      include: {
        language: true,
      },
    },
    tests: true,
    targetCountries: {
      include: {
        country: true,
      },
    },
  } satisfies Prisma.StudentPortraitInclude;

  async findMany(query: StudentPortraitQueryDto) {
    const where: Prisma.StudentPortraitWhereInput = {};

    if (query.subscription !== undefined) {
      where.subscription = query.subscription;
    }
    if (query.currentStep !== undefined) {
      where.currentStep = query.currentStep;
    }
    if (query.hasVisa !== undefined) {
      where.hasVisa = query.hasVisa;
    }

    return this.prisma.studentPortrait.findMany({
      where,
      skip: query.skip,
      take: query.take,
      orderBy: { updatedAt: "desc" },
      include: this.listInclude,
    });
  }

  async findById(id: number) {
    return this.prisma.studentPortrait.findUnique({
      where: { id },
      include: this.detailInclude,
    });
  }

  async updateKycLock(id: number, isIdentityLocked: boolean) {
    return this.prisma.studentPortrait.update({
      where: { id },
      data: { isIdentityLocked },
      include: this.detailInclude,
    });
  }

  async updateSubscription(id: number, data: Prisma.StudentPortraitUpdateInput) {
    return this.prisma.studentPortrait.update({
      where: { id },
      data,
      include: this.detailInclude,
    });
  }

  async createAuditLog(userId: number, entityId: number, info: Prisma.InputJsonValue) {
    return this.prisma.auditLog.create({
      data: {
        action: "SUBSCRIPTION_UPDATE",
        entityType: "StudentPortrait",
        entityId,
        userId,
        details: info,
      },
    });
  }

  // 360° full profile view
  async findFullProfile(id: number) {
    return this.prisma.studentPortrait.findUnique({
      where: { id },
      include: {
        user: { omit: { password: true } },
        languages: { include: { language: true } },
        tests: true,
        targetCountries: { include: { country: true } },
        targetPrograms: {
          include: {
            organisation: { select: { id: true, nameEn: true, nameRu: true, nameKk: true, slug: true, country: true } },
            documents: true,
          },
          orderBy: { deadline: { sort: "asc", nulls: "last" } },
        },
        documents: { orderBy: { updatedAt: "desc" } },
        reviews: true,
        assignedExpert: { include: { user: { select: { id: true, firstname: true, lastname: true } } } },
      },
    });
  }

  // Update target program status (expert only)
  async updateTargetProgramStatus(tpId: number, applicationStatus: ApplicationStatus) {
    return this.prisma.targetProgram.update({
      where: { id: tpId },
      data: { applicationStatus, statusChangedAt: new Date() },
      include: {
        organisation: { select: { id: true, nameEn: true, nameRu: true, slug: true } },
      },
    });
  }

  async findTargetProgramById(tpId: number) {
    return this.prisma.targetProgram.findUnique({ where: { id: tpId } });
  }

  async getAssignedExpertUserId(portraitId: number): Promise<number | null> {
    const row = await this.prisma.studentPortrait.findUnique({
      where: { id: portraitId },
      select: { assignedExpert: { select: { userId: true } } },
    });
    return row?.assignedExpert?.userId ?? null;
  }

  async updateCurrentStep(portraitId: number, currentStep: ProcessStep) {
    return this.prisma.studentPortrait.update({
      where: { id: portraitId },
      data: { currentStep },
      select: {
        id: true,
        currentStep: true,
      },
    });
  }

  async findAuditLogs(entityType: string, entityId: number) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, firstname: true, lastname: true } } },
    });
  }
}
