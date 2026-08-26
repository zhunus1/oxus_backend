import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { Prisma } from "generated/prisma/client";

@Injectable()
export class AuditLogRepository extends BaseRepository {
  async create(data: { userId: number; action: string; entityType: string; entityId: number; details?: Prisma.InputJsonValue }) {
    return this.prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        details: data.details ?? undefined,
      },
    });
  }

  async findByEntity(entityType: string, entityId: number) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, firstname: true, lastname: true } } },
    });
  }
}
