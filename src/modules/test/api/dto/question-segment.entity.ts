export class QuestionSegmentEntity {
  id: number;
  testId: number;
  title: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<QuestionSegmentEntity>) {
    Object.assign(this, partial);
  }
}
