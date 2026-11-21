import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service";
import { RoleModel } from "./role.model";
import { WazzupAccessService } from "src/modules/wazzup/wazzup-access.service";
import { LEAD_PERMISSION } from "src/modules/lead/domain/lead.constants";

@Injectable()
export class RoleRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wazzupAccess: WazzupAccessService,
  ) {}

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
    const { role, affected } = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Role" WHERE "id" = ${id} FOR UPDATE`;
      const previous = await tx.role.findUniqueOrThrow({ where: { id }, include: { permissions: { where: { deletedAt: null } } } });
      const affected = await this.wazzupAccess.revocableUsers(tx, { roleId: id });
      const role = await tx.role.update({
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
      const policy = (code: string, permissions: { code: string }[]) =>
        code === "ADMIN" ? "ADMIN" : code === "SALES_MANAGER" && permissions.some(p => p.code === LEAD_PERMISSION.MANAGE_OWN) ? "SALES_MANAGER" : null;
      const current = await tx.role.findUniqueOrThrow({ where: { id }, include: { permissions: { where: { deletedAt: null } } } });
      if (policy(previous.code, previous.permissions) !== policy(current.code, current.permissions)) await this.wazzupAccess.invalidateUsers(tx, affected);
      return { role, affected };
    });
    await this.wazzupAccess.synchronizeUsers(affected);
    return role;
  }

  async softDeleteMany(ids: number[]) {
    const { result, affected } = await this.prisma.$transaction(async tx => {
      const affected = await this.wazzupAccess.revocableUsers(tx, { roleId: { in: ids } });
      const result = await tx.role.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } });
      await this.wazzupAccess.invalidateUsers(tx, affected);
      return { result, affected };
    });
    await this.wazzupAccess.synchronizeUsers(affected);
    return result;
  }
}
