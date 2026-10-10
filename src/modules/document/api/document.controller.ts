import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { ApiBodyOptions } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { DocumentService } from "../service/document.service";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { ReviewDocumentDto } from "./dto/review-document.dto";
import { StudentPortraitService } from "src/modules/studentportrait/service/studentportrait.service";
import { STUDENT_DOCUMENT_MULTIPART_LIMITS, STUDENT_DOCUMENT_MAX_BYTES } from "src/common/utils/minio/student-document-file";
import { DocumentMutationGuard } from "./document-mutation.guard";
import type { Response } from "express";
import { streamDocumentResponse } from "./document-stream-response";
import { RequirementType } from "generated/prisma/client";

// Busboy emits its file limit at equality; the validator still enforces the inclusive 10 MiB bound.
const studentMultipartLimits = { ...STUDENT_DOCUMENT_MULTIPART_LIMITS, fileSize: STUDENT_DOCUMENT_MAX_BYTES + 1 };

const uploadBody = {
  schema: {
    type: "object",
    required: ["file", "title", "documentType"],
    properties: {
      file: { type: "string", format: "binary", description: "One non-empty PDF/JPEG/PNG, at most 10 MiB; MIME and bytes must match" },
      title: { type: "string" },
      documentType: { type: "string", enum: Object.values(RequirementType) },
      targetProgramId: { type: "integer" },
    },
  },
} satisfies ApiBodyOptions;

@ApiTags("Documents")
@ApiBearerAuth()
@ApiResponse({ status: 400, description: "Invalid input or document bytes" })
@ApiResponse({ status: 401, description: "JWT required or account disabled" })
@ApiResponse({ status: 404, description: "Active document or private object not found" })
@ApiResponse({ status: 413, description: "File exceeds 10 MiB" })
@ApiResponse({ status: 503, description: "Private storage unavailable or timed out" })
@UseGuards(JwtAuthGuard)
@Controller("documents")
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly studentPortraitService: StudentPortraitService,
  ) {}

  private async getPortraitId(userId: number): Promise<number> {
    const portrait = await this.studentPortraitService.findMe(userId);
    return portrait.id;
  }

  @ApiOperation({ summary: "Upload a document" })
  @ApiConsumes("multipart/form-data")
  @ApiBody(uploadBody)
  @ApiResponse({ status: 201, description: "Document uploaded successfully" })
  @ApiResponse({ status: 409, description: "Document access changed concurrently; reload before uploading" })
  @ApiResponse({ status: 403, description: "Document upload access denied" })
  @UseGuards(DocumentMutationGuard)
  @UseInterceptors(FileInterceptor("file", { limits: studentMultipartLimits }))
  @Post()
  async upload(@Req() req: UserRequest, @UploadedFile() file: Express.Multer.File, @Body() dto: CreateDocumentDto) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.documentService.upload(req.user.id, portraitId, file, dto);
  }

  @ApiOperation({ summary: "Get my documents" })
  @ApiResponse({ status: 200, description: "Documents fetched successfully" })
  @ApiResponse({ status: 403, description: "Document list access denied" })
  @Get("me")
  async findMy(@Req() req: UserRequest) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.documentService.findMyDocuments(req.user.id, portraitId);
  }

  @ApiOperation({
    summary: "Download an authorized private document",
    description: "Send JWT credentials explicitly. Legacy documents retain their existing public fileUrl and return 404 here.",
  })
  @ApiProduces("application/pdf", "image/jpeg", "image/png")
  @ApiResponse({
    status: 200,
    description: "Binary attachment",
    schema: { type: "string", format: "binary" },
    headers: {
      "Content-Disposition": { description: "attachment with a server-generated filename", schema: { type: "string" } },
      "Content-Type": { description: "Verified PDF/JPEG/PNG metadata", schema: { type: "string" } },
      "Content-Length": { description: "Positive integer, at most 10 MiB", schema: { type: "integer" } },
      "Cache-Control": { schema: { type: "string", example: "private, no-store" } },
      "X-Content-Type-Options": { schema: { type: "string", example: "nosniff" } },
    },
  })
  @ApiResponse({ status: 403, description: "Document ownership or active expert assignment required" })
  @Get(":id/file")
  async download(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Res() res: Response) {
    return streamDocumentResponse(req, res, id, signal => this.documentService.download(req.user.id, id, signal));
  }

  @ApiOperation({ summary: "Get document by id" })
  @ApiResponse({ status: 200, description: "Document fetched successfully" })
  @ApiResponse({ status: 403, description: "Document read access denied" })
  @Get(":id")
  async findById(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.documentService.findById(req.user.id, id);
  }

  @ApiOperation({ summary: "Upload new version of document" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", required: ["file"], properties: { file: uploadBody.schema.properties.file } } })
  @ApiResponse({ status: 200, description: "New version uploaded successfully" })
  @ApiResponse({ status: 403, description: "Document replacement access denied" })
  @ApiResponse({ status: 409, description: "Document changed concurrently; reload before replacing" })
  @UseGuards(DocumentMutationGuard)
  @UseInterceptors(FileInterceptor("file", { limits: studentMultipartLimits }))
  @Patch(":id/new-version")
  async newVersion(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.documentService.newVersion(req.user.id, portraitId, id, file);
  }

  @ApiOperation({ summary: "Submit document for expert review" })
  @ApiResponse({ status: 200, description: "Document submitted for review" })
  @ApiResponse({ status: 403, description: "Document submission access denied" })
  @ApiResponse({ status: 409, description: "Document changed concurrently; reload before submitting" })
  @Patch(":id/submit-for-review")
  async submitForReview(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.documentService.submitForReview(req.user.id, portraitId, id);
  }

  @ApiOperation({ summary: "Assigned active expert or admin reviews a document" })
  @ApiResponse({ status: 200, description: "Document reviewed successfully" })
  @ApiResponse({ status: 403, description: "Document review access denied" })
  @ApiResponse({ status: 409, description: "Document changed concurrently; reload before reviewing" })
  @UseGuards(RolesGuard)
  @Roles("EXPERT", "ADMIN")
  @Patch(":id/review")
  async review(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: ReviewDocumentDto) {
    return this.documentService.review(req.user.id, id, dto);
  }
}
