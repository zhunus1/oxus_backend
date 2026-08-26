import { Injectable } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { BaseRepository } from "src/database/prisma.repository";
import { ProgramDetailEntity, ProgramEntity } from "../api/dto/program.entity";
import { QueryProgramDto } from "../api/dto/query-program.dto";
import { CreateProgramDto } from "../api/dto/create-program.dto";
import { UpdateProgramDto } from "../api/dto/update-program.dto";

@Injectable()
export class ProgramRepository extends BaseRepository {
  async findAll(dto: QueryProgramDto): Promise<ProgramEntity[]> {
    const where: Prisma.ProgramWhereInput = {};

    if (dto.degreeLevel) where.degreeLevel = dto.degreeLevel;
    if (dto.organisationId) where.organisationId = dto.organisationId;

    if (dto.maxTuitionFee !== undefined || dto.minTuitionFee !== undefined) {
      where.tuitionFee = {
        ...(dto.minTuitionFee !== undefined ? { gte: dto.minTuitionFee } : {}),
        ...(dto.maxTuitionFee !== undefined ? { lte: dto.maxTuitionFee } : {}),
      };
    }

    if (dto.deadlineAfter || dto.deadlineBefore) {
      where.applicationDeadline = {
        ...(dto.deadlineAfter ? { gte: new Date(dto.deadlineAfter) } : {}),
        ...(dto.deadlineBefore ? { lte: new Date(dto.deadlineBefore) } : {}),
      };
    }

    if (dto.query) {
      where.name = { contains: dto.query, mode: "insensitive" };
    }

    const programs = await this.prisma.program.findMany({
      where,
      include: { organisation: { include: { country: true } } },
      orderBy: { createdAt: "desc" },
    });

    return programs.map(p => new ProgramEntity(p));
  }

  async findById(id: number): Promise<ProgramDetailEntity | null> {
    const program = await this.prisma.program.findFirst({
      where: { id },
      include: {
        organisation: { include: { country: true } },
        requirements: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
    });

    return program ? new ProgramDetailEntity(program) : null;
  }

  async updateDeadline(id: number, applicationDeadline: Date) {
    return this.prisma.program.update({
      where: { id },
      data: {
        applicationDeadline,
      },
      include: {
        organisation: { include: { country: true } },
        requirements: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
    });
  }

  async create(data: CreateProgramDto): Promise<ProgramEntity> {
    const program = await this.prisma.program.create({
      data: {
        organisationId: data.organisationId,
        name: data.name,
        degreeLevel: data.degreeLevel,
        tuitionFee: data.tuitionFee ?? null,
        minGPA: data.minGPA ?? null,
        minIELTS: data.minIELTS ?? null,
        applicationDeadline: data.applicationDeadline ? new Date(data.applicationDeadline) : null,
        baseAcceptanceRate: data.baseAcceptanceRate ?? null,
      },
      include: { organisation: { include: { country: true } } },
    });
    return new ProgramEntity(program);
  }

  async updateById(id: number, data: UpdateProgramDto): Promise<ProgramDetailEntity> {
    const program = await this.prisma.program.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.degreeLevel !== undefined && { degreeLevel: data.degreeLevel }),
        ...(data.tuitionFee !== undefined && { tuitionFee: data.tuitionFee }),
        ...(data.minGPA !== undefined && { minGPA: data.minGPA }),
        ...(data.minIELTS !== undefined && { minIELTS: data.minIELTS }),
        ...(data.applicationDeadline !== undefined && {
          applicationDeadline: data.applicationDeadline ? new Date(data.applicationDeadline) : null,
        }),
        ...(data.baseAcceptanceRate !== undefined && { baseAcceptanceRate: data.baseAcceptanceRate }),
      },
      include: {
        organisation: { include: { country: true } },
        requirements: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });
    return new ProgramDetailEntity(program);
  }

  async deleteById(id: number): Promise<ProgramEntity> {
    const program = await this.prisma.program.delete({
      where: { id },
      include: { organisation: { include: { country: true } } },
    });
    return new ProgramEntity(program);
  }
}
