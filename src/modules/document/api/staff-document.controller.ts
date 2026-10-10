import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, UsePipes, ValidationPipe } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RequirementType } from "generated/prisma/client";
import type { Response } from "express";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { STUDENT_DOCUMENT_MULTIPART_LIMITS, STUDENT_DOCUMENT_MAX_BYTES } from "src/common/utils/minio/student-document-file";
import { DocumentService } from "../service/document.service";
import { StaffCreateDocumentDto, StaffDocumentsQueryDto, StaffDocumentSnapshotDto, StaffDocumentIdPipe, StaffUpdateDocumentDto } from "./dto/staff-document.dto";
import { DocumentEntity } from "./dto/document.entity";
import { StaffDocumentMutationGuard } from "./staff-document-mutation.guard";
import { streamDocumentResponse } from "./document-stream-response";
import { StaffDocumentInputInterceptor, StaffInput } from "./staff-document-input.interceptor";

const file = { type: "string", format: "binary", description: "One PDF/JPEG/PNG ≤10 MiB; bounded Buffer upload, not streaming upload" };
const snapshot = {
  expectedVersion: { type: "integer", minimum: 1, maximum: 2147483647 },
  expectedUpdatedAt: { type: "string", format: "date-time", description: "Exact UTC updatedAt with milliseconds from last response" },
};
// Busboy emits size/parts limit at equality. One-byte/part sentinel permits the inclusive contract;
// the existing validator still rejects any file >10 MiB, without a Put or another file copy.
const staffMultipartLimits = { ...STUDENT_DOCUMENT_MULTIPART_LIMITS, fileSize: STUDENT_DOCUMENT_MAX_BYTES + 1 };

@ApiTags("Staff - Student Documents")
@ApiBearerAuth()
@ApiResponse({ status: 400, description: "Invalid ID, DTO, filter, snapshot or document bytes" })
@ApiResponse({ status: 401, description: "JWT required or account disabled" })
@ApiResponse({ status: 403, description: "Current staff role, active profile and assignment required" })
@ApiResponse({ status: 404, description: "Document not found within the selected portrait; archived excluded" })
@ApiResponse({ status: 409, description: "Document/access changed concurrently; reload before retrying" })
@ApiResponse({ status: 500, description: "Document operation failed; no internal details returned" })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "EXPERT")
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
@Controller("expert/portraits/:portraitId/documents")
@UseInterceptors(StaffDocumentInputInterceptor)
export class StaffDocumentController {
  constructor(private readonly documents: DocumentService) {}

  @Get()
  @StaffInput(StaffDocumentsQueryDto, "query")
  @ApiOperation({ summary: "List active documents of an authorized existing StudentPortrait" })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      required: ["data", "total", "page", "totalPages"],
      properties: {
        data: { type: "array", items: { $ref: "#/components/schemas/DocumentEntity" } },
        total: { type: "integer" },
        page: { type: "integer" },
        totalPages: { type: "integer" },
      },
    },
  })
  list(@Req() req: UserRequest, @Param("portraitId", StaffDocumentIdPipe) portraitId: number, @Query() query: StaffDocumentsQueryDto) {
    return this.documents.staffList(req.user.id, portraitId, query);
  }

  @Get(":documentId")
  @ApiOperation({ summary: "Read an active document within the selected StudentPortrait" })
  @ApiResponse({ status: 200, type: DocumentEntity })
  detail(@Req() req: UserRequest, @Param("portraitId", StaffDocumentIdPipe) portraitId: number, @Param("documentId", StaffDocumentIdPipe) id: number) {
    return this.documents.staffDetail(req.user.id, portraitId, id);
  }

  @Post()
  @StaffInput(StaffCreateDocumentDto)
  @ApiOperation({ summary: "Upload for an existing StudentPortrait without student login" })
  @UseGuards(StaffDocumentMutationGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { ...staffMultipartLimits, fields: 3, fieldSize: 1024, parts: 5 } }), StaffDocumentInputInterceptor)
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file", "title", "documentType"],
      properties: {
        file,
        title: { type: "string", minLength: 1, maxLength: 255 },
        documentType: { type: "string", enum: Object.values(RequirementType) },
        targetProgramId: { type: "integer", minimum: 1, maximum: 2147483647 },
      },
    },
  })
  @ApiResponse({ status: 201, type: DocumentEntity })
  @ApiResponse({ status: 413, description: "Multipart/file limits exceeded" })
  @ApiResponse({ status: 503, description: "Private storage unavailable" })
  upload(@Req() req: UserRequest, @Param("portraitId", StaffDocumentIdPipe) portraitId: number, @UploadedFile() upload: Express.Multer.File, @Body() dto: StaffCreateDocumentDto) {
    return this.documents.staffUpload(req.user.id, portraitId, upload, dto);
  }

  @Get(":documentId/file")
  @ApiOperation({ summary: "Stream an authorized private document; legacy returns 404" })
  @ApiProduces("application/pdf", "image/jpeg", "image/png")
  @ApiResponse({
    status: 200,
    schema: { type: "string", format: "binary" },
    headers: {
      "Content-Length": { schema: { type: "integer", minimum: 1, maximum: 10485760 } },
      "Content-Disposition": { schema: { type: "string" } },
      "Cache-Control": { schema: { type: "string", example: "private, no-store" } },
      "X-Content-Type-Options": { schema: { type: "string", example: "nosniff" } },
    },
  })
  @ApiResponse({ status: 503, description: "Private storage unavailable or response deadline exceeded" })
  download(@Req() req: UserRequest, @Param("portraitId", StaffDocumentIdPipe) portraitId: number, @Param("documentId", StaffDocumentIdPipe) id: number, @Res() res: Response) {
    return streamDocumentResponse(req, res, id, signal => this.documents.staffDownload(req.user.id, portraitId, id, signal));
  }

  @Patch(":documentId/new-version")
  @StaffInput(StaffDocumentSnapshotDto)
  @ApiOperation({ summary: "Replace private bytes using strict snapshot CAS; preserve old object" })
  @UseGuards(StaffDocumentMutationGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { ...staffMultipartLimits, fields: 2, fieldSize: 1024, parts: 4 } }), StaffDocumentInputInterceptor)
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", required: ["file", "expectedVersion", "expectedUpdatedAt"], properties: { file, ...snapshot } } })
  @ApiResponse({ status: 200, type: DocumentEntity })
  @ApiResponse({ status: 413, description: "Multipart/file limits exceeded" })
  @ApiResponse({ status: 503, description: "Private storage unavailable" })
  replace(
    @Req() req: UserRequest,
    @Param("portraitId", StaffDocumentIdPipe) portraitId: number,
    @Param("documentId", StaffDocumentIdPipe) id: number,
    @UploadedFile() upload: Express.Multer.File,
    @Body() dto: StaffDocumentSnapshotDto,
  ) {
    return this.documents.staffNewVersion(req.user.id, portraitId, id, upload, dto);
  }

  @Patch(":documentId")
  @StaffInput(StaffUpdateDocumentDto)
  @ApiOperation({ summary: "Edit title only using strict snapshot CAS" })
  @ApiResponse({ status: 200, type: DocumentEntity })
  update(
    @Req() req: UserRequest,
    @Param("portraitId", StaffDocumentIdPipe) portraitId: number,
    @Param("documentId", StaffDocumentIdPipe) id: number,
    @Body() dto: StaffUpdateDocumentDto,
  ) {
    return this.documents.staffUpdateMetadata(req.user.id, portraitId, id, dto);
  }

  @Delete(":documentId")
  @StaffInput(StaffDocumentSnapshotDto)
  @ApiOperation({ summary: "Archive with CAS/audit; authorized repeat returns success without duplicate audit" })
  @ApiResponse({ status: 200, schema: { type: "object", required: ["deleted"], properties: { deleted: { type: "boolean", enum: [true] } } } })
  remove(
    @Req() req: UserRequest,
    @Param("portraitId", StaffDocumentIdPipe) portraitId: number,
    @Param("documentId", StaffDocumentIdPipe) id: number,
    @Body() dto: StaffDocumentSnapshotDto,
  ) {
    return this.documents.staffDelete(req.user.id, portraitId, id, dto);
  }
}
