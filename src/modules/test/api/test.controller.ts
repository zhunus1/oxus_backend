import { Controller, Get, Post, Delete, Body, Param, ParseIntPipe, UsePipes, ValidationPipe, Query, Put } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from "@nestjs/swagger";
import { TestService } from "../service/test.service";
import { CreateTestDto } from "./dto/create-test.dto";
import { UpdateTestDto } from "./dto/update-test.dto";
import { QueryTestDto } from "./dto/query-test.dto";
import { CreateQuestionSegmentDto } from "./dto/create-question-segment.dto";
import { QuestionSegmentService } from "../service/question-segment.service";
import { Permissions } from "src/modules/admin/auth/rbac/permissions.decorator";

@ApiTags("Tests")
@Controller("tests")
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class TestController {
  constructor(
    private readonly testService: TestService,
    private readonly segmentService: QuestionSegmentService,
  ) {}

  // ── Tests ────────────────────────────────────────────────────────────────────

  @Permissions("CREATE_TEST")
  @Post()
  @ApiOperation({ summary: "Create new test" })
  @ApiResponse({ status: 201, description: "Test created successfully" })
  @ApiBody({ type: CreateTestDto })
  async create(@Body() dto: CreateTestDto) {
    return this.testService.create(dto);
  }

  @Permissions("VIEW_TEST")
  @Get()
  @ApiOperation({ summary: "Get all tests" })
  @ApiResponse({ status: 200, description: "List of all tests" })
  async findAll(@Query() dto: QueryTestDto) {
    return this.testService.findAll(dto);
  }

  @Permissions("VIEW_TEST")
  @Get(":id")
  @ApiOperation({ summary: "Find test by ID (includes segments)" })
  @ApiParam({ name: "id", description: "Test ID", example: 1 })
  @ApiResponse({ status: 200, description: "Test found" })
  @ApiResponse({ status: 404, description: "Test not found" })
  async findById(@Param("id", ParseIntPipe) id: number) {
    return this.testService.findById(id);
  }

  @Permissions("UPDATE_TEST")
  @Put(":id")
  @ApiOperation({ summary: "Update test by ID" })
  @ApiParam({ name: "id", description: "Test ID", example: 1 })
  @ApiResponse({ status: 200, description: "Test updated successfully" })
  @ApiResponse({ status: 404, description: "Test not found" })
  async updateById(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateTestDto) {
    return this.testService.updateById(id, dto);
  }

  @Permissions("DELETE_TEST")
  @Delete(":id")
  @ApiOperation({ summary: "Delete test by ID" })
  @ApiParam({ name: "id", description: "Test ID", example: 1 })
  @ApiResponse({ status: 200, description: "Test deleted successfully" })
  @ApiResponse({ status: 404, description: "Test not found" })
  async deleteById(@Param("id", ParseIntPipe) id: number) {
    return this.testService.deleteById(id);
  }

  // ── Segments ─────────────────────────────────────────────────────────────────

  @Permissions("CREATE_TEST")
  @Post(":testId/segments")
  @ApiOperation({ summary: "Create a segment for a test" })
  @ApiParam({ name: "testId", description: "Test ID", example: 1 })
  @ApiBody({ type: CreateQuestionSegmentDto })
  @ApiResponse({ status: 201, description: "Segment created" })
  @ApiResponse({ status: 409, description: "Segment with that title already exists in this test" })
  async createSegment(@Param("testId", ParseIntPipe) testId: number, @Body() dto: CreateQuestionSegmentDto) {
    return this.segmentService.create(testId, dto);
  }

  @Permissions("VIEW_TEST")
  @Get(":testId/segments")
  @ApiOperation({ summary: "List all segments for a test" })
  @ApiParam({ name: "testId", description: "Test ID", example: 1 })
  @ApiResponse({ status: 200, description: "List of segments" })
  async findSegments(@Param("testId", ParseIntPipe) testId: number) {
    return this.segmentService.findAll(testId);
  }

  @Permissions("DELETE_TEST")
  @Delete(":testId/segments/:id")
  @ApiOperation({ summary: "Delete a segment by ID" })
  @ApiParam({ name: "testId", description: "Test ID", example: 1 })
  @ApiParam({ name: "id", description: "Segment ID", example: 1 })
  @ApiResponse({ status: 200, description: "Segment deleted" })
  @ApiResponse({ status: 404, description: "Segment not found" })
  async deleteSegment(@Param("testId", ParseIntPipe) testId: number, @Param("id", ParseIntPipe) id: number) {
    return this.segmentService.deleteById(testId, id);
  }
}
