import { Injectable } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { QsImportJobStatus } from "generated/prisma/enums";
import { PrismaService } from "src/database/prisma.service";

@Injectable()
export class QsImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createJob(data: Prisma.QsOrganisationImportJobCreateInput) {
    return this.prisma.qsOrganisationImportJob.create({ data });
  }

  async updateJob(id: number, data: Prisma.QsOrganisationImportJobUpdateInput) {
    return this.prisma.qsOrganisationImportJob.update({
      where: { id },
      data,
    });
  }

  async findJobById(id: number) {
    return this.prisma.qsOrganisationImportJob.findUnique({
      where: { id },
      include: {
        initiatedByUser: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
    });
  }

  async findJobs(args: { skip?: number; take?: number; status?: QsImportJobStatus }) {
    return this.prisma.qsOrganisationImportJob.findMany({
      where: args.status ? { status: args.status } : undefined,
      orderBy: { createdAt: "desc" },
      skip: args.skip,
      take: args.take,
      include: {
        initiatedByUser: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
    });
  }

  async findCountries() {
    return this.prisma.country.findMany({
      select: {
        id: true,
        isoCode: true,
        nameEn: true,
      },
    });
  }

  async findOrganisationByNameAndCountry(nameEn: string, countryId: number) {
    return this.prisma.organisation.findFirst({
      where: {
        nameEn,
        countryId,
        deletedAt: null,
      },
    });
  }

  async findOrganisationBySlug(slug: string) {
    return this.prisma.organisation.findFirst({
      where: {
        slug,
      },
    });
  }

  async createOrganisation(data: Prisma.OrganisationCreateInput) {
    return this.prisma.organisation.create({ data });
  }

  async updateOrganisation(id: number, data: Prisma.OrganisationUpdateInput) {
    return this.prisma.organisation.update({
      where: { id },
      data,
    });
  }
}
