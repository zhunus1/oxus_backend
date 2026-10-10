import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { DocumentStatus, Prisma, RequirementType } from "generated/prisma/client";
import { PUBLIC_DOCUMENT_SELECT, type PublicDocument } from "src/common/serialization/public-document";

export const INTERNAL_DOCUMENT_SELECT = { ...PUBLIC_DOCUMENT_SELECT, fileKey: true, deletedAt: true } satisfies Prisma.DocumentSelect;
export type InternalDocument = Prisma.DocumentGetPayload<{ select: typeof INTERNAL_DOCUMENT_SELECT }>;

@Injectable()
export class DocumentRepository extends BaseRepository {
  async findInternalById(id: number) {
    return this.prisma.document.findUnique({ where: { id, deletedAt: null }, select: INTERNAL_DOCUMENT_SELECT });
  }

  async createPrivate(data: { title: string; fileKey: string; documentType: RequirementType; studentPortraitId: number; targetProgramId?: number }, tx: Prisma.TransactionClient) {
    const created = await tx.document.create({ data: { ...data, fileUrl: "", status: DocumentStatus.DRAFT, version: 1, deletedAt: null }, select: { id: true } });
    return tx.document.update({ where: { id: created.id }, data: { fileUrl: `/api/v1/documents/${created.id}/file` }, select: PUBLIC_DOCUMENT_SELECT });
  }

  async updatePrivateVersion(doc: InternalDocument, fileKey: string, tx: Prisma.TransactionClient) {
    return tx.document.update({
      where: {
        id: doc.id,
        version: doc.version,
        status: doc.status,
        updatedAt: doc.updatedAt,
        fileUrl: doc.fileUrl,
        fileKey: doc.fileKey,
        deletedAt: doc.deletedAt,
        studentPortraitId: doc.studentPortraitId,
        targetProgramId: doc.targetProgramId,
      },
      data: { fileKey, fileUrl: `/api/v1/documents/${doc.id}/file`, version: { increment: 1 }, status: DocumentStatus.DRAFT, feedback: null },
      select: PUBLIC_DOCUMENT_SELECT,
    });
  }

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
