import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service";
import { RoleModel } from "./role.model";

@Injectable()
export class RoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { name: string; code: string; description?: string | null; permissionIds?: number[] }): Promise<RoleModel> {
    return this.prisma.role.create({
      data: {
        name: data.name,
        code: data.code,
        description: data.description,
        permissions: data.permissionIds?.length ? { connect: data.permissionIds.map(id => ({ id })) } : undefined,
      },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        permissions: { select: { id: true, name: true, code: true, description: true } },
      },
    });
  }

  async findAll(): Promise<RoleModel[]> {
    return this.prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        permissions: { select: { id: true, name: true, code: true, description: true } },
      },
    });
  }

  async findOne(id: number): Promise<RoleModel | null> {
    return this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        permissions: { select: { id: true, name: true, code: true, description: true } },
      },
    });
  }

  async update(id: number, data: { name?: string; code?: string; description?: string | null; permissionIds?: number[] }): Promise<RoleModel> {
    return this.prisma.role.update({
      where: { id },
      data: {
        name: data.name,
        code: data.code,
        description: data.description,
        ...(data.permissionIds ? { permissions: { set: data.permissionIds.map(pid => ({ id: pid })) } } : {}),
      },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        permissions: { select: { id: true, name: true, code: true, description: true } },
      },
    });
  }

  async softDeleteMany(ids: number[]) {
    return this.prisma.role.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
