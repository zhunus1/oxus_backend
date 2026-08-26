import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { DocumentService } from "../service/document.service";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { ReviewDocumentDto } from "./dto/review-document.dto";
import { StudentPortraitService } from "src/modules/studentportrait/service/studentportrait.service";

@ApiTags("Documents")
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
  @ApiResponse({ status: 201, description: "Document uploaded successfully" })
  @UseInterceptors(FileInterceptor("file"))
  @Post()
  async upload(@Req() req: UserRequest, @UploadedFile() file: Express.Multer.File, @Body() dto: CreateDocumentDto) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.documentService.upload(req.user.id, portraitId, file, dto);
  }

  @ApiOperation({ summary: "Get my documents" })
  @ApiResponse({ status: 200, description: "Documents fetched successfully" })
  @Get("me")
  async findMy(@Req() req: UserRequest) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.documentService.findMyDocuments(portraitId);
  }

  @ApiOperation({ summary: "Get document by id" })
  @ApiResponse({ status: 200, description: "Document fetched successfully" })
  @Get(":id")
  async findById(@Param("id", ParseIntPipe) id: number) {
    return this.documentService.findById(id);
  }

  @ApiOperation({ summary: "Upload new version of document" })
  @ApiConsumes("multipart/form-data")
  @ApiResponse({ status: 200, description: "New version uploaded successfully" })
  @UseInterceptors(FileInterceptor("file"))
  @Patch(":id/new-version")
  async newVersion(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.documentService.newVersion(req.user.id, portraitId, id, file);
  }

  @ApiOperation({ summary: "Submit document for expert review" })
  @ApiResponse({ status: 200, description: "Document submitted for review" })
  @Patch(":id/submit-for-review")
  async submitForReview(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    const portraitId = await this.getPortraitId(req.user.id);
    return this.documentService.submitForReview(req.user.id, portraitId, id);
  }

  @ApiOperation({ summary: "Expert reviews a document" })
  @ApiResponse({ status: 200, description: "Document reviewed successfully" })
  @UseGuards(RolesGuard)
  @Roles("EXPERT")
  @Patch(":id/review")
  async review(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: ReviewDocumentDto) {
    return this.documentService.review(req.user.id, id, dto);
  }
}
