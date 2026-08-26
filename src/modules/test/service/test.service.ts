import { Injectable, Logger, NotFoundException, InternalServerErrorException, UnauthorizedException, BadRequestException } from "@nestjs/common";
import { TestRepository } from "../repository/test.repository";
import { CreateTestDto } from "../api/dto/create-test.dto";
import { UpdateTestDto } from "../api/dto/update-test.dto";
import messages from "src/configs/messages";
import { QueryTestDto } from "../api/dto/query-test.dto";
import { TestEntity } from "../api/dto/test.entity";

@Injectable()
export class TestService {
  private readonly entity = "Test";
  private readonly logger = new Logger(TestService.name);

  constructor(private readonly repo: TestRepository) {}

  async create(dto: CreateTestDto): Promise<TestEntity> {
    try {
      return await this.repo.create(dto);
    } catch (err) {
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async findAll(dto: QueryTestDto): Promise<TestEntity[]> {
    try {
      return await this.repo.findAll(dto);
    } catch (err) {
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async findById(id: number): Promise<TestEntity> {
    try {
      const test = await this.repo.findOneById(id);
      if (!test) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      }
      return test;
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async updateById(id: number, dto: UpdateTestDto): Promise<TestEntity> {
    try {
      await this.findById(id);
      return await this.repo.updateById(id, dto);
    } catch (err) {
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async deleteById(id: number): Promise<TestEntity> {
    try {
      const test = await this.findById(id);
      if (test.deletedAt) throw new BadRequestException(messages.ALREADY_DELETED(this.entity, id));
      return await this.repo.deleteById(id);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(messages.DATABASE_DELETE_ERROR(this.entity, id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR(this.entity, id));
    }
  }
}
