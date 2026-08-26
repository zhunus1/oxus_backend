import { TaskStatus, TaskType } from "generated/prisma/enums";

/** Compact card shown on the student main page and in expert task lists. */
export class TaskListItemEntity {
  id: number;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  deadline: Date;
  completedAt: Date | null;
  createdAt: Date;

  /** Present only on the expert listing. */
  student?: {
    id: number;
    firstname: string;
    lastname: string;
  };

  constructor(partial: Partial<TaskListItemEntity>) {
    Object.assign(this, partial);
  }
}
