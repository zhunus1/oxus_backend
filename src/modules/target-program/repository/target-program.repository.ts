import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { Prisma } from "generated/prisma/client";
import { PUBLIC_DOCUMENT_SELECT } from "src/common/serialization/public-document";

@Injectable()
export class TargetProgramRepository extends BaseRepository {
  private readonly detailInclude = {
    organisation: { select: { id: true, nameEn: true, nameRu: true, nameKk: true, slug: true, country: true } },
    program: true,
  } satisfies Prisma.TargetProgramInclude;

  private includeForPortrait(studentPortraitId: number) {
    return { ...this.detailInclude, documents: { where: { studentPortraitId, deletedAt: null }, select: PUBLIC_DOCUMENT_SELECT } } satisfies Prisma.TargetProgramInclude;
  }

  async findProgramById(id: number) {
    return this.prisma.program.findUnique({
      where: { id },
      include: {
        organisation: true,
      },
    });
  }

  async create(data: { programId: number; programTitle: string; organisationId: number; deadline?: string; intake: string; studentPortraitId: number }) {
    return this.prisma.targetProgram.create({
      data: {
        programId: data.programId,
        programTitle: data.programTitle,
        organisationId: data.organisationId,
        deadline: data.deadline ? new Date(data.deadline) : undefined,
        intake: data.intake,
        studentPortraitId: data.studentPortraitId,
      },
      include: this.includeForPortrait(data.studentPortraitId),
    });
  }

  async findByPortraitId(studentPortraitId: number) {
    return this.prisma.targetProgram.findMany({
      where: { studentPortraitId },
      orderBy: { deadline: { sort: "asc", nulls: "last" } },
      include: this.includeForPortrait(studentPortraitId),
    });
  }

  async findById(id: number) {
    return this.prisma.targetProgram.findUnique({
      where: { id },
      include: this.detailInclude,
    });
  }

  async findByIdForPortrait(id: number, studentPortraitId: number) {
    return this.prisma.targetProgram.findFirst({
      where: { id, studentPortraitId },
      include: this.includeForPortrait(studentPortraitId),
    });
  }

  async update(id: number, data: Prisma.TargetProgramUpdateInput, studentPortraitId: number) {
    return this.prisma.targetProgram.update({
      where: { id },
      data,
      include: this.includeForPortrait(studentPortraitId),
    });
  }

  async delete(id: number) {
    return this.prisma.targetProgram.delete({ where: { id } });
  }
}
