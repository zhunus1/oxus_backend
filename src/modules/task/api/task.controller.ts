import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { TaskService } from "../service/task.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { QueryTasksDto } from "./dto/query-tasks.dto";
import { CreateCommentDto } from "./dto/create-comment.dto";

@ApiTags("Expert Tasks")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT")
@Controller("expert/tasks")
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @ApiOperation({ summary: "Create a task for one of the expert's students" })
  @ApiBody({ type: CreateTaskDto })
  @ApiResponse({ status: 201, description: "Task created" })
  @Post()
  create(@Req() req: UserRequest, @Body() dto: CreateTaskDto) {
    return this.taskService.create(req.user.id, dto);
  }

  @ApiOperation({ summary: "List tasks created by the current expert" })
  @ApiResponse({ status: 200, description: "Paginated tasks" })
  @Get()
  findAll(@Req() req: UserRequest, @Query() query: QueryTasksDto) {
    return this.taskService.findAllForExpert(req.user.id, query);
  }

  @ApiOperation({ summary: "Get full task detail with artifacts and comments" })
  @ApiParam({ name: "id", type: Number })
  @ApiResponse({ status: 200, description: "Task detail" })
  @Get(":id")
  findById(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.taskService.findByIdForExpert(req.user.id, id);
  }

  @ApiOperation({ summary: "Edit task title/description/deadline (only while not completed)" })
  @ApiParam({ name: "id", type: Number })
  @ApiBody({ type: UpdateTaskDto })
  @ApiResponse({ status: 200, description: "Task updated" })
  @Put(":id")
  updateById(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateTaskDto) {
    return this.taskService.updateById(req.user.id, id, dto);
  }

  @ApiOperation({ summary: "Soft delete a task" })
  @ApiParam({ name: "id", type: Number })
  @ApiResponse({ status: 200, description: "Task deleted" })
  @Delete(":id")
  delete(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number) {
    return this.taskService.deleteById(req.user.id, id);
  }

  @ApiOperation({ summary: "Add a comment to a task" })
  @ApiParam({ name: "id", type: Number })
  @ApiBody({ type: CreateCommentDto })
  @ApiResponse({ status: 201, description: "Comment added" })
  @Post(":id/comments")
  addComment(@Req() req: UserRequest, @Param("id", ParseIntPipe) id: number, @Body() dto: CreateCommentDto) {
    return this.taskService.addExpertComment(req.user.id, id, dto);
  }
}
