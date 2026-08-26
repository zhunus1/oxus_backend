import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { RolesGuard } from "src/modules/admin/auth/rbac/roles.guard";
import { Roles } from "src/modules/admin/auth/rbac/roles.decorator";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";

import { CollabMeetingService } from "../service/collab-meeting.service";
import { CreateCollabMeetingDto } from "./dto/create-collab-meeting.dto";
import { CreateCollabTodoDto } from "./dto/create-collab-todo.dto";
import { UpdateCollabTodoDto } from "./dto/update-collab-todo.dto";
import { UpsertCollabNoteDto } from "./dto/upsert-collab-note.dto";

@ApiTags("CollabMeeting")
@Controller("collab-meetings")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EXPERT", "ADMIN")
export class CollabMeetingController {
  constructor(private readonly service: CollabMeetingService) {}

  @ApiOperation({ summary: "List invitable users (experts + admins)" })
  @ApiResponse({ status: 200 })
  @Get("invitees")
  getInvitableUsers() {
    return this.service.getInvitableUsers();
  }

  @ApiOperation({ summary: "Create a collab meeting and notify invitees" })
  @ApiBody({ type: CreateCollabMeetingDto })
  @ApiResponse({ status: 201 })
  @Post()
  create(@Req() req: UserRequest, @Body() dto: CreateCollabMeetingDto) {
    const name = `${req.user.firstname} ${req.user.lastname}`.trim();
    return this.service.create(req.user.id, name, dto);
  }

  @ApiOperation({ summary: "List collab meetings for current user" })
  @ApiResponse({ status: 200 })
  @Get()
  list(@Req() req: UserRequest) {
    return this.service.listForUser(req.user.id);
  }

  @ApiOperation({ summary: "Get collab meeting detail (includes own note + all todos)" })
  @ApiParam({ name: "id", type: String })
  @ApiResponse({ status: 200 })
  @Get(":id")
  getDetail(@Param("id") id: string, @Req() req: UserRequest) {
    return this.service.getDetail(id, req.user.id);
  }

  @ApiOperation({ summary: "Get Jitsi access token for collab meeting" })
  @ApiParam({ name: "id", type: String })
  @ApiResponse({ status: 200 })
  @Get(":id/access")
  getAccess(@Param("id") id: string, @Req() req: UserRequest) {
    const name = `${req.user.firstname} ${req.user.lastname}`.trim();
    return this.service.getAccess(id, req.user.id, name);
  }

  @ApiOperation({ summary: "Add invitees to an existing meeting (admin only)" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ schema: { properties: { userIds: { type: "array", items: { type: "number" } } } } })
  @ApiResponse({ status: 200 })
  @Roles("ADMIN")
  @Patch(":id/invitees")
  addInvitees(@Param("id") id: string, @Body() body: { userIds: number[] }) {
    return this.service.addInvitees(id, body.userIds);
  }

  @ApiOperation({ summary: "Update collab meeting status" })
  @ApiParam({ name: "id", type: String })
  @ApiResponse({ status: 200 })
  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Req() req: UserRequest, @Body() body: { status: "SCHEDULED" | "COMPLETED" | "CANCELLED" }) {
    return this.service.updateStatus(id, req.user.id, body.status);
  }

  @ApiOperation({ summary: "Upsert personal note for meeting" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: UpsertCollabNoteDto })
  @ApiResponse({ status: 200 })
  @Put(":id/notes")
  upsertNote(@Param("id") id: string, @Req() req: UserRequest, @Body() dto: UpsertCollabNoteDto) {
    return this.service.upsertNote(id, req.user.id, dto.content);
  }

  @ApiOperation({ summary: "Add a shared todo to the meeting" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: CreateCollabTodoDto })
  @ApiResponse({ status: 201 })
  @Post(":id/todos")
  createTodo(@Param("id") id: string, @Req() req: UserRequest, @Body() dto: CreateCollabTodoDto) {
    return this.service.createTodo(id, req.user.id, dto);
  }

  @ApiOperation({ summary: "Update a todo (text or completed)" })
  @ApiParam({ name: "id", type: String })
  @ApiParam({ name: "todoId", type: Number })
  @ApiBody({ type: UpdateCollabTodoDto })
  @ApiResponse({ status: 200 })
  @Patch(":id/todos/:todoId")
  updateTodo(@Param("id") id: string, @Param("todoId", ParseIntPipe) todoId: number, @Req() req: UserRequest, @Body() dto: UpdateCollabTodoDto) {
    return this.service.updateTodo(id, todoId, req.user.id, dto);
  }

  @ApiOperation({ summary: "Delete a todo" })
  @ApiParam({ name: "id", type: String })
  @ApiParam({ name: "todoId", type: Number })
  @ApiResponse({ status: 200 })
  @Delete(":id/todos/:todoId")
  deleteTodo(@Param("id") id: string, @Param("todoId", ParseIntPipe) todoId: number) {
    return this.service.deleteTodo(id, todoId);
  }
}
