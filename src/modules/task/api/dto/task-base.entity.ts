import { TaskStatus, TaskType } from "generated/prisma/enums";

/** Scalar task fields only — returned by create/update/mutation methods (no relations loaded). */
export class TaskBaseEntity {
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

  testId: number | null;
  expertId: number;
  studentId: number;
  testAttemptId: string | null;

  constructor(partial: Partial<TaskBaseEntity>) {
    Object.assign(this, partial);
  }
}
