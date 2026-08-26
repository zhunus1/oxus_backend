import { Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { PromocodeRepository } from "../repository/promocode.repository";
import { CreatePromocodeDto } from "../api/dto/create-promocode.dto";
import messages from "src/configs/messages";
import { UpdatePromocodeDto } from "../api/dto/update-promocode.dto";
import { QueryPromocodeDto } from "../api/dto/query-promocode.dto";

@Injectable()
export class PromocodeService {
  private readonly logger = new Logger(PromocodeService.name);
  private readonly entityName = "PromoCode";

  constructor(private readonly promocodeRepository: PromocodeRepository) {}

  async create(createPromocodeDto: CreatePromocodeDto) {
    try {
      return await this.promocodeRepository.create(createPromocodeDto);
    } catch (error) {
      this.logger.error(`Error creating promocode: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  async updateById(id: number, updatePromocodeDto: UpdatePromocodeDto) {
    try {
      const existPromocode = await this.promocodeRepository.findById(id);
      if (!existPromocode) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      return await this.promocodeRepository.updateById(id, updatePromocodeDto);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error updating promocode: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, id));
    }
  }

  async findById(id: number) {
    try {
      const promocode = await this.promocodeRepository.findById(id);
      if (!promocode) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      return promocode;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching promocode by id: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entityName, id));
    }
  }

  async findByCode(code: string) {
    try {
      const promocode = await this.promocodeRepository.findByCode(code);
      if (!promocode) {
        throw new NotFoundException(messages.NOT_FOUND_BY_FIELD(this.entityName, code));
      }
      return promocode;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching promocode by code: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findAll(queryPromocodeDto: QueryPromocodeDto) {
    try {
      return await this.promocodeRepository.findAll(queryPromocodeDto);
    } catch (error) {
      this.logger.error(`Error fetching promocodes: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }
}
