import { Injectable } from "@nestjs/common";
import { ImportJobStatus } from "generated/prisma/enums";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";

const jobInclude = {
  organisation: true,
  snapshots: {
    orderBy: {
      createdAt: "desc",
    },
  },
} satisfies Prisma.OrganisationImportJobInclude;

@Injectable()
export class OrganisationImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOrganisationForSync(id: number) {
    return this.prisma.organisation.findFirst({
      where: { id, deletedAt: null },
      include: {
        country: true,
        programs: {
          orderBy: { id: "asc" },
        },
      },
    });
  }

  async createJob(data: Prisma.OrganisationImportJobCreateInput) {
    return this.prisma.organisationImportJob.create({ data });
  }

  async updateJob(id: number, data: Prisma.OrganisationImportJobUpdateInput) {
    return this.prisma.organisationImportJob.update({
      where: { id },
      data,
    });
  }

  async findJobById(id: number) {
    return this.prisma.organisationImportJob.findUnique({
      where: { id },
      include: jobInclude,
    });
  }

  async findJobsByOrganisation(organisationId: number, args: { skip?: number; take?: number; status?: ImportJobStatus }) {
    return this.prisma.organisationImportJob.findMany({
      where: {
        organisationId,
        ...(args.status ? { status: args.status } : {}),
      },
      include: {
        snapshots: true,
      },
      orderBy: { createdAt: "desc" },
      skip: args.skip,
      take: args.take,
    });
  }

  async createSnapshot(importJobId: number, data: { sourceUrl: string; pageTitle?: string | null; rawText?: string | null; extractedData?: Prisma.InputJsonValue }) {
    return this.prisma.organisationImportSnapshot.create({
      data: {
        importJobId,
        sourceUrl: data.sourceUrl,
        pageTitle: data.pageTitle,
        rawText: data.rawText,
        extractedData: data.extractedData,
      },
    });
  }

  async syncPrograms(
    organisationId: number,
    programs: Array<{ name: string; degreeLevel: string; tuitionFee: number | null; minGPA: number | null; minIELTS: number | null; baseAcceptanceRate: number | null }>,
  ) {
    const existingPrograms = await this.prisma.program.findMany({
      where: { organisationId },
      select: {
        id: true,
        name: true,
        degreeLevel: true,
      },
    });

    const existingKeys = new Set(existingPrograms.map(program => `${program.name}::${program.degreeLevel}`));
    let createdProgramCount = 0;
    let updatedProgramCount = 0;

    for (const program of programs) {
      const existed = existingKeys.has(`${program.name}::${program.degreeLevel}`);

      await this.prisma.program.upsert({
        where: {
          organisationId_name_degreeLevel: {
            organisationId,
            name: program.name,
            degreeLevel: program.degreeLevel as any,
          },
        },
        update: {
          tuitionFee: program.tuitionFee,
          minGPA: program.minGPA,
          minIELTS: program.minIELTS,
          baseAcceptanceRate: program.baseAcceptanceRate,
        },
        create: {
          organisation: { connect: { id: organisationId } },
          name: program.name,
          degreeLevel: program.degreeLevel as any,
          tuitionFee: program.tuitionFee,
          minGPA: program.minGPA,
          minIELTS: program.minIELTS,
          applicationDeadline: null,
          baseAcceptanceRate: program.baseAcceptanceRate,
        },
      });

      if (existed) updatedProgramCount += 1;
      else createdProgramCount += 1;
    }

    return {
      importedProgramCount: programs.length,
      createdProgramCount,
      updatedProgramCount,
    };
  }

  async updateOrganisationWebsite(organisationId: number, websiteUrl: string) {
    return this.prisma.organisation.update({
      where: { id: organisationId },
      data: {
        websiteUrl,
      },
    });
  }
}
