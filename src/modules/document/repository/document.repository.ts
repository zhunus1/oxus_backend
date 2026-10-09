import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { DocumentStatus, RequirementType } from "generated/prisma/client";
import { PUBLIC_DOCUMENT_SELECT, type PublicDocument } from "src/common/serialization/public-document";

@Injectable()
export class DocumentRepository extends BaseRepository {
  async create(data: { title: string; fileUrl: string; documentType: RequirementType; studentPortraitId: number; targetProgramId?: number }) {
    return this.prisma.document.create({ data, select: PUBLIC_DOCUMENT_SELECT });
  }

  async findByPortraitId(studentPortraitId: number) {
    return this.prisma.document.findMany({
      where: { studentPortraitId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: PUBLIC_DOCUMENT_SELECT,
    });
  }

  async findById(id: number) {
    return this.prisma.document.findUnique({ where: { id, deletedAt: null }, select: PUBLIC_DOCUMENT_SELECT });
  }

  async updateVersion(doc: PublicDocument, fileUrl: string) {
    return this.prisma.document.update({
      where: { id: doc.id, deletedAt: null, version: doc.version, updatedAt: doc.updatedAt, status: doc.status, fileUrl: doc.fileUrl },
      data: { fileUrl, version: { increment: 1 }, status: DocumentStatus.DRAFT, feedback: null },
      select: PUBLIC_DOCUMENT_SELECT,
    });
  }

  async updateStatus(doc: PublicDocument, status: DocumentStatus, feedback?: string) {
    return this.prisma.document.update({
      where: { id: doc.id, deletedAt: null, version: doc.version, updatedAt: doc.updatedAt, status: doc.status, fileUrl: doc.fileUrl },
      data: { status, feedback: feedback ?? undefined },
      select: PUBLIC_DOCUMENT_SELECT,
    });
  }
}
