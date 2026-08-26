import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { Prisma } from "generated/prisma/client";

@Injectable()
export class ExpertCatalogRepository extends BaseRepository {
  private readonly catalogInclude = {
    user: { select: { id: true, firstname: true, lastname: true } },
    expertCountries: { select: { id: true, isoCode: true, nameEn: true, nameRu: true, nameKk: true } },
    reviews: { select: { id: true, rating: true, comment: true, createdAt: true } },
  } satisfies Prisma.ConsultantProfileInclude;

  async findMany(query: { countryId?: number; minRating?: number; skip?: number; take?: number }) {
    const where: Prisma.ConsultantProfileWhereInput = { isActive: true };

    if (query.minRating !== undefined) {
      where.rating = { gte: query.minRating };
    }

    if (query.countryId !== undefined) {
      where.expertCountries = { some: { id: query.countryId } };
    }

    return this.prisma.consultantProfile.findMany({
      where,
      skip: query.skip,
      take: query.take,
      orderBy: { rating: "desc" },
      include: this.catalogInclude,
    });
  }

  async findById(id: number) {
    return this.prisma.consultantProfile.findUnique({
      where: { id },
      include: this.catalogInclude,
    });
  }

  async assignExpert(portraitId: number, consultantProfileId: number) {
    return this.prisma.studentPortrait.update({
      where: { id: portraitId },
      data: { consultantProfileId },
    });
  }

  async findPortraitByUserId(userId: number) {
    return this.prisma.studentPortrait.findUnique({ where: { userId } });
  }

  async findExpertsForTransferPicker(excludeUserId: number) {
    return this.prisma.consultantProfile.findMany({
      where: {
        isActive: true,
        userId: { not: excludeUserId },
        user: { deletedAt: null, role: { code: "EXPERT" } },
      },
      orderBy: [{ user: { lastname: "asc" } }, { user: { firstname: "asc" } }],
      take: 200,
      select: {
        id: true,
        bio: true,
        rating: true,
        userId: true,
        user: { select: { id: true, firstname: true, lastname: true, email: true } },
        expertCountries: { select: { nameEn: true, isoCode: true }, take: 5 },
      },
    });
  }
}
