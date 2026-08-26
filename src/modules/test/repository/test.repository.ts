import { Injectable } from "@nestjs/common";
import { CreateTestDto } from "../api/dto/create-test.dto";
import { UpdateTestDto } from "../api/dto/update-test.dto";
import { BaseRepository } from "src/database/prisma.repository";
import { QueryTestDto } from "../api/dto/query-test.dto";
import { TestEntity } from "../api/dto/test.entity";

@Injectable()
export class TestRepository extends BaseRepository {
  async create(data: CreateTestDto): Promise<TestEntity> {
    const test = await this.prisma.test.create({
      data: {
        title: data.title,
        description: data.description,
        isActive: data.isActive,
      },
    });
    return new TestEntity(test);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async findAll(_: QueryTestDto): Promise<TestEntity[]> {
    const tests = await this.prisma.test.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return tests.map(test => new TestEntity(test));
  }

  async findOneById(id: number): Promise<TestEntity | null> {
    const test = await this.prisma.test.findUnique({
      where: { id, deletedAt: null },
      include: { segments: { orderBy: { createdAt: "asc" } } },
    });
    return test ? new TestEntity(test) : null;
  }

  async updateById(id: number, data: UpdateTestDto): Promise<TestEntity> {
    const test = await this.prisma.test.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        isActive: data.isActive,
      },
    });
    return new TestEntity(test);
  }

  async deleteById(id: number): Promise<TestEntity> {
    const test = await this.prisma.test.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return new TestEntity(test);
  }
}
