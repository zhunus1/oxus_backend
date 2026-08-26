import { BadRequestException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { TaskStatus, TaskType } from "generated/prisma/enums";
import messages from "src/configs/messages";
import { PaginatedResponseDto } from "src/common/dtos/pagination.dto";
import { UploadService } from "src/common/utils/minio/upload.service";
import { ExpertDashboardRepository } from "src/modules/expert-dashboard/repository/expert-dashboard.repository";
import { TestService } from "src/modules/test/service/test.service";
import { AttemptService } from "src/modules/attempt/service/attempt.service";
import { TaskRepository } from "../repository/task.repository";
import { TaskCommentRepository } from "../repository/task-comment.repository";
import { CreateTaskDto } from "../api/dto/create-task.dto";
import { UpdateTaskDto } from "../api/dto/update-task.dto";
import { QueryTasksDto } from "../api/dto/query-tasks.dto";
import { SubmitTextAnswerDto } from "../api/dto/submit-text-answer.dto";
import { CreateCommentDto } from "../api/dto/create-comment.dto";
import { TaskEntity } from "../api/dto/task.entity";
import { TaskBaseEntity } from "../api/dto/task-base.entity";
import { TaskListItemEntity } from "../api/dto/task-list-item.entity";
import { TaskCommentEntity } from "../api/dto/task-comment.entity";

@Injectable()
export class TaskService {
  private readonly entity = "Task";
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly repo: TaskRepository,
    private readonly commentRepo: TaskCommentRepository,
    private readonly expertDashboardRepo: ExpertDashboardRepository,
    private readonly testService: TestService,
    private readonly attemptService: AttemptService,
    private readonly uploadService: UploadService,
  ) {}

  /** Ensures the student is assigned to this expert, returns the StudentPortrait. */
  private async assertStudentAssignedToExpert(expertUserId: number, studentUserId: number) {
    const profile = await this.expertDashboardRepo.findConsultantProfileByUserId(expertUserId);
    if (!profile) {
      throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
    }
    const portrait = await this.expertDashboardRepo.findAssignedStudentPortraitByUserId(profile.id, studentUserId);
    if (!portrait) {
      throw new ForbiddenException(messages.FORBIDDEN_ACTION);
    }
  }

  // ---------- Expert ----------

  async create(expertUserId: number, dto: CreateTaskDto): Promise<TaskBaseEntity> {
    try {
      await this.assertStudentAssignedToExpert(expertUserId, dto.studentId);

      if (dto.type === TaskType.TEST) {
        if (dto.testId == null) {
          throw new BadRequestException(messages.REQUIRED_FIELD("testId"));
        }
        await this.testService.findById(dto.testId); // throws NotFoundException if missing
      }

      return await this.repo.create(expertUserId, dto);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async findAllForExpert(expertUserId: number, query: QueryTasksDto): Promise<PaginatedResponseDto<TaskListItemEntity>> {
    try {
      return await this.repo.findAllByExpert(expertUserId, query);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async findByIdForExpert(expertUserId: number, id: number): Promise<TaskEntity> {
    try {
      const task = await this.repo.findDetailByIdForExpert(id, expertUserId);
      if (!task) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      return task;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id));
    }
  }

  async updateById(expertUserId: number, id: number, dto: UpdateTaskDto): Promise<TaskBaseEntity> {
    try {
      const task = await this.repo.findDetailByIdForExpert(id, expertUserId);
      if (!task) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      if (task.status === TaskStatus.COMPLETED) {
        throw new BadRequestException("Completed task cannot be edited");
      }
      return await this.repo.updateById(id, dto);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async deleteById(expertUserId: number, id: number): Promise<{ success: true }> {
    try {
      const task = await this.repo.findDetailByIdForExpert(id, expertUserId);
      if (!task) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      await this.repo.softDeleteById(id);
      return { success: true };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_DELETE_ERROR(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR(this.entity, id));
    }
  }

  async addExpertComment(expertUserId: number, id: number, dto: CreateCommentDto): Promise<TaskCommentEntity> {
    try {
      const task = await this.repo.findDetailByIdForExpert(id, expertUserId);
      if (!task) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      return await this.commentRepo.create(id, expertUserId, dto);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_CREATE_ERROR("TaskComment"), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("TaskComment"));
    }
  }

  // ---------- Student ----------

  async findAllForStudent(studentUserId: number, query: QueryTasksDto): Promise<PaginatedResponseDto<TaskListItemEntity>> {
    try {
      return await this.repo.findAllByStudent(studentUserId, query);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async findByIdForStudent(studentUserId: number, id: number): Promise<TaskEntity> {
    try {
      const task = await this.repo.findDetailByIdForStudent(id, studentUserId);
      if (!task) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      return task;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id));
    }
  }

  /** Loads a student's task and validates it is still actionable and of the expected type. */
  private async getActionableStudentTask(studentUserId: number, id: number, expectedType: TaskType): Promise<TaskEntity> {
    const task = await this.repo.findDetailByIdForStudent(id, studentUserId);
    if (!task) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
    if (task.type !== expectedType) {
      throw new BadRequestException(`This task is of type ${task.type}, expected ${expectedType}`);
    }
    if (task.status === TaskStatus.COMPLETED) {
      throw new BadRequestException("Task is already completed");
    }
    return task;
  }

  async submitFile(studentUserId: number, id: number, file: Express.Multer.File): Promise<TaskBaseEntity> {
    try {
      await this.getActionableStudentTask(studentUserId, id, TaskType.FILE_UPLOAD);
      const fileUrl = await this.uploadService.uploadFile("tasks", file);
      return await this.repo.setFileUrl(id, fileUrl);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async submitText(studentUserId: number, id: number, dto: SubmitTextAnswerDto): Promise<TaskBaseEntity> {
    try {
      await this.getActionableStudentTask(studentUserId, id, TaskType.TEXT_ANSWER);
      return await this.repo.setTextAnswer(id, dto.textAnswer);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async startTestAttempt(studentUserId: number, id: number): Promise<TaskBaseEntity> {
    try {
      const task = await this.getActionableStudentTask(studentUserId, id, TaskType.TEST);
      if (!task.test) {
        throw new BadRequestException("This test task has no linked test");
      }
      if (task.testAttemptId) {
        throw new BadRequestException("A test attempt has already been started for this task");
      }
      const attempt = await this.attemptService.create(task.test.id, { userId: studentUserId });
      return await this.repo.linkAttempt(id, attempt.id);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async completeTest(studentUserId: number, id: number): Promise<TaskBaseEntity> {
    try {
      const task = await this.getActionableStudentTask(studentUserId, id, TaskType.TEST);
      if (!task.testAttemptId) {
        throw new BadRequestException("Start the test attempt before completing the task");
      }
      return await this.repo.markCompleted(id);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async addStudentComment(studentUserId: number, id: number, dto: CreateCommentDto): Promise<TaskCommentEntity> {
    try {
      const task = await this.repo.findDetailByIdForStudent(id, studentUserId);
      if (!task) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      return await this.commentRepo.create(id, studentUserId, dto);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_CREATE_ERROR("TaskComment"), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("TaskComment"));
    }
  }
}
