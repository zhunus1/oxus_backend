export class ExpertScheduleEntity {
  id: number;
  expertId: number;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<ExpertScheduleEntity>) {
    Object.assign(this, partial);
  }
}
