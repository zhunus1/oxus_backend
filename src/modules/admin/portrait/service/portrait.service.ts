import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import messages from "src/configs/messages";
import { PortraitRepository } from "../repository/portrait.repository";
import { AuditLogService } from "src/modules/audit-log/service/audit-log.service";
import { StudentPortraitQueryDto } from "../api/dto/student-portrait-query.dto";
import { UpdatePortraitKycLockDto } from "../api/dto/update-portrait-kyc-lock.dto";
import { UpdatePortraitSubscriptionDto } from "../api/dto/update-portrait-subscription.dto";
import { UpdateTargetProgramStatusDto } from "../api/dto/update-target-program-status.dto";
import { UpdatePortraitProcessStepDto } from "../api/dto/update-portrait-process-step.dto";
import { CreateTargetProgramDto } from "src/modules/target-program/api/dto/create-target-program.dto";
import { TargetProgramService } from "src/modules/target-program/service/target-program.service";

@Injectable()
export class PortraitService {
  private readonly logger = new Logger(PortraitService.name);
  private readonly entityName = "StudentPortrait";

  constructor(
    private readonly repo: PortraitRepository,
    private readonly auditLogService: AuditLogService,
    private readonly targetProgramService: TargetProgramService,
  ) {}

  /** Expert must be the assigned consultant; ADMIN may act on any portrait. */
  private async assertAssignedExpertOrAdmin(actorUserId: number, roleCode: string | undefined, portraitId: number): Promise<void> {
    if (roleCode?.toUpperCase() === "ADMIN") {
      return;
    }
    if (roleCode?.toUpperCase() !== "EXPERT") {
      throw new ForbiddenException(messages.FORBIDDEN_ACTION);
    }
    const assignedUserId = await this.repo.getAssignedExpertUserId(portraitId);
    if (assignedUserId !== actorUserId) {
      throw new ForbiddenException(messages.FORBIDDEN_ACTION);
    }
  }

  async findMany(query: StudentPortraitQueryDto) {
    try {
      return await this.repo.findMany(query);
    } catch (error) {
      this.logger.error(`Error fetching portraits: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findById(id: number) {
    try {
      const portrait = await this.repo.findById(id);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }

      return portrait;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching portrait by id ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entityName, id));
    }
  }

  async updateKycLock(id: number, dto: UpdatePortraitKycLockDto) {
    try {
      const portrait = await this.repo.findById(id);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }

      return await this.repo.updateKycLock(id, dto.isIdentityLocked);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error updating KYC lock for portrait ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, id));
    }
  }

  async updateSubscription(id: number, dto: UpdatePortraitSubscriptionDto, actorUserId: number) {
    try {
      const portrait = await this.repo.findById(id);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }

      const data: Prisma.StudentPortraitUpdateInput = {
        subscription: dto.subscription,
        consultationBalance: dto.consultationBalance,
      };

      const updatedPortrait = await this.repo.updateSubscription(id, data);

      await this.repo.createAuditLog(actorUserId, id, {
        fromSubscription: portrait.subscription,
        toSubscription: dto.subscription,
        fromConsultationBalance: portrait.consultationBalance,
        toConsultationBalance: dto.consultationBalance,
      });

      return updatedPortrait;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error updating subscription for portrait ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, id));
    }
  }

  // 360° full profile view
  async findFullProfile(actorUserId: number, roleCode: string | undefined, id: number) {
    try {
      const portrait = await this.repo.findFullProfile(id);
      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      await this.assertAssignedExpertOrAdmin(actorUserId, roleCode, id);
      return portrait;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error fetching full profile for portrait ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entityName, id));
    }
  }

  async createTargetProgramForPortrait(actorUserId: number, roleCode: string | undefined, portraitId: number, dto: CreateTargetProgramDto) {
    try {
      await this.assertAssignedExpertOrAdmin(actorUserId, roleCode, portraitId);
      const portrait = await this.repo.findById(portraitId);
      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, portraitId));
      }
      return await this.targetProgramService.create(portrait.userId, portraitId, dto);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error creating target program for portrait ${portraitId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("TargetProgram"));
    }
  }

  async updatePortraitProcessStep(actorUserId: number, roleCode: string | undefined, portraitId: number, dto: UpdatePortraitProcessStepDto) {
    try {
      await this.assertAssignedExpertOrAdmin(actorUserId, roleCode, portraitId);
      const portrait = await this.repo.findById(portraitId);
      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, portraitId));
      }

      const from = portrait.currentStep;
      const updated = await this.repo.updateCurrentStep(portraitId, dto.currentStep);

      await this.auditLogService.log(actorUserId, "PROCESS_STEP_CHANGE", "StudentPortrait", portraitId, {
        from,
        to: dto.currentStep,
      });

      return updated;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error updating process step for portrait ${portraitId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, portraitId));
    }
  }

  // Expert updates application status on a target program
  async updateTargetProgramStatus(expertUserId: number, roleCode: string | undefined, portraitId: number, tpId: number, dto: UpdateTargetProgramStatusDto) {
    try {
      await this.assertAssignedExpertOrAdmin(expertUserId, roleCode, portraitId);

      const tp = await this.repo.findTargetProgramById(tpId);
      if (!tp) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID("TargetProgram", tpId));
      }
      if (tp.studentPortraitId !== portraitId) {
        throw new ForbiddenException(messages.FORBIDDEN_ACTION);
      }

      const oldStatus = tp.applicationStatus;
      const updated = await this.repo.updateTargetProgramStatus(tpId, dto.applicationStatus);

      await this.auditLogService.log(expertUserId, "STATUS_CHANGE", "TargetProgram", tpId, {
        from: oldStatus,
        to: dto.applicationStatus,
        comment: dto.comment,
      });

      return updated;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error updating target program status ${tpId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR("TargetProgram", tpId));
    }
  }

  // Audit log for a student portrait
  async findAuditLogs(portraitId: number) {
    try {
      return await this.repo.findAuditLogs("StudentPortrait", portraitId);
    } catch (error) {
      this.logger.error(`Error fetching audit logs for portrait ${portraitId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("AuditLog"));
    }
  }
}
