import { MulterExceptionInterceptor } from "src/common/interceptors/multer-exception.interceptor";
import { scanRequest, scanUploadResponse } from "src/common/openapi/flow-responses";
import { Controller, Get, Header, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { ContractScanService } from "../service/contract-scan.service";

@ApiTags("Contract")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("contracts")
export class ContractScanController {
  constructor(private readonly scans: ContractScanService) {}

  @Post(":id/scan")
  @UseGuards(RolesGuard)
  @Roles("EXPERT", "ADMIN")
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: scanRequest })
  @ApiResponse({ status: 201, schema: scanUploadResponse })
  @ApiResponse({ status: 400, description: "Invalid file MIME/content; PDF, JPEG or PNG only, up to 10 MiB" })
  @ApiResponse({ status: 413, description: "File exceeds 10 MiB" })
  @ApiResponse({ status: 409, description: "Attach scans after manual contract confirmation" })
  // Preserve the existing exclusive boundary now that Multer limits are inclusive.
  @UseInterceptors(MulterExceptionInterceptor, FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 - 1, files: 1 } }))
  upload(@Req() req: UserRequest, @Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    return this.scans.upload(id, req.user.id, file, req.user.roleCode === "ADMIN");
  }

  @ApiResponse({
    status: 200,
    description: "Binary scan; owner student, current expert or ADMIN",
    content: Object.fromEntries(["application/pdf", "image/jpeg", "image/png", "application/octet-stream"].map(mime => [mime, { schema: { type: "string", format: "binary" } }])),
  })
  @Get(":id/scan")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  download(@Req() req: UserRequest, @Param("id") id: string) {
    return this.scans.download(id, req.user.id);
  }
}
