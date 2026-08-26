import { Injectable, NotFoundException, InternalServerErrorException, Logger } from "@nestjs/common";
import { LanguageRepository } from "../repository/language.repository";
import { LanguageEntity } from "../api/dto/language.entity";
import messages from "src/configs/messages";

@Injectable()
export class LanguageService {
  private readonly logger = new Logger(LanguageService.name);

  constructor(private readonly repo: LanguageRepository) {}

  async findAll(): Promise<LanguageEntity[]> {
    try {
      return await this.repo.findMany();
    } catch (err) {
      this.logger.error(messages.DATABASE_FETCH_ERROR("Languages"), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("Languages"));
    }
  }

  async findOneById(id: number): Promise<LanguageEntity> {
    try {
      const language = await this.repo.findOneById(id);
      if (!language) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID("Language", id));
      }
      return language;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID("Language", id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID("Language", id));
    }
  }
}
