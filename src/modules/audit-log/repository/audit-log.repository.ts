import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { Prisma } from "generated/prisma/client";
import { PUBLIC_AUDIT_SELECT, publicAuditActions, toPublicAudit } from "src/common/serialization/public-audit";

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
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType, entityId, action: { in: publicAuditActions(entityType) } },
      orderBy: { createdAt: "desc" },
      select: PUBLIC_AUDIT_SELECT,
    });
    return rows.flatMap(row => {
      const publicRow = toPublicAudit(row);
      return publicRow ? [publicRow] : [];
    });
  }
}
