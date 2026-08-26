import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { CreateCommentDto } from "../api/dto/create-comment.dto";
import { TaskCommentEntity } from "../api/dto/task-comment.entity";

@Injectable()
export class TaskCommentRepository extends BaseRepository {
  async create(taskId: number, authorId: number, dto: CreateCommentDto): Promise<TaskCommentEntity> {
    const comment = await this.prisma.taskComment.create({
      data: { taskId, authorId, body: dto.body },
      include: { author: { select: { id: true, firstname: true, lastname: true } } },
    });
    return new TaskCommentEntity({
      id: comment.id,
      taskId: comment.taskId,
      authorId: comment.authorId,
      author: { id: comment.author.id, firstname: comment.author.firstname, lastname: comment.author.lastname },
      body: comment.body,
      createdAt: comment.createdAt,
    });
  }
}
