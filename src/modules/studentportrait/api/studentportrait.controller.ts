import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { StudentPortraitService } from "../service/studentportrait.service";
import { PortraitEntity } from "./dto/portrait.entity";
import { UpdatePortraitDto } from "./dto/update-portrait.dto";
import { AddPortraitLanguageDto } from "./dto/add-portrait-language.dto";
import { CreatePortraitTestDto } from "./dto/create-portrait-test.dto";
import { UpdatePortraitTestDto } from "./dto/update-portrait-test.dto";
import { AddPortraitCountryDto } from "./dto/add-portrait-country.dto";

@ApiTags("Student Portrait")
@UseGuards(JwtAuthGuard)
@Controller("portraits")
export class StudentPortraitController {
  constructor(private readonly studentPortraitService: StudentPortraitService) {}

  @ApiOperation({ summary: "Get current student's portrait" })
  @Get("me")
  async findMe(@Req() req: UserRequest): Promise<PortraitEntity> {
    return this.studentPortraitService.findMe(req.user.id);
  }

  @ApiOperation({ summary: "Update current student's portrait" })
  @Patch("me")
  async updateMe(@Req() req: UserRequest, @Body() dto: UpdatePortraitDto): Promise<PortraitEntity> {
    return this.studentPortraitService.updateMe(req.user.id, dto);
  }

  @ApiOperation({ summary: "Add language to current student's portrait" })
  @Post("me/languages")
  async addLanguage(@Req() req: UserRequest, @Body() dto: AddPortraitLanguageDto) {
    return this.studentPortraitService.addLanguage(req.user.id, dto);
  }

  @ApiOperation({ summary: "Delete language from current student's portrait" })
  @Delete("me/languages/:languageId")
  async deleteLanguage(@Req() req: UserRequest, @Param("languageId", ParseIntPipe) languageId: number) {
    return this.studentPortraitService.deleteLanguage(req.user.id, languageId);
  }

  @ApiOperation({ summary: "Add test to current student's portrait" })
  @Post("me/tests")
  async addTest(@Req() req: UserRequest, @Body() dto: CreatePortraitTestDto) {
    return this.studentPortraitService.addTest(req.user.id, dto);
  }

  @ApiOperation({ summary: "Update test of current student's portrait" })
  @Patch("me/tests/:testId")
  async updateTest(@Req() req: UserRequest, @Param("testId", ParseIntPipe) testId: number, @Body() dto: UpdatePortraitTestDto) {
    return this.studentPortraitService.updateTest(req.user.id, testId, dto);
  }

  @ApiOperation({ summary: "Delete test from current student's portrait" })
  @Delete("me/tests/:testId")
  async deleteTest(@Req() req: UserRequest, @Param("testId", ParseIntPipe) testId: number) {
    return this.studentPortraitService.deleteTest(req.user.id, testId);
  }

  @ApiOperation({ summary: "Add target country to current student's portrait" })
  @Post("me/countries")
  async addTargetCountry(@Req() req: UserRequest, @Body() dto: AddPortraitCountryDto) {
    return this.studentPortraitService.addTargetCountry(req.user.id, dto.countryId);
  }

  @ApiOperation({ summary: "Delete target country from current student's portrait" })
  @Delete("me/countries/:countryId")
  async deleteTargetCountry(@Req() req: UserRequest, @Param("countryId", ParseIntPipe) countryId: number) {
    return this.studentPortraitService.deleteTargetCountry(req.user.id, countryId);
  }
}
