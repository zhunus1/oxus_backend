import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { CreateQsImportJobDto } from "./dto/create-qs-import-job.dto";
import { QueryQsImportJobDto } from "./dto/query-qs-import-job.dto";
import { QsImportService } from "../service/qs-import.service";

@ApiTags("QS Organisation Import")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
@Controller("admin")
export class QsImportController {
  constructor(private readonly qsImportService: QsImportService) {}

  @Post("qs-import-jobs")
  @ApiOperation({ summary: "Upload a QS rankings XLSX file and enqueue organisation import" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
        },
        limit: {
          type: "number",
          nullable: true,
        },
      },
      required: ["file"],
    },
  })
  @ApiResponse({ status: 201, description: "QS import job created successfully" })
  @UseInterceptors(FileInterceptor("file"))
  async createJob(@Req() req: UserRequest, @UploadedFile() file: Express.Multer.File, @Body() dto: CreateQsImportJobDto) {
    return this.qsImportService.createImportJob(file, req.user.id, dto);
  }

  @Get("qs-import-jobs")
  @ApiOperation({ summary: "List QS organisation import jobs" })
  async listJobs(@Query() query: QueryQsImportJobDto) {
    return this.qsImportService.listJobs(query);
  }

  @Get("qs-import-jobs/:id")
  @ApiOperation({ summary: "Get QS organisation import job details" })
  async findById(@Param("id", ParseIntPipe) id: number) {
    return this.qsImportService.findJobById(id);
  }
}
