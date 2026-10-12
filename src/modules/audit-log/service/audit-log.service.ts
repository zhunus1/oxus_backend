import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { AuditLogRepository } from "../repository/audit-log.repository";
import { Prisma } from "generated/prisma/client";
import messages from "src/configs/messages";

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly repo: AuditLogRepository) {}

  async log(userId: number, action: string, entityType: string, entityId: number, details?: Prisma.InputJsonValue, tx?: Prisma.TransactionClient) {
    try {
      if (tx) return await tx.auditLog.create({ data: { userId, action, entityType, entityId, details } });
      return await this.repo.create({ userId, action, entityType, entityId, details });
    } catch (error) {
      if (tx && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw error;
      this.logger.error(`Error creating audit log: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("AuditLog"));
    }
  }

  async findByEntity(entityType: string, entityId: number) {
    try {
      return await this.repo.findByEntity(entityType, entityId);
    } catch (error) {
      this.logger.error(`Error fetching audit logs: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("AuditLog"));
    }
  }
}
