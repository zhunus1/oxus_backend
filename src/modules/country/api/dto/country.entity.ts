export class CountryEntity {
  id: number;
  isoCode: string;
  nameEn: string | null;
  nameRu: string | null;
  nameKk: string | null;
  createdAt: Date;

  constructor(partial: Partial<CountryEntity>) {
    Object.assign(this, partial);
  }
}
