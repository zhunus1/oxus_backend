import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { DocumentRepository } from "../repository/document.repository";
import { CreateDocumentDto } from "../api/dto/create-document.dto";
import { ReviewDocumentDto } from "../api/dto/review-document.dto";
import { StudentDocumentStorageService } from "src/common/utils/minio/student-document-storage.service";
import { validateStudentDocumentFile } from "src/common/utils/minio/student-document-file";
import { DocumentStorageRecoveryService, type DocumentStorageIntent } from "./document-storage-recovery.service";
import { randomUUID } from "node:crypto";
import { AuditLogService } from "src/modules/audit-log/service/audit-log.service";
import { DocumentStatus, Prisma } from "generated/prisma/client";
import { StudentDocumentAccessService } from "src/common/authorization/student-document-access.service";
import { PrismaService } from "src/database/prisma.service";
import messages from "src/configs/messages";
import { PUBLIC_DOCUMENT_SELECT, toPublicDocument, type PublicDocument } from "src/common/serialization/public-document";

import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly entityName = "Document";

  constructor(
    private readonly repo: DocumentRepository,
    private readonly storage: StudentDocumentStorageService,
    private readonly auditLogService: AuditLogService,
    private readonly userJourneyLog: UserJourneyLogService,
    private readonly access: StudentDocumentAccessService,
    private readonly prisma: PrismaService,
    private readonly recovery: DocumentStorageRecoveryService,
  ) {}

  async upload(userId: number, portraitId: number, file: Express.Multer.File, dto: CreateDocumentDto) {
    await this.access.assertPortrait(userId, portraitId, "self");
    if (dto.targetProgramId != null) await this.access.assertOwnTargetProgram(dto.targetProgramId, portraitId);
    validateStudentDocumentFile(file);
    const created = await this.persistPrivateFile(
      userId,
      portraitId,
      file,
      { targetProgramId: dto.targetProgramId, documentId: null, action: "DOCUMENT_CREATED", fromStatus: null, fromVersion: 0 },
      (tx, fileKey) =>
        this.repo.createPrivate({ title: dto.title, fileKey, documentType: dto.documentType, studentPortraitId: portraitId, targetProgramId: dto.targetProgramId }, tx),
    );
    void this.logUploadJourney(userId, created.id, dto);
    return created;
  }

  private async logUploadJourney(userId: number, documentId: number, dto: CreateDocumentDto) {
    try {
      await this.userJourneyLog.logEvent(userId, USER_JOURNEY_EVENT.DOCUMENT_UPLOADED, {
        documentId,
        documentType: dto.documentType,
        title: dto.title,
        targetProgramId: dto.targetProgramId ?? null,
      });
    } catch {
      this.logger.warn("Post-commit document journey log failed");
    }
  }

  private async persistPrivateFile(
    userId: number,
    portraitId: number,
    file: Express.Multer.File,
    change: {
      targetProgramId?: number | null;
      documentId: number | null;
      action: "DOCUMENT_CREATED" | "DOCUMENT_VERSION_UPLOADED";
      fromStatus: DocumentStatus | null;
      fromVersion: number;
    },
    write: (tx: Prisma.TransactionClient, fileKey: string) => Promise<PublicDocument>,
  ) {
    const portrait = await this.prisma.studentPortrait.findUniqueOrThrow({ where: { id: portraitId }, select: { userId: true, consultantProfileId: true } });
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { roleId: true } });
    let intent: DocumentStorageIntent | undefined;
    let rollbackProven = false;
    try {
      const uploaded = await this.storage.uploadPrivateDocument(file, {
        signal: AbortSignal.timeout(30_000),
        beforeUpload: async fileKey => {
          intent = await this.recovery.begin(userId, {
            operationId: randomUUID(),
            fileKey,
            studentPortraitId: portraitId,
            ownerUserId: portrait.userId,
            documentId: change.documentId,
            state: "PENDING",
          });
        },
      });
      if (!intent) throw new InternalServerErrorException("Document recovery intent was not persisted");
      const persistedIntent = intent;
      return await this.prisma.$transaction(
        async tx => {
          try {
            await this.access.lockMutation(userId, portraitId, tx, change.targetProgramId);
            const currentPortrait = await tx.studentPortrait.findUniqueOrThrow({ where: { id: portraitId }, select: { userId: true, consultantProfileId: true } });
            const currentActor = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { roleId: true } });
            if (currentPortrait.userId !== portrait.userId || currentPortrait.consultantProfileId !== portrait.consultantProfileId || currentActor.roleId !== actor.roleId)
              throw new ConflictException("Document access changed; reload before retrying");
            const document = await write(tx, uploaded.fileKey);
            await this.auditLogService.log(
              userId,
              change.action,
              "Document",
              document.id,
              {
                studentPortraitId: portraitId,
                ownerUserId: portrait.userId,
                documentId: document.id,
                fromStatus: change.fromStatus,
                toStatus: document.status,
                fromVersion: change.fromVersion,
                toVersion: document.version,
                operationId: persistedIntent.details.operationId,
                fileKey: uploaded.fileKey,
              },
              tx,
            );
            await this.recovery.committed(persistedIntent, document.id, tx);
            return toPublicDocument(document);
          } catch (error) {
            // Prisma never sends COMMIT when its callback rejects. No automatic retry is used.
            rollbackProven = true;
            throw error;
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 5_000 },
      );
    } catch (error) {
      if (intent) await this.recovery.compensate(intent, rollbackProven);
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2025", "P2034"].includes(error.code)) throw new ConflictException("Document changed; reload before retrying");
      if (error instanceof HttpException) throw error;
      this.logger.error("Private document mutation failed");
      throw new InternalServerErrorException("Document could not be saved");
    }
  }

  async download(userId: number, id: number, signal?: AbortSignal) {
    const doc = await this.repo.findInternalById(id);
    if (!doc) throw new NotFoundException("Document not found");
    await this.access.assertPortrait(userId, doc.studentPortraitId);
    if (doc.fileKey === null) throw new NotFoundException("Legacy document has no private download; use its existing fileUrl");
    return this.storage.streamPrivateDocument(doc.fileKey, signal);
  }

  async findMyDocuments(userId: number, portraitId: number) {
    await this.access.assertPortrait(userId, portraitId, "self");
    try {
      return (await this.repo.findByPortraitId(portraitId)).map(document => toPublicDocument(document));
    } catch (error) {
      this.logger.error(`Error fetching documents: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findById(userId: number, id: number) {
    try {
      const doc = await this.repo.findById(id);
      if (!doc) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      await this.access.assertPortrait(userId, doc.studentPortraitId);
      return toPublicDocument(doc);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error fetching document ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entityName, id));
    }
  }

  async newVersion(userId: number, portraitId: number, id: number, file: Express.Multer.File) {
    try {
      const doc = await this.repo.findInternalById(id);
      if (!doc) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      if (doc.studentPortraitId !== portraitId) {
        throw new ForbiddenException(messages.FORBIDDEN_ACTION);
      }
      await this.access.assertPortrait(userId, portraitId, "self");

      validateStudentDocumentFile(file);
      return await this.persistPrivateFile(
        userId,
        portraitId,
        file,
        { targetProgramId: doc.targetProgramId, documentId: id, action: "DOCUMENT_VERSION_UPLOADED", fromStatus: doc.status, fromVersion: doc.version },
        (tx, fileKey) => this.repo.updatePrivateVersion(doc, fileKey, tx),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw new ConflictException("Document changed; reload before retrying");
      if (error instanceof HttpException) throw error;
      this.logger.error("Private document replacement failed");
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, id));
    }
  }

  async submitForReview(userId: number, portraitId: number, id: number) {
    try {
      const doc = await this.repo.findById(id);
      if (!doc) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      if (doc.studentPortraitId !== portraitId) {
        throw new ForbiddenException(messages.FORBIDDEN_ACTION);
      }
      await this.access.assertPortrait(userId, portraitId, "self");
      if (doc.status !== DocumentStatus.DRAFT) {
        throw new BadRequestException(messages.NOT_DRAFT(this.entityName));
      }

      return toPublicDocument(await this.repo.updateStatus(doc, DocumentStatus.REVIEW));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw new ConflictException("Document changed; reload before retrying");
      if (error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
      this.logger.error(`Error submitting document ${id} for review: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, id));
    }
  }

  async review(expertUserId: number, id: number, dto: ReviewDocumentDto) {
    try {
      if (![DocumentStatus.APPROVED, DocumentStatus.NEEDS_REVISION].includes(dto.status as "APPROVED" | "NEEDS_REVISION")) {
        throw new BadRequestException("Review status must be APPROVED or NEEDS_REVISION");
      }
      return await this.prisma.$transaction(
        async tx => {
          const doc = await tx.document.findUnique({ where: { id, deletedAt: null }, select: PUBLIC_DOCUMENT_SELECT });
          if (!doc) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
          const portraitWhere = await this.access.assertPortrait(expertUserId, doc.studentPortraitId, "review", tx);
          if (doc.status !== DocumentStatus.REVIEW) throw new BadRequestException("Document is not in REVIEW status");
          const updated = await tx.document.update({
            where: { id, deletedAt: null, status: DocumentStatus.REVIEW, version: doc.version, updatedAt: doc.updatedAt, fileUrl: doc.fileUrl, studentPortrait: portraitWhere },
            data: { status: dto.status, feedback: dto.feedback ?? undefined },
            select: PUBLIC_DOCUMENT_SELECT,
          });
          await this.auditLogService.log(
            expertUserId,
            "DOCUMENT_REVIEW",
            "Document",
            id,
            {
              fromStatus: doc.status,
              toStatus: dto.status,
              ...(dto.feedback !== undefined ? { feedback: dto.feedback } : {}),
            },
            tx,
          );
          return toPublicDocument(updated);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2025", "P2034"].includes(error.code)) throw new ConflictException("Document changed; reload before retrying");
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error reviewing document ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, id));
    }
  }
}
