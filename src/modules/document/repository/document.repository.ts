import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { Document, DocumentStatus, RequirementType } from "generated/prisma/client";

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

  async updateVersion(doc: Document, fileUrl: string) {
    return this.prisma.document.update({
      where: { id: doc.id, version: doc.version, updatedAt: doc.updatedAt, status: doc.status, fileUrl: doc.fileUrl },
      data: { fileUrl, version: { increment: 1 }, status: DocumentStatus.DRAFT, feedback: null },
    });
  }

  async updateStatus(doc: Document, status: DocumentStatus, feedback?: string) {
    return this.prisma.document.update({
      where: { id: doc.id, version: doc.version, updatedAt: doc.updatedAt, status: doc.status, fileUrl: doc.fileUrl },
      data: { status, feedback: feedback ?? undefined },
    });
  }
}
