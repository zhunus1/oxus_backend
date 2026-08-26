import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { Prisma, Organisation } from "generated/prisma/client";

@Injectable()
export class OrganisationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.OrganisationCreateInput): Promise<Organisation> {
    return this.prisma.organisation.create({ data });
  }

  async findAll(args: { where?: Prisma.OrganisationWhereInput; skip?: number; take?: number }): Promise<Organisation[]> {
    const { where, skip, take } = args;
    return this.prisma.organisation.findMany({
      where: { ...where, deletedAt: null },
      include: {
        country: true,
        programs: { select: { name: true, degreeLevel: true, tuitionFee: true } },
      },
      skip,
      take,
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: number): Promise<Organisation | null> {
    return this.prisma.organisation.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        country: true,
        programs: { select: { id: true, name: true, degreeLevel: true, tuitionFee: true, minGPA: true, minIELTS: true, baseAcceptanceRate: true, applicationDeadline: true } },
      },
    });
  }

  async findBySlug(slug: string): Promise<Organisation | null> {
    return this.prisma.organisation.findFirst({
      where: {
        slug,
        deletedAt: null,
      },
      include: {
        country: true,
        programs: {
          select: {
            id: true,
            name: true,
            degreeLevel: true,
            tuitionFee: true,
            minGPA: true,
            minIELTS: true,
            baseAcceptanceRate: true,
            applicationDeadline: true,
          },
        },
      },
    });
  }

  async updateById(id: number, data: Prisma.OrganisationUpdateInput): Promise<Organisation> {
    return this.prisma.organisation.update({ where: { id }, data });
  }

  async deleteById(id: number): Promise<Organisation> {
    return this.prisma.organisation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restoreById(id: number): Promise<Organisation> {
    return this.prisma.organisation.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async deleteMany(ids: number[]) {
    return this.prisma.organisation.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async findDeletedById(id: number): Promise<Organisation | null> {
    return this.prisma.organisation.findFirst({
      where: { id, deletedAt: { not: null } },
    });
  }

  async getStats(top: number): Promise<{
    totalCount: number;
    totalPrograms: number;
    byCountry: { countryNameEn: string; isoCode: string; count: number }[];
    completeness: { total: number; withTuitionFee: number; withMinGPA: number; withMinIELTS: number; withAcceptanceRate: number };
  }> {
    const [totalCount, totalPrograms, byCountryRows, withTuitionFee, withMinGPA, withMinIELTS, withAcceptanceRate] = await Promise.all([
      this.prisma.organisation.count({ where: { deletedAt: null } }),
      this.prisma.program.count({ where: { organisation: { deletedAt: null } } }),
      this.prisma.$queryRaw<{ nameEn: string | null; isoCode: string; count: bigint }[]>`
        SELECT c."nameEn", c."isoCode", COUNT(o.id) AS count
        FROM "Organisation" o
        JOIN "Country" c ON c.id = o."countryId"
        WHERE o."deletedAt" IS NULL
        GROUP BY c.id, c."nameEn", c."isoCode"
        ORDER BY count DESC
        LIMIT ${top}
      `,
      this.prisma.program.count({ where: { organisation: { deletedAt: null }, tuitionFee: { not: null } } }),
      this.prisma.program.count({ where: { organisation: { deletedAt: null }, minGPA: { not: null } } }),
      this.prisma.program.count({ where: { organisation: { deletedAt: null }, minIELTS: { not: null } } }),
      this.prisma.program.count({ where: { organisation: { deletedAt: null }, baseAcceptanceRate: { not: null } } }),
    ]);
    return {
      totalCount,
      totalPrograms,
      byCountry: byCountryRows.map(r => ({
        countryNameEn: r.nameEn ?? r.isoCode,
        isoCode: r.isoCode,
        count: Number(r.count),
      })),
      completeness: { total: totalPrograms, withTuitionFee, withMinGPA, withMinIELTS, withAcceptanceRate },
    };
  }
}
