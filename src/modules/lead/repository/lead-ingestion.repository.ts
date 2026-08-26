import { Injectable } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { LeadSourceMapping } from "../domain/lead-source-adapter";
import { LEAD_ACTIVITY } from "../domain/lead.constants";

const ingestionLeadInclude = {
  originSource: true,
  submissions: { orderBy: { receivedAt: "desc" as const } },
} as const;

@Injectable()
export class LeadIngestionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findSourceByCode(code: string) {
    return this.prisma.leadSource.findUnique({ where: { code } });
  }

  findByExternalSubmission(sourceId: number, externalSubmissionId: string) {
    return this.prisma.leadSubmission.findUnique({
      where: { sourceId_externalSubmissionId: { sourceId, externalSubmissionId } },
      include: { lead: { include: ingestionLeadInclude } },
    });
  }

  createLeadWithSubmission(params: { sourceId: number; sourceCode: string; mapping: LeadSourceMapping; rawPayload: Prisma.InputJsonObject; createdByUserId?: number }) {
    const { sourceId, sourceCode, mapping, rawPayload, createdByUserId } = params;

    return this.prisma.$transaction(async tx => {
      return tx.lead.create({
        data: {
          ...mapping.normalized,
          originSourceId: sourceId,
          createdByUserId,
          submissions: {
            create: {
              sourceId,
              externalSubmissionId: mapping.externalSubmissionId,
              schemaVersion: mapping.schemaVersion,
              calculatorVersion: mapping.calculatorVersion,
              rawPayload,
              normalizedPayload: mapping.normalizedPayload,
              metrics: mapping.metrics,
              submittedAt: mapping.submittedAt,
            },
          },
          activities: {
            create: {
              actorUserId: createdByUserId,
              type: LEAD_ACTIVITY.CREATED,
              metadata: { source: sourceCode },
            },
          },
        },
        include: ingestionLeadInclude,
      });
    });
  }

  isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}
