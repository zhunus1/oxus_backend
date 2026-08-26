export class TaskCommentAuthorEntity {
  id: number;
  firstname: string;
  lastname: string;

  constructor(partial: Partial<TaskCommentAuthorEntity>) {
    Object.assign(this, partial);
  }
}

export class TaskCommentEntity {
  id: number;
  taskId: number;
  authorId: number;
  author?: TaskCommentAuthorEntity;
  body: string;
  createdAt: Date;

  constructor(partial: Partial<TaskCommentEntity>) {
    Object.assign(this, partial);
  }
}
