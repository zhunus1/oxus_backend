import { Injectable } from "@nestjs/common";
import { Prisma, Task } from "generated/prisma/client";
import { TaskStatus } from "generated/prisma/enums";
import { BaseRepository } from "src/database/prisma.repository";
import { CreateTaskDto } from "../api/dto/create-task.dto";
import { UpdateTaskDto } from "../api/dto/update-task.dto";
import { QueryTasksDto } from "../api/dto/query-tasks.dto";
import { PaginatedResponseDto } from "src/common/dtos/pagination.dto";
import { TaskListItemEntity } from "../api/dto/task-list-item.entity";
import { TaskBaseEntity } from "../api/dto/task-base.entity";
import { TaskEntity, TaskTestEntity, TaskUserEntity } from "../api/dto/task.entity";
import { TaskCommentEntity } from "../api/dto/task-comment.entity";

const taskDetailInclude = {
  test: { select: { id: true, title: true, description: true } },
  expert: { select: { id: true, firstname: true, lastname: true, email: true } },
  student: { select: { id: true, firstname: true, lastname: true, email: true } },
  comments: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, firstname: true, lastname: true } } },
  },
} satisfies Prisma.TaskInclude;

type TaskDetailPayload = Prisma.TaskGetPayload<{ include: typeof taskDetailInclude }>;

@Injectable()
export class TaskRepository extends BaseRepository {
  private toBaseEntity(task: Task): TaskBaseEntity {
    return new TaskBaseEntity({
      id: task.id,
      title: task.title,
      description: task.description,
      type: task.type,
      status: task.status,
      deadline: task.deadline,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      fileUrl: task.fileUrl,
      textAnswer: task.textAnswer,
      testId: task.testId,
      expertId: task.expertId,
      studentId: task.studentId,
      testAttemptId: task.testAttemptId,
    });
  }

  private toDetailEntity(task: TaskDetailPayload): TaskEntity {
    return new TaskEntity({
      id: task.id,
      title: task.title,
      description: task.description,
      type: task.type,
      status: task.status,
      deadline: task.deadline,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      fileUrl: task.fileUrl,
      textAnswer: task.textAnswer,
      test: task.test ? new TaskTestEntity(task.test) : null,
      expert: new TaskUserEntity(task.expert),
      student: new TaskUserEntity(task.student),
      testAttemptId: task.testAttemptId,
      comments: task.comments.map(
        c =>
          new TaskCommentEntity({
            id: c.id,
            taskId: c.taskId,
            authorId: c.authorId,
            author: { id: c.author.id, firstname: c.author.firstname, lastname: c.author.lastname },
            body: c.body,
            createdAt: c.createdAt,
          }),
      ),
    });
  }

  async create(expertId: number, dto: CreateTaskDto): Promise<TaskBaseEntity> {
    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type,
        deadline: new Date(dto.deadline),
        expertId,
        studentId: dto.studentId,
        testId: dto.testId ?? null,
      },
    });
    return this.toBaseEntity(task);
  }

  async findDetailByIdForExpert(id: number, expertId: number): Promise<TaskEntity | null> {
    const task = await this.prisma.task.findFirst({
      where: { id, expertId, deletedAt: null },
      include: taskDetailInclude,
    });
    return task ? this.toDetailEntity(task) : null;
  }

  async findDetailByIdForStudent(id: number, studentId: number): Promise<TaskEntity | null> {
    const task = await this.prisma.task.findFirst({
      where: { id, studentId, deletedAt: null },
      include: taskDetailInclude,
    });
    return task ? this.toDetailEntity(task) : null;
  }

  private async paginate(where: Prisma.TaskWhereInput, query: QueryTasksDto, withStudent: boolean): Promise<PaginatedResponseDto<TaskListItemEntity>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [totalItems, rows] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { student: { select: { id: true, firstname: true, lastname: true } } },
      }),
    ]);

    const data = rows.map(
      row =>
        new TaskListItemEntity({
          id: row.id,
          title: row.title,
          description: row.description,
          type: row.type,
          status: row.status,
          deadline: row.deadline,
          completedAt: row.completedAt,
          createdAt: row.createdAt,
          student: withStudent ? row.student : undefined,
        }),
    );

    return {
      data,
      meta: { page, limit, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / limit)) },
    };
  }

  async findAllByExpert(expertId: number, query: QueryTasksDto): Promise<PaginatedResponseDto<TaskListItemEntity>> {
    const where: Prisma.TaskWhereInput = { expertId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.studentId) where.studentId = query.studentId;
    return this.paginate(where, query, true);
  }

  async findAllByStudent(studentId: number, query: QueryTasksDto): Promise<PaginatedResponseDto<TaskListItemEntity>> {
    const where: Prisma.TaskWhereInput = { studentId, deletedAt: null };
    if (query.status) where.status = query.status;
    return this.paginate(where, query, false);
  }

  async updateById(id: number, data: UpdateTaskDto): Promise<TaskBaseEntity> {
    const task = await this.prisma.task.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.deadline !== undefined && { deadline: new Date(data.deadline) }),
      },
    });
    return this.toBaseEntity(task);
  }

  async softDeleteById(id: number): Promise<void> {
    await this.prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async setFileUrl(id: number, fileUrl: string): Promise<TaskBaseEntity> {
    const task = await this.prisma.task.update({
      where: { id },
      data: { fileUrl, status: TaskStatus.COMPLETED, completedAt: new Date() },
    });
    return this.toBaseEntity(task);
  }

  async setTextAnswer(id: number, textAnswer: string): Promise<TaskBaseEntity> {
    const task = await this.prisma.task.update({
      where: { id },
      data: { textAnswer, status: TaskStatus.COMPLETED, completedAt: new Date() },
    });
    return this.toBaseEntity(task);
  }

  async linkAttempt(id: number, attemptId: string): Promise<TaskBaseEntity> {
    const task = await this.prisma.task.update({
      where: { id },
      data: { testAttemptId: attemptId, status: TaskStatus.IN_PROGRESS },
    });
    return this.toBaseEntity(task);
  }

  async markCompleted(id: number): Promise<TaskBaseEntity> {
    const task = await this.prisma.task.update({
      where: { id },
      data: { status: TaskStatus.COMPLETED, completedAt: new Date() },
    });
    return this.toBaseEntity(task);
  }
}
