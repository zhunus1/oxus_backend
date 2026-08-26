import { BaseRepository } from "src/database/prisma.repository";
import { AttemptEntity } from "../api/dto/attempt.entity";
import { CreateAttemptDto } from "../api/dto/create-attempt.dto";
import { UpdateAttemptDto } from "../api/dto/update-attempt.dto";
import { AttemptStatus } from "generated/prisma/enums";

export class AttemptRepository extends BaseRepository {
  async create(testId: number, data: CreateAttemptDto): Promise<AttemptEntity> {
    const attempt = await this.prisma.attempt.create({ data: { testId, ...data } });
    return new AttemptEntity(attempt);
  }

  async updateById(id: string, data: UpdateAttemptDto): Promise<AttemptEntity> {
    const attempt = await this.prisma.attempt.update({ where: { id }, data });
    return new AttemptEntity(attempt);
  }

  async submit(id: string): Promise<AttemptEntity> {
    const attempt = await this.prisma.attempt.update({
      where: { id },
      data: { status: AttemptStatus.SUBMITTED, submittedAt: new Date() },
    });
    return new AttemptEntity(attempt);
  }

  async findById(id: string): Promise<AttemptEntity | null> {
    const attempt = await this.prisma.attempt.findUnique({ where: { id } });
    return attempt ? new AttemptEntity(attempt) : null;
  }

  async findAll(testId: number): Promise<AttemptEntity[]> {
    const attempts = await this.prisma.attempt.findMany({
      where: { testId },
      orderBy: { createdAt: "desc" },
    });
    return attempts.map(attempt => new AttemptEntity(attempt));
  }
}
