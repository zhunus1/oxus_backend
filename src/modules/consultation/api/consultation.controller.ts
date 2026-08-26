import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ConsultationService } from "../service/consultation.service";
import { CreateConsultationDto } from "./dto/create-consultation.dto";
import { BookConsultationDto } from "./dto/book-consultation.dto";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { UpdateConsultationDto } from "./dto/update-consultation.dto";
import { ConsultationQueryDto } from "./dto/consultation-query.dto";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";

@ApiTags("Consultation")
@UseGuards(JwtAuthGuard)
@Controller("consultations")
export class ConsultationController {
  constructor(private readonly consultationService: ConsultationService) {}

  @Post()
  async create(@Body() dto: CreateConsultationDto) {
    return this.consultationService.create(dto);
  }

  @ApiOperation({ summary: "Book a consultation with assigned expert" })
  @ApiResponse({ status: 201, description: "Consultation booked successfully" })
  @Post("book")
  async book(@Req() req: UserRequest, @Body() dto: BookConsultationDto) {
    return this.consultationService.book(req.user.id, dto);
  }

  @ApiOperation({ summary: "Get my consultations" })
  @ApiResponse({ status: 200, description: "Consultations fetched successfully" })
  @Get("me")
  async findMyConsultations(@Req() req: UserRequest) {
    return this.consultationService.findMyConsultations(req.user.id);
  }

  @Patch(":id")
  async update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateConsultationDto) {
    return this.consultationService.update(id, dto);
  }

  @Get(":id")
  async findById(@Param("id", ParseIntPipe) id: number) {
    return this.consultationService.findById(id);
  }

  @Get()
  async findMany(@Query() query: ConsultationQueryDto) {
    return this.consultationService.findMany(query);
  }

  @ApiOperation({ summary: "Get my meetings as expert" })
  @ApiResponse({ status: 200, description: "Expert meetings fetched successfully" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EXPERT")
  @Get("expert/me")
  async findMyExpertMeetings(@Req() req: UserRequest, @Query() query: ConsultationQueryDto) {
    return this.consultationService.findMyExpertMeetings(req.user.id, query);
  }
}
