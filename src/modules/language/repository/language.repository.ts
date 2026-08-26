import { Injectable } from "@nestjs/common";
import { LanguageEntity } from "../api/dto/language.entity";
import { BaseRepository } from "src/database/prisma.repository";

@Injectable()
export class LanguageRepository extends BaseRepository {
  async findMany(): Promise<LanguageEntity[]> {
    const languages = await this.prisma.language.findMany({
      orderBy: { id: "asc" },
    });
    return languages.map(language => new LanguageEntity(language));
  }

  async findOneById(id: number): Promise<LanguageEntity | null> {
    const language = await this.prisma.language.findUnique({ where: { id } });
    return language ? new LanguageEntity(language) : null;
  }
}
