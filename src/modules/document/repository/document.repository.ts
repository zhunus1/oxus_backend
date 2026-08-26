import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { DocumentStatus, RequirementType } from "generated/prisma/client";

@Injectable()
export class DocumentRepository extends BaseRepository {
  async create(data: { title: string; fileUrl: string; documentType: RequirementType; studentPortraitId: number; targetProgramId?: number }) {
    return this.prisma.document.create({ data });
  }

  async findByPortraitId(studentPortraitId: number) {
    return this.prisma.document.findMany({
      where: { studentPortraitId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findById(id: number) {
    return this.prisma.document.findUnique({ where: { id } });
  }

  async updateVersion(id: number, fileUrl: string, version: number) {
    return this.prisma.document.update({
      where: { id },
      data: { fileUrl, version, status: DocumentStatus.DRAFT, feedback: null },
    });
  }

  async updateStatus(id: number, status: DocumentStatus, feedback?: string) {
    return this.prisma.document.update({
      where: { id },
      data: { status, feedback: feedback ?? undefined },
    });
  }
}
