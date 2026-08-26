import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service";
import { PermissionModel } from "./permission.model";

@Injectable()
export class PermissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly baseSelect = {
    id: true,
    name: true,
    code: true,
    description: true,
  } as const;

  async findAll(): Promise<PermissionModel[]> {
    return this.prisma.permission.findMany({
      where: { deletedAt: null },
      orderBy: { id: "asc" },
      select: this.baseSelect,
    });
  }

  async findOne(id: number): Promise<PermissionModel | null> {
    return this.prisma.permission.findFirst({
      where: { id, deletedAt: null },
      select: this.baseSelect,
    });
  }
}
