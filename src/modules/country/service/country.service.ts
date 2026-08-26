import { Injectable, NotFoundException, InternalServerErrorException, Logger } from "@nestjs/common";
import { CountryRepository } from "../repository/country.repository";
import { CountryEntity } from "../api/dto/country.entity";
import messages from "src/configs/messages";

@Injectable()
export class CountryService {
  private readonly logger = new Logger(CountryService.name);

  constructor(private readonly repo: CountryRepository) {}

  async findAll(): Promise<CountryEntity[]> {
    try {
      return await this.repo.findMany();
    } catch (err) {
      this.logger.error(messages.DATABASE_FETCH_ERROR("Countries"), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("Countries"));
    }
  }

  async findOneById(id: number): Promise<CountryEntity> {
    try {
      const country = await this.repo.findOneById(id);
      if (!country) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID("Country", id));
      }
      return country;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID("Country", id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID("Country", id));
    }
  }
}
