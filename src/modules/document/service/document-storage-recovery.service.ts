import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { StudentDocumentStorageService } from "src/common/utils/minio/student-document-storage.service";
import { AuditLogService } from "src/modules/audit-log/service/audit-log.service";

export interface DocumentStorageIntent {
  id: number;
  details: { operationId: string; fileKey: string; studentPortraitId: number; ownerUserId: number; documentId: number | null; state: string };
}

export const DOCUMENT_STORAGE_INTENT_ENTITY = "DocumentStorageIntent";

@Injectable()
export class DocumentStorageRecoveryService {
  private readonly logger = new Logger(DocumentStorageRecoveryService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly storage: StudentDocumentStorageService,
  ) {}

  async begin(actorId: number, details: DocumentStorageIntent["details"]): Promise<DocumentStorageIntent> {
    const entry = await this.audit.log(actorId, "DOCUMENT_STORAGE_PENDING", DOCUMENT_STORAGE_INTENT_ENTITY, details.studentPortraitId, details);
    return { id: entry.id, details };
  }

  private intentWhere(intent: DocumentStorageIntent, states: string[]): Prisma.AuditLogWhereUniqueInput {
    return {
      id: intent.id,
      action: "DOCUMENT_STORAGE_PENDING",
      entityId: intent.details.studentPortraitId,
      // Keep legacy journal rows recoverable without moving/deleting existing audit history.
      OR: [{ entityType: DOCUMENT_STORAGE_INTENT_ENTITY }, { entityType: "StudentPortrait" }],
      AND: [
        { details: { path: ["fileKey"], equals: intent.details.fileKey } },
        { details: { path: ["operationId"], equals: intent.details.operationId } },
        { OR: states.map(state => ({ details: { path: ["state"], equals: state } })) },
      ],
    };
  }

  async committed(intent: DocumentStorageIntent, documentId: number, tx: Prisma.TransactionClient) {
    await tx.auditLog.update({
      where: this.intentWhere(intent, ["PENDING"]),
      data: { details: { ...intent.details, documentId, state: "COMMITTED" } },
    });
  }

  async compensate(intent: DocumentStorageIntent, rollbackProven: boolean) {
    if (!rollbackProven) {
      // Missing references alone cannot prove that an in-flight COMMIT will not succeed.
      this.logger.warn("Document storage recovery deferred: transaction or upload outcome unknown");
      return;
    }
    try {
      const recorded = await this.prisma.auditLog.findUnique({ where: this.intentWhere(intent, ["PENDING", "ROLLED_BACK"]), select: { details: true } });
      const details = recorded?.details as DocumentStorageIntent["details"] | undefined;
      if (!details || details.fileKey !== intent.details.fileKey || details.operationId !== intent.details.operationId || !["PENDING", "ROLLED_BACK"].includes(details.state))
        return;
      // Include archived documents: their bytes must also remain recoverable.
      if (await this.prisma.document.count({ where: { fileKey: intent.details.fileKey } })) {
        this.logger.warn("Document storage recovery retained a referenced object");
        return;
      }
      await this.prisma.auditLog.update({
        where: this.intentWhere(intent, ["PENDING", "ROLLED_BACK"]),
        data: { details: { ...intent.details, state: "ROLLED_BACK" } },
      });
      await this.storage.deletePrivateDocument(intent.details.fileKey, AbortSignal.timeout(30_000));
      await this.prisma.auditLog.update({ where: this.intentWhere(intent, ["ROLLED_BACK"]), data: { details: { ...intent.details, state: "CLEANED" } } });
    } catch {
      // Durable PENDING/ROLLED_BACK record remains; do not replace the primary mutation failure.
      this.logger.warn("Document storage compensation failed; durable recovery required");
    }
  }
}
