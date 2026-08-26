import { Controller, Post, Body, Get, Param, ParseIntPipe, Patch } from "@nestjs/common";
import { CreateQuestionDto } from "./dto/create-question.dto";
import { QuestionService } from "../service/question.service";
import { QuestionEntity } from "./dto/question.entity";
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from "@nestjs/swagger";
import { UpdateQuestionDto } from "./dto/update-question.dto";

@ApiTags("Questions")
@Controller("tests/:testId/questions")
export class QuestionController {
  constructor(private readonly service: QuestionService) {}

  @ApiOperation({ summary: "Create new question" })
  @ApiResponse({ status: 201, description: "Question created successfully" })
  @ApiBody({ type: CreateQuestionDto })
  @Post()
  async create(@Param("testId", ParseIntPipe) testId: number, @Body() dto: CreateQuestionDto): Promise<QuestionEntity> {
    return this.service.create(testId, dto);
  }

  @ApiOperation({ summary: "Get all questions" })
  @ApiResponse({ status: 200, description: "List of all questions" })
  @Get()
  async findAll(@Param("testId", ParseIntPipe) testId: number): Promise<QuestionEntity[]> {
    return this.service.findAll(testId);
  }

  @ApiOperation({ summary: "Find question by ID" })
  @ApiResponse({ status: 200, description: "Question found" })
  @ApiResponse({ status: 404, description: "Question not found" })
  @Get(":id")
  async findOneById(@Param("testId", ParseIntPipe) testId: number, @Param("id", ParseIntPipe) id: number): Promise<QuestionEntity> {
    return this.service.findOneById(testId, id);
  }

  @ApiOperation({ summary: "Update question by ID" })
  @ApiResponse({ status: 200, description: "Question updated successfully" })
  @Patch(":id")
  async updateById(@Param("testId", ParseIntPipe) testId: number, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateQuestionDto): Promise<QuestionEntity> {
    return this.service.updateById(testId, id, dto);
  }
}
