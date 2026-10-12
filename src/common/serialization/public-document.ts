import type { Prisma } from "generated/prisma/client";

export const PUBLIC_DOCUMENT_SELECT = {
  id: true,
  title: true,
  fileUrl: true,
  documentType: true,
  version: true,
  status: true,
  feedback: true,
  studentPortraitId: true,
  targetProgramId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentSelect;

export type PublicDocument = Prisma.DocumentGetPayload<{ select: typeof PUBLIC_DOCUMENT_SELECT }>;

export function toPublicDocument(document: PublicDocument): PublicDocument;
export function toPublicDocument(document: Partial<PublicDocument>): Partial<PublicDocument>;
export function toPublicDocument(document: Partial<PublicDocument>): Partial<PublicDocument> {
  return {
    id: document.id,
    title: document.title,
    fileUrl: document.fileUrl,
    documentType: document.documentType,
    version: document.version,
    status: document.status,
    feedback: document.feedback,
    studentPortraitId: document.studentPortraitId,
    targetProgramId: document.targetProgramId,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
