import { Injectable } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";

const includeRequestRelations = {
  requestedByUser: {
    select: {
      id: true,
      firstname: true,
      lastname: true,
      email: true,
    },
  },
  reviewedByUser: {
    select: {
      id: true,
      firstname: true,
      lastname: true,
      email: true,
    },
  },
  resolvedOrganisation: {
    select: {
      id: true,
      slug: true,
      nameEn: true,
      websiteUrl: true,
      qsRank: true,
    },
  },
} satisfies Prisma.OrganisationRequestInclude;

@Injectable()
export class OrganisationRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.OrganisationRequestCreateInput) {
    return this.prisma.organisationRequest.create({
      data,
      include: includeRequestRelations,
    });
  }

  async findById(id: number) {
    return this.prisma.organisationRequest.findUnique({
      where: { id },
      include: includeRequestRelations,
    });
  }

  async findMany(args: { skip?: number; take?: number; status?: string; requestedByUserId?: number }) {
    return this.prisma.organisationRequest.findMany({
      where: {
        ...(args.status ? { status: args.status as any } : {}),
        ...(args.requestedByUserId ? { requestedByUserId: args.requestedByUserId } : {}),
      },
      orderBy: { createdAt: "desc" },
      skip: args.skip,
      take: args.take,
      include: includeRequestRelations,
    });
  }

  async updateById(id: number, data: Prisma.OrganisationRequestUpdateInput) {
    return this.prisma.organisationRequest.update({
      where: { id },
      data,
      include: includeRequestRelations,
    });
  }
}
