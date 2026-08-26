import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { CreateProgramRequirementDto } from "../api/dto/create-program-requirement.dto";
import { UpdateProgramRequirementDto } from "../api/dto/update-program-requirement.dto";

@Injectable()
export class ProgramRequirementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByProgramId(programId: number) {
    return this.prisma.programRequirement.findMany({
      where: { programId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
  }

  async findById(id: number) {
    return this.prisma.programRequirement.findUnique({
      where: { id },
    });
  }

  async create(programId: number, dto: CreateProgramRequirementDto) {
    return this.prisma.programRequirement.create({
      data: {
        programId,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        isRequired: dto.isRequired,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async update(id: number, dto: UpdateProgramRequirementDto) {
    return this.prisma.programRequirement.update({
      where: { id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isRequired !== undefined ? { isRequired: dto.isRequired } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  async delete(id: number) {
    return this.prisma.programRequirement.delete({
      where: { id },
    });
  }

  async findTargetProgramWithProgram(targetProgramId: number) {
    return this.prisma.targetProgram.findUnique({
      where: { id: targetProgramId },
      include: {
        program: true,
        studentPortrait: {
          select: {
            id: true,
            userId: true,
          },
        },
      },
    });
  }

  async findDocumentsForTargetProgram(targetProgramId: number) {
    return this.prisma.document.findMany({
      where: { targetProgramId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
  }
}
