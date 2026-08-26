export class AvailableSlotEntity {
  startTime: Date;
  endTime: Date;
  expertId: number;

  constructor(partial: Partial<AvailableSlotEntity>) {
    Object.assign(this, partial);
  }
}
