export class AttemptEntity {
  id: string;
  testId: number;
  userId?: number | null;
  submittedAt?: Date | null;

  constructor(partial: Partial<AttemptEntity>) {
    Object.assign(this, partial);
  }
}
