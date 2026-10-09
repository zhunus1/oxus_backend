import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { DocumentRepository } from "../repository/document.repository";
import { CreateDocumentDto } from "../api/dto/create-document.dto";
import { ReviewDocumentDto } from "../api/dto/review-document.dto";
import { UploadService } from "src/common/utils/minio/upload.service";
import { AuditLogService } from "src/modules/audit-log/service/audit-log.service";
import { DocumentStatus, Prisma } from "generated/prisma/client";
import { StudentDocumentAccessService } from "src/common/authorization/student-document-access.service";
import { PrismaService } from "src/database/prisma.service";
import messages from "src/configs/messages";
import { PUBLIC_DOCUMENT_SELECT, toPublicDocument } from "src/common/serialization/public-document";

import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly entityName = "Document";

  constructor(
    private readonly repo: DocumentRepository,
    private readonly uploadService: UploadService,
    private readonly auditLogService: AuditLogService,
    private readonly userJourneyLog: UserJourneyLogService,
    private readonly access: StudentDocumentAccessService,
    private readonly prisma: PrismaService,
  ) {}

  async upload(userId: number, portraitId: number, file: Express.Multer.File, dto: CreateDocumentDto) {
    await this.access.assertPortrait(userId, portraitId, "self");
    if (dto.targetProgramId != null) await this.access.assertOwnTargetProgram(dto.targetProgramId, portraitId);
    try {
      const fileUrl = await this.uploadService.uploadFile("documents", file);
      const created = await this.repo.create({
        title: dto.title,
        fileUrl,
        documentType: dto.documentType,
        studentPortraitId: portraitId,
        targetProgramId: dto.targetProgramId,
      });
      void this.userJourneyLog.logEvent(userId, USER_JOURNEY_EVENT.DOCUMENT_UPLOADED, {
        documentId: created.id,
        documentType: dto.documentType,
        title: dto.title,
        targetProgramId: dto.targetProgramId ?? null,
      });
      return toPublicDocument(created);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Error uploading document: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
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
      const doc = await this.repo.findById(id);
      if (!doc) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      if (doc.studentPortraitId !== portraitId) {
        throw new ForbiddenException(messages.FORBIDDEN_ACTION);
      }
      await this.access.assertPortrait(userId, portraitId, "self");

      const fileUrl = await this.uploadService.uploadFile("documents", file);
      await this.access.assertPortrait(userId, portraitId, "self");
      return toPublicDocument(await this.repo.updateVersion(doc, fileUrl));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw new ConflictException("Document changed; reload before retrying");
      if (error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
      this.logger.error(`Error uploading new version for document ${id}: ${error}`);
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
