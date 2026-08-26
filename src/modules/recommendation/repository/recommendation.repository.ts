import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { RecommendationProgramDto } from "../api/dto/recommendation-program.dto";
import { Prisma } from "generated/prisma/client";

@Injectable()
export class RecommendationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private appendAnd(where: Prisma.ProgramWhereInput, clause: Prisma.ProgramWhereInput) {
    const currentAnd = where.AND;
    if (!currentAnd) {
      where.AND = [clause];
      return;
    }

    where.AND = Array.isArray(currentAnd) ? [...currentAnd, clause] : [currentAnd, clause];
  }

  async findPrograms(dto: RecommendationProgramDto) {
    const { degreeLevel, gpa, gpaScale, major, ielts, maxTuitionFee, countryIsoCodes, organisationIds, programIds } = dto;

    const where: Prisma.ProgramWhereInput = {};

    // Filter: only specific programs (if UI already has program choices)
    if (programIds?.length) {
      where.id = { in: programIds };
    }

    // Filter: only programs from selected universities
    if (organisationIds?.length) {
      where.organisationId = { in: organisationIds };
    }

    if (degreeLevel) {
      where.degreeLevel = degreeLevel;
    }

    // Filter: tuition upper bound
    if (maxTuitionFee !== undefined) {
      where.OR = [...(where.OR ?? []), { tuitionFee: null }, { tuitionFee: { lte: maxTuitionFee } }];
    }

    // Filter: country constraint via organisation.country.isoCode (relation filter with `is`)
    if (countryIsoCodes?.length) {
      where.organisation = {
        is: {
          country: {
            is: {
              isoCode: { in: countryIsoCodes },
            },
          },
        },
      };
    }

    // Filter: major keyword against program name (heuristic)
    if (major) {
      where.name = { contains: major, mode: "insensitive" };
    }

    // Filter: GPA requirement
    // Your Program.minGPA is on 4.0 scale (assumption), so convert student GPA to 4.0
    if (gpa !== undefined) {
      if (gpaScale === undefined || gpaScale <= 0) {
        throw new BadRequestException("gpaScale must be > 0 when gpa is provided");
      }
      const gpaOn4 = (gpa / gpaScale) * 4.0;
      this.appendAnd(where, { OR: [{ minGPA: null }, { minGPA: { lte: gpaOn4 } }] });
    }

    // Filter: IELTS requirement
    // Accept programs with no minIELTS OR minIELTS <= student's ielts
    if (ielts !== undefined) {
      this.appendAnd(where, { OR: [{ minIELTS: null }, { minIELTS: { lte: ielts } }] });
    }

    return this.prisma.program.findMany({
      where,
      include: {
        organisation: {
          include: { country: true },
        },
      },
      orderBy: [{ baseAcceptanceRate: { sort: "desc", nulls: "last" } }, { applicationDeadline: { sort: "asc", nulls: "last" } }],
    });
  }
}
