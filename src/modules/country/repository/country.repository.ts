import { Injectable } from "@nestjs/common";
import { CountryEntity } from "../api/dto/country.entity";
import { BaseRepository } from "src/database/prisma.repository";

@Injectable()
export class CountryRepository extends BaseRepository {
  async findMany(): Promise<CountryEntity[]> {
    const countries = await this.prisma.country.findMany({
      orderBy: { id: "asc" },
    });
    return countries.map(country => new CountryEntity(country));
  }

  async findOneById(id: number): Promise<CountryEntity | null> {
    const country = await this.prisma.country.findUnique({ where: { id } });
    return country ? new CountryEntity(country) : null;
  }
}
