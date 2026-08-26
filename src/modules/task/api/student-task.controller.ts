import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { TaskService } from "../service/task.service";
import { QueryTasksDto } from "./dto/query-tasks.dto";
import { SubmitTextAnswerDto } from "./dto/submit-text-answer.dto";
import { CreateCommentDto } from "./dto/create-comment.dto";

@ApiTags("Student Tasks")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STUDENT")
@Controller("tasks")
export class StudentTaskController {
  constructor(private readonly taskService: TaskService) {}

  @ApiOperation({ summary: "List the current student's tasks (main page cards)" })
  @ApiResponse({ status: 200, description: "Paginated tasks" })
  @Get()
  findAll(@Req() req: UserRequest, @Query() query: QueryTasksDto) {
    return this.taskService.findAllForStudent(req.user.id, query);
  }

  @ApiOperation({ summary: "Get full task detail (dynamic zone, attempt answers, comments)" })
  @ApiParam({ name: "id", type: Number })
  @ApiResponse({ status: 200, description: "Task detail" })
  @Get(":id")
  findById(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.taskService.findByIdForStudent(req.user.id, id);
  }

  @ApiOperation({ summary: "Upload a file for a FILE_UPLOAD task (marks it completed)" })
  @ApiParam({ name: "id", type: Number })
  @ApiConsumes("multipart/form-data")
  @ApiResponse({ status: 201, description: "File uploaded, task completed" })
  @UseInterceptors(FileInterceptor("file"))
  @Post(":id/file")
  submitFile(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File) {
    return this.taskService.submitFile(req.user.id, id, file);
  }

  @ApiOperation({ summary: "Submit a text answer for a TEXT_ANSWER task (marks it completed)" })
  @ApiParam({ name: "id", type: Number })
  @ApiBody({ type: SubmitTextAnswerDto })
  @ApiResponse({ status: 201, description: "Text answer saved, task completed" })
  @Post(":id/text")
  submitText(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: SubmitTextAnswerDto) {
    return this.taskService.submitText(req.user.id, id, dto);
  }

  @ApiOperation({ summary: "Start the test attempt for a TEST task (sets it in progress)" })
  @ApiParam({ name: "id", type: Number })
  @ApiResponse({ status: 201, description: "Attempt created and linked" })
  @Post(":id/attempt")
  startTestAttempt(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.taskService.startTestAttempt(req.user.id, id);
  }

  @ApiOperation({ summary: "Complete a TEST task after finishing the attempt" })
  @ApiParam({ name: "id", type: Number })
  @ApiResponse({ status: 201, description: "Task completed" })
  @Post(":id/complete")
  completeTest(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.taskService.completeTest(req.user.id, id);
  }

  @ApiOperation({ summary: "Add a comment to a task" })
  @ApiParam({ name: "id", type: Number })
  @ApiBody({ type: CreateCommentDto })
  @ApiResponse({ status: 201, description: "Comment added" })
  @Post(":id/comments")
  addComment(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: CreateCommentDto) {
    return this.taskService.addStudentComment(req.user.id, id, dto);
  }
}
