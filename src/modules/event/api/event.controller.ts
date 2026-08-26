import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { EventService } from "../service/event.service";
import { CreateEventDto } from "./dto/create-event.dto";
import { UpdateEventDto } from "./dto/update-event.dto";
import { QueryEventDto } from "./dto/query-event.dto";
import { CreateTestDto } from "src/modules/test/api/dto/create-test.dto";
import { UpdateTestDto } from "src/modules/test/api/dto/update-test.dto";
import { CreateQuestionDto } from "src/modules/question/api/dto/create-question.dto";
import { UpdateQuestionDto } from "src/modules/question/api/dto/update-question.dto";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";

@ApiTags("event")
@Controller("event")
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @Get()
  async findAll(@Query() queryEventDto: QueryEventDto) {
    return this.eventService.findAll(queryEventDto);
  }

  @Get("id/:id")
  async findById(@Param("id", ParseIntPipe) id: number) {
    return this.eventService.findById(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EXPERT")
  @ApiOperation({ summary: "Get all leads from all expert events" })
  @ApiResponse({ status: 200, description: "All expert leads fetched successfully" })
  @Get("leads")
  async findAllLeads(@Req() req: UserRequest) {
    return this.eventService.findAllLeads(req.user.id);
  }

  @Get(":slug")
  async findBySlug(@Param("slug") slug: string) {
    return this.eventService.findBySlug(slug);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EXPERT")
  @Post()
  async create(@Req() req: UserRequest, @Body() createEventDto: CreateEventDto) {
    return this.eventService.create(createEventDto, req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EXPERT")
  @Patch("id/:id")
  async updateEvent(@Param("id", ParseIntPipe) id: number, @Body() updateEventDto: UpdateEventDto) {
    return this.eventService.updateById(id, updateEventDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EXPERT")
  @ApiOperation({ summary: "Get students registered from this event" })
  @ApiParam({ name: "id", type: Number })
  @ApiResponse({ status: 200, description: "Event leads fetched successfully" })
  @Get("id/:id/leads")
  async findLeads(@Param("id", ParseIntPipe) id: number) {
    return this.eventService.findLeads(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EXPERT")
  @ApiOperation({ summary: "Get a student's test answers for this event" })
  @ApiParam({ name: "id", type: Number })
  @ApiParam({ name: "userId", type: Number })
  @ApiResponse({ status: 200, description: "Student answers fetched successfully" })
  @Get("id/:id/leads/:userId/answers")
  async findLeadAnswers(@Param("id", ParseIntPipe) id: number, @Param("userId", ParseIntPipe) userId: number) {
    return this.eventService.findLeadAnswers(id, userId);
  }

  @Post("id/:id/test")
  async createTest(@Param("id", ParseIntPipe) id: number, @Body() createTestDto: CreateTestDto) {
    return this.eventService.createTest(id, createTestDto);
  }

  @Patch("id/:id/test")
  async updateTest(@Param("id", ParseIntPipe) id: number, @Body() updateTestDto: UpdateTestDto) {
    return this.eventService.updateTest(id, updateTestDto);
  }

  @Post("id/:id/test/questions")
  async createQuestion(@Param("id", ParseIntPipe) id: number, @Body() createQuestionDto: CreateQuestionDto) {
    return this.eventService.createQuestion(id, createQuestionDto);
  }

  @Patch("id/:id/test/questions/:questionId")
  async updateQuestion(@Param("id", ParseIntPipe) id: number, @Param("questionId", ParseIntPipe) questionId: number, @Body() updateQuestionDto: UpdateQuestionDto) {
    return this.eventService.updateQuestion(id, questionId, updateQuestionDto);
  }
}
