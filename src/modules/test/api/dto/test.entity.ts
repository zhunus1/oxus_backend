import { QuestionSegmentEntity } from "./question-segment.entity";

export class TestEntity {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  segments?: QuestionSegmentEntity[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;

  constructor(partial: Partial<TestEntity>) {
    Object.assign(this, partial);
  }
}
