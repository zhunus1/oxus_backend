import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { DocumentRepository } from "../repository/document.repository";
import { CreateDocumentDto } from "../api/dto/create-document.dto";
import { ReviewDocumentDto } from "../api/dto/review-document.dto";
import { UploadService } from "src/common/utils/minio/upload.service";
import { AuditLogService } from "src/modules/audit-log/service/audit-log.service";
import { DocumentStatus } from "generated/prisma/client";
import messages from "src/configs/messages";

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
  ) {}

  async upload(userId: number, portraitId: number, file: Express.Multer.File, dto: CreateDocumentDto) {
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
      return created;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Error uploading document: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  async findMyDocuments(portraitId: number) {
    try {
      return await this.repo.findByPortraitId(portraitId);
    } catch (error) {
      this.logger.error(`Error fetching documents: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findById(id: number) {
    try {
      const doc = await this.repo.findById(id);
      if (!doc) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      return doc;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
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

      const fileUrl = await this.uploadService.uploadFile("documents", file);
      return await this.repo.updateVersion(id, fileUrl, doc.version + 1);
    } catch (error) {
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
      if (doc.status !== DocumentStatus.DRAFT) {
        throw new BadRequestException(messages.NOT_DRAFT(this.entityName));
      }

      return await this.repo.updateStatus(id, DocumentStatus.REVIEW);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
      this.logger.error(`Error submitting document ${id} for review: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, id));
    }
  }

  async review(expertUserId: number, id: number, dto: ReviewDocumentDto) {
    try {
      const doc = await this.repo.findById(id);
      if (!doc) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      if (doc.status !== DocumentStatus.REVIEW) {
        throw new BadRequestException("Document is not in REVIEW status");
      }

      const updated = await this.repo.updateStatus(id, dto.status, dto.feedback);

      await this.auditLogService.log(expertUserId, "DOCUMENT_REVIEW", "Document", id, {
        fromStatus: doc.status,
        toStatus: dto.status,
        feedback: dto.feedback,
      });

      return updated;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error(`Error reviewing document ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, id));
    }
  }
}
