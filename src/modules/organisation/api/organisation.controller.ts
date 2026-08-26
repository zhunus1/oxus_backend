import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { OrganisationService } from "../service/organisation.service";
import { CreateOrganisationDto } from "./dto/create-organisation.dto";
import { UpdateOrganisationDto } from "./dto/update-organisation.dto";
import { QueryOrganisationDto } from "./dto/query-organisation.dto";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { Public } from "src/modules/admin/auth/rbac/public.decorator";

@UseGuards(JwtAuthGuard)
@Controller("organisation")
export class OrganisationController {
  constructor(private readonly service: OrganisationService) {}

  @Post()
  async create(@Body() dto: CreateOrganisationDto) {
    return this.service.create(dto);
  }

  @Public()
  @Get()
  async findAll(@Query() query: QueryOrganisationDto) {
    return this.service.findAll(query);
  }

  @Get("stats")
  async getStats() {
    return this.service.getStats();
  }

  @Public()
  @ApiResponse({ status: 404, description: "Organisation not found" })
  @Get("slug/:slug")
  async findBySlug(@Param("slug") slug: string) {
    return this.service.findBySlug(slug);
  }

  @Public()
  @ApiResponse({ status: 404, description: "Organisation not found" })
  @Get(":id")
  async findById(@Param("id", ParseIntPipe) id: number) {
    return this.service.findById(id);
  }

  @ApiResponse({ status: 404, description: "Organisation not found" })
  @Patch(":id")
  async updateById(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateOrganisationDto) {
    return this.service.updateById(id, dto);
  }

  @ApiOperation({ summary: "Upload or replace logo for an organisation" })
  @ApiConsumes("multipart/form-data")
  @ApiResponse({ status: 200, description: "Logo uploaded" })
  @ApiResponse({ status: 400, description: "Invalid file — must be JPEG/PNG/WebP, max 512 KB" })
  @ApiResponse({ status: 404, description: "Organisation not found" })
  @UseInterceptors(FileInterceptor("logo"))
  @Post(":id/logo")
  async uploadLogo(@Param("id", ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File) {
    return this.service.uploadLogo(id, file);
  }

  @ApiOperation({ summary: "Remove logo from an organisation" })
  @ApiResponse({ status: 200, description: "Logo removed" })
  @ApiResponse({ status: 404, description: "Organisation not found" })
  @Delete(":id/logo")
  async clearLogo(@Param("id", ParseIntPipe) id: number) {
    return this.service.clearLogo(id);
  }

  @ApiOperation({ summary: "Upload or replace cover image for an organisation" })
  @ApiConsumes("multipart/form-data")
  @ApiResponse({ status: 200, description: "Cover uploaded" })
  @ApiResponse({ status: 400, description: "Invalid file — must be JPEG/PNG/WebP, max 2 MB" })
  @ApiResponse({ status: 404, description: "Organisation not found" })
  @UseInterceptors(FileInterceptor("cover"))
  @Post(":id/cover")
  async uploadCover(@Param("id", ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File) {
    return this.service.uploadCover(id, file);
  }

  @ApiOperation({ summary: "Remove cover image from an organisation" })
  @ApiResponse({ status: 200, description: "Cover removed" })
  @ApiResponse({ status: 404, description: "Organisation not found" })
  @Delete(":id/cover")
  async clearCover(@Param("id", ParseIntPipe) id: number) {
    return this.service.clearCover(id);
  }

  @ApiResponse({ status: 404, description: "Organisation not found" })
  @Delete(":id")
  async deleteById(@Param("id", ParseIntPipe) id: number) {
    return this.service.deleteById(id);
  }
}
