export class LanguageEntity {
  id: number;
  code: string;
  name: string;
  createdAt: Date;

  constructor(partial: Partial<LanguageEntity>) {
    Object.assign(this, partial);
  }
}
