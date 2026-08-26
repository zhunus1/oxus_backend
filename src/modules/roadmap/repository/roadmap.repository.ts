import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { Prisma } from "generated/prisma/client";

@Injectable()
export class RoadmapRepository extends BaseRepository {
  private appendAnd(where: Prisma.ProgramWhereInput, clause: Prisma.ProgramWhereInput) {
    const currentAnd = where.AND;
    if (!currentAnd) {
      where.AND = [clause];
      return;
    }

    where.AND = Array.isArray(currentAnd) ? [...currentAnd, clause] : [currentAnd, clause];
  }

  async findPortraitWithProfile(userId: number) {
    return this.prisma.studentPortrait.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, firstname: true, lastname: true } },
        languages: { include: { language: true } },
        tests: true,
        targetCountries: { include: { country: true } },
      },
    });
  }

  async findMatchingPrograms(filters: { countryIsoCodes?: string[]; gpa?: number; gpaScale?: number; maxTuitionFee?: number; ielts?: number; educationLevel?: string }) {
    const where: Prisma.ProgramWhereInput = {};

    if (filters.countryIsoCodes?.length) {
      where.organisation = {
        is: { country: { is: { isoCode: { in: filters.countryIsoCodes } } } },
      };
    }

    if (filters.gpa !== undefined && filters.gpaScale && filters.gpaScale > 0) {
      const gpaOn4 = (filters.gpa / filters.gpaScale) * 4.0;
      this.appendAnd(where, { OR: [{ minGPA: null }, { minGPA: { lte: gpaOn4 } }] });
    }

    if (filters.maxTuitionFee !== undefined) {
      this.appendAnd(where, { OR: [{ tuitionFee: null }, { tuitionFee: { lte: filters.maxTuitionFee } }] });
    }

    if (filters.ielts !== undefined) {
      this.appendAnd(where, { OR: [{ minIELTS: null }, { minIELTS: { lte: filters.ielts } }] });
    }

    return this.prisma.program.findMany({
      where,
      include: {
        organisation: { include: { country: true } },
      },
      orderBy: [{ baseAcceptanceRate: { sort: "desc", nulls: "last" } }, { applicationDeadline: { sort: "asc", nulls: "last" } }],
      take: 20,
    });
  }

  async saveRoadmap(portraitId: number, roadmap: Prisma.InputJsonValue, generationCount: number) {
    return this.prisma.studentPortrait.update({
      where: { id: portraitId },
      data: {
        aiRoadmap: roadmap,
        roadmapGeneratedAt: new Date(),
        generationCount,
      },
    });
  }

  async freezeIdentity(portraitId: number) {
    return this.prisma.studentPortrait.update({
      where: { id: portraitId },
      data: { isIdentityLocked: true },
    });
  }
}
