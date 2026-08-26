import { TaskStatus, TaskType } from "generated/prisma/enums";
import { TaskCommentEntity } from "./task-comment.entity";

export class TaskUserEntity {
  id: number;
  firstname: string;
  lastname: string;
  email?: string;

  constructor(partial: Partial<TaskUserEntity>) {
    Object.assign(this, partial);
  }
}

export class TaskTestEntity {
  id: number;
  title: string;
  description: string | null;

  constructor(partial: Partial<TaskTestEntity>) {
    Object.assign(this, partial);
  }
}

/** Full task detail used by both the student task page and the expert review view. */
export class TaskEntity {
  id: number;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  deadline: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  fileUrl: string | null;
  textAnswer: string | null;

  test: TaskTestEntity | null;
  testAttemptId: string | null;

  expert?: TaskUserEntity;
  student?: TaskUserEntity;

  comments: TaskCommentEntity[];

  constructor(partial: Partial<TaskEntity>) {
    Object.assign(this, partial);
  }
}
