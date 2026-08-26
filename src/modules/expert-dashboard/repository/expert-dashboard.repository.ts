import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { ApplicationStatus, Prisma, ProcessStep } from "generated/prisma/client";
import type { ExpertStudentsQueryDto } from "../api/dto/expert-students-query.dto";

@Injectable()
export class ExpertDashboardRepository extends BaseRepository {
  private readonly expertStudentListInclude = {
    user: {
      select: {
        id: true,
        firstname: true,
        lastname: true,
        email: true,
        phoneNumber: true,
        createdAt: true,
      },
    },
    targetCountries: {
      take: 5,
      select: {
        country: {
          select: {
            isoCode: true,
            nameEn: true,
            nameRu: true,
          },
        },
      },
    },
  } satisfies Prisma.StudentPortraitInclude;

  private readonly studentInclude = {
    user: { select: { id: true, firstname: true, lastname: true, timezone: true } },
    targetPrograms: {
      include: { organisation: { select: { id: true, nameEn: true, nameRu: true, slug: true, country: true } } },
      orderBy: { deadline: { sort: "asc", nulls: "last" } as const },
    },
    documents: { select: { id: true, title: true, status: true, documentType: true, version: true, updatedAt: true } },
  } satisfies Prisma.StudentPortraitInclude;

  private buildStudentUserFilters(query: ExpertStudentsQueryDto): Prisma.UserWhereInput {
    const userWhere: Prisma.UserWhereInput = {
      deletedAt: null,
      role: { code: "STUDENT" },
    };
    const q = query.search?.trim();
    if (q) {
      userWhere.OR = [{ firstname: { contains: q, mode: "insensitive" } }, { lastname: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }];
    }
    if (query.registeredFrom ?? query.registeredTo) {
      userWhere.createdAt = {};
      if (query.registeredFrom) {
        userWhere.createdAt.gte = new Date(`${query.registeredFrom}T00:00:00.000Z`);
      }
      if (query.registeredTo) {
        userWhere.createdAt.lte = new Date(`${query.registeredTo}T23:59:59.999Z`);
      }
    }
    return userWhere;
  }

  portraitWhereAssigned(consultantProfileId: number, query: ExpertStudentsQueryDto): Prisma.StudentPortraitWhereInput {
    return {
      consultantProfileId,
      user: this.buildStudentUserFilters(query),
    };
  }

  portraitWhereAvailable(query: ExpertStudentsQueryDto): Prisma.StudentPortraitWhereInput {
    return {
      consultantProfileId: null,
      user: this.buildStudentUserFilters(query),
    };
  }

  async countExpertStudentPortraits(where: Prisma.StudentPortraitWhereInput) {
    return this.prisma.studentPortrait.count({ where });
  }

  async findExpertStudentPortraits(where: Prisma.StudentPortraitWhereInput, skip: number, take: number) {
    return this.prisma.studentPortrait.findMany({
      where,
      skip,
      take,
      orderBy: { user: { createdAt: "desc" } },
      include: this.expertStudentListInclude,
    });
  }

  async assignPortraitToExpert(portraitId: number, consultantProfileId: number) {
    const result = await this.prisma.studentPortrait.updateMany({
      where: { id: portraitId, consultantProfileId: null },
      data: { consultantProfileId },
    });
    return result.count;
  }

  async transferPortraitConsultant(portraitId: number, currentConsultantProfileId: number, nextConsultantProfileId: number): Promise<number> {
    const result = await this.prisma.studentPortrait.updateMany({
      where: { id: portraitId, consultantProfileId: currentConsultantProfileId },
      data: { consultantProfileId: nextConsultantProfileId },
    });
    return result.count;
  }

  async findConsultantProfileForExpertUser(expertUserId: number) {
    return this.prisma.consultantProfile.findFirst({
      where: {
        userId: expertUserId,
        isActive: true,
        user: { deletedAt: null, role: { code: "EXPERT" } },
      },
      include: {
        user: { select: { id: true, firstname: true, lastname: true, email: true } },
      },
    });
  }

  async findPortraitOwnership(portraitId: number) {
    return this.prisma.studentPortrait.findUnique({
      where: { id: portraitId },
      select: { id: true, consultantProfileId: true, userId: true },
    });
  }

  async findExpertListPortrait(portraitId: number) {
    return this.prisma.studentPortrait.findUnique({
      where: { id: portraitId },
      include: this.expertStudentListInclude,
    });
  }

  async findAssignedStudents(consultantProfileId: number, query: { currentStep?: ProcessStep; skip?: number; take?: number }) {
    const where: Prisma.StudentPortraitWhereInput = { consultantProfileId };

    if (query.currentStep) {
      where.currentStep = query.currentStep;
    }

    return this.prisma.studentPortrait.findMany({
      where,
      skip: query.skip,
      take: query.take,
      include: this.studentInclude,
    });
  }

  async findStaleStudents(consultantProfileId: number, thresholdDate: Date) {
    return this.prisma.studentPortrait.findMany({
      where: {
        consultantProfileId,
        targetPrograms: {
          some: {
            applicationStatus: { not: ApplicationStatus.NOT_STARTED },
            OR: [{ statusChangedAt: { lt: thresholdDate } }, { statusChangedAt: null }],
          },
        },
      },
      include: this.studentInclude,
    });
  }

  async findConsultantProfileByUserId(userId: number) {
    return this.prisma.consultantProfile.findUnique({
      where: { userId },
      include: { user: { select: { id: true, timezone: true } } },
    });
  }

  async findAssignedStudentById(consultantProfileId: number, studentId: number) {
    return this.prisma.studentPortrait.findFirst({
      where: {
        id: studentId,
        consultantProfileId,
      },
      select: {
        id: true,
        userId: true,
      },
    });
  }

  async findAssignedStudentPortraitByUserId(consultantProfileId: number, studentUserId: number) {
    return this.prisma.studentPortrait.findFirst({
      where: {
        userId: studentUserId,
        consultantProfileId,
        user: { deletedAt: null, role: { code: "STUDENT" } },
      },
      select: { id: true, userId: true },
    });
  }

  async findAttemptsWithAnswersByTestAndUser(testId: number, userId: number) {
    return this.prisma.attempt.findMany({
      where: {
        testId,
        userId,
      },
      orderBy: { createdAt: "desc" },
      include: {
        responses: {
          orderBy: { questionId: "asc" },
          include: {
            question: {
              include: {
                options: {
                  orderBy: { order: "asc" },
                  select: { id: true, order: true, text: true },
                },
              },
            },
            option: {
              select: { id: true, order: true, text: true },
            },
          },
        },
      },
    });
  }
}
