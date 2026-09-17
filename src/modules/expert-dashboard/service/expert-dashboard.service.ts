import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { ExpertDashboardRepository } from "../repository/expert-dashboard.repository";
import { AuditLogService } from "src/modules/audit-log/service/audit-log.service";
import { KanbanQueryDto } from "../api/dto/kanban-query.dto";
import { StaleCommentDto } from "../api/dto/stale-comment.dto";
import { ExpertStudentsQueryDto } from "../api/dto/expert-students-query.dto";
import { ProcessStep } from "generated/prisma/client";
import messages from "src/configs/messages";

@Injectable()
export class ExpertDashboardService {
  private readonly logger = new Logger(ExpertDashboardService.name);

  constructor(
    private readonly repo: ExpertDashboardRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  private convertDeadlineToLocal(deadline: Date | null, timezone: string): string | null {
    if (!deadline) return null;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(deadline);
  }

  private async getConsultantProfile(userId: number) {
    const profile = await this.repo.findConsultantProfileByUserId(userId);
    if (!profile) {
      throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
    }
    return profile;
  }

  private paginateExpertStudents(totalItems: number, page: number, limit: number) {
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    };
  }

  private mapPortraitListItem(portrait: {
    id: number;
    userId: number;
    overallProgress: number;
    currentStep: ProcessStep;
    subscription: string;
    educationLevel: string;
    major: string | null;
    gpa: number | null;
    hasVisa: boolean;
    updatedAt: Date;
    user: {
      id: number;
      firstname: string;
      lastname: string;
      middlename: string | null;
      email: string;
      phoneNumber: string | null;
      createdAt: Date;
    };
    targetCountries: {
      country: { isoCode: string; nameEn: string | null; nameRu: string | null };
    }[];
  }) {
    return {
      portraitId: portrait.id,
      userId: portrait.user.id,
      firstname: portrait.user.firstname,
      lastname: portrait.user.lastname,
      middlename: portrait.user.middlename,
      email: portrait.user.email,
      phoneNumber: portrait.user.phoneNumber,
      registeredAt: portrait.user.createdAt.toISOString(),
      portraitUpdatedAt: portrait.updatedAt.toISOString(),
      overallProgress: portrait.overallProgress,
      currentStep: portrait.currentStep,
      subscription: portrait.subscription,
      educationLevel: portrait.educationLevel,
      major: portrait.major,
      gpa: portrait.gpa,
      hasVisa: portrait.hasVisa,
      targetCountries: portrait.targetCountries.map(t => ({
        isoCode: t.country.isoCode,
        nameEn: t.country.nameEn,
        nameRu: t.country.nameRu,
      })),
    };
  }

  async listAssignedStudents(userId: number, query: ExpertStudentsQueryDto) {
    try {
      const profile = await this.repo.findConsultantProfileByUserId(userId);
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;

      if (!profile) {
        return { data: [], meta: this.paginateExpertStudents(0, page, limit) };
      }

      const where = this.repo.portraitWhereAssigned(profile.id, query);
      const [totalItems, rows] = await Promise.all([this.repo.countExpertStudentPortraits(where), this.repo.findExpertStudentPortraits(where, (page - 1) * limit, limit)]);

      return {
        data: rows.map(row => this.mapPortraitListItem(row)),
        meta: this.paginateExpertStudents(totalItems, page, limit),
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error listing assigned students: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("ExpertDashboard"));
    }
  }

  async listAvailableStudents(query: ExpertStudentsQueryDto) {
    try {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const where = this.repo.portraitWhereAvailable(query);
      const [totalItems, rows] = await Promise.all([this.repo.countExpertStudentPortraits(where), this.repo.findExpertStudentPortraits(where, (page - 1) * limit, limit)]);

      return {
        data: rows.map(row => this.mapPortraitListItem(row)),
        meta: this.paginateExpertStudents(totalItems, page, limit),
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error listing available students: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("ExpertDashboard"));
    }
  }

  async assignStudentPortrait(userId: number, portraitId: number) {
    try {
      const profile = await this.getConsultantProfile(userId);

      const portrait = await this.repo.findExpertListPortrait(portraitId);
      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND_BY_FIELD("StudentPortrait", `id=${portraitId}`));
      }

      const updatedRows = await this.repo.assignPortraitToExpert(portraitId, profile.id);
      if (updatedRows === 0) {
        const current = await this.repo.findExpertListPortrait(portraitId);
        if (current?.consultantProfileId != null && current.consultantProfileId !== profile.id) {
          throw new ConflictException("This student has already been assigned to another expert");
        }
        if (current?.consultantProfileId === profile.id) {
          return this.mapPortraitListItem(current);
        }
        throw new ConflictException("This student is no longer available for assignment");
      }

      const fresh = await this.repo.findExpertListPortrait(portraitId);
      if (!fresh) throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("StudentPortrait"));

      await this.auditLogService.log(userId, "EXPERT_ASSIGN_STUDENT", "StudentPortrait", portraitId, {
        consultantProfileId: profile.id,
      });

      return this.mapPortraitListItem(fresh);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error assigning portrait ${portraitId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR("StudentPortrait", portraitId));
    }
  }

  async transferStudentPortrait(actorUserId: number, portraitId: number, newExpertUserId: number) {
    try {
      if (newExpertUserId === actorUserId) {
        throw new BadRequestException("Cannot transfer a student to yourself");
      }

      const actorProfile = await this.getConsultantProfile(actorUserId);

      const portrait = await this.repo.findPortraitOwnership(portraitId);
      if (!portrait || portrait.consultantProfileId == null) {
        throw new NotFoundException(messages.NOT_FOUND_BY_FIELD("StudentPortrait", `id=${portraitId}`));
      }
      if (portrait.consultantProfileId !== actorProfile.id) {
        throw new ForbiddenException(messages.FORBIDDEN_ACTION);
      }

      const targetExpert = await this.repo.findConsultantProfileForExpertUser(newExpertUserId);
      if (!targetExpert) {
        throw new NotFoundException(messages.NOT_FOUND_BY_FIELD("Expert user", String(newExpertUserId)));
      }

      const updatedRows = await this.repo.transferPortraitConsultant(portraitId, actorProfile.id, targetExpert.id);
      if (updatedRows === 0) {
        throw new ConflictException("Student portrait could not be transferred (possibly reassigned concurrently)");
      }

      await this.auditLogService.log(actorUserId, "EXPERT_TRANSFER_STUDENT", "StudentPortrait", portraitId, {
        studentUserId: portrait.userId,
        fromConsultantProfileId: actorProfile.id,
        toConsultantProfileId: targetExpert.id,
        toExpertUserId: newExpertUserId,
        toExpertName: `${targetExpert.user.firstname} ${targetExpert.user.lastname}`,
      });

      return {
        portraitId,
        assignedToUserId: targetExpert.userId,
        assignedToConsultantProfileId: targetExpert.id,
        expertFirstname: targetExpert.user.firstname,
        expertLastname: targetExpert.user.lastname,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof ConflictException) throw error;
      this.logger.error(`Error transferring portrait ${portraitId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR("StudentPortrait", portraitId));
    }
  }

  async getKanban(userId: number, query: KanbanQueryDto) {
    try {
      const profile = await this.getConsultantProfile(userId);
      const expertTimezone = profile.user.timezone;

      const students = await this.repo.findAssignedStudents(profile.id, query);

      // Group by currentStep
      const grouped: Record<string, any[]> = {};
      for (const step of Object.values(ProcessStep)) {
        grouped[step] = [];
      }

      for (const student of students) {
        const nearestDeadline = student.targetPrograms.find(tp => tp.deadline)?.deadline ?? null;

        grouped[student.currentStep].push({
          ...student,
          nearestDeadlineUtc: nearestDeadline,
          nearestDeadlineLocal: this.convertDeadlineToLocal(nearestDeadline, expertTimezone),
          targetPrograms: student.targetPrograms.map(tp => ({
            ...tp,
            deadlineUtc: tp.deadline,
            deadlineLocal: this.convertDeadlineToLocal(tp.deadline, expertTimezone),
          })),
        });
      }

      // Sort each group by nearest deadline
      for (const step of Object.keys(grouped)) {
        grouped[step].sort((a: any, b: any) => {
          if (!a.nearestDeadlineUtc && !b.nearestDeadlineUtc) return 0;
          if (!a.nearestDeadlineUtc) return 1;
          if (!b.nearestDeadlineUtc) return -1;
          return new Date(a.nearestDeadlineUtc).getTime() - new Date(b.nearestDeadlineUtc).getTime();
        });
      }

      return grouped;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching kanban: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("ExpertDashboard"));
    }
  }

  async getStaleStudents(userId: number) {
    try {
      const profile = await this.getConsultantProfile(userId);
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - 10);

      return await this.repo.findStaleStudents(profile.id, thresholdDate);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching stale students: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("ExpertDashboard"));
    }
  }

  async addStaleComment(userId: number, portraitId: number, dto: StaleCommentDto) {
    try {
      const profile = await this.getConsultantProfile(userId);

      // Validate portrait belongs to this expert
      const students = await this.repo.findAssignedStudents(profile.id, {});
      const student = students.find(s => s.id === portraitId);
      if (!student) {
        throw new ForbiddenException(messages.FORBIDDEN_ACTION);
      }

      await this.auditLogService.log(userId, "STALE_COMMENT", "StudentPortrait", portraitId, {
        comment: dto.comment,
      });

      return { success: true };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error adding stale comment: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("AuditLog"));
    }
  }

  async getStudentTestAnswers(userId: number, studentId: number, testId: number) {
    try {
      const profile = await this.getConsultantProfile(userId);
      const student = await this.repo.findAssignedStudentById(profile.id, studentId);
      if (!student) {
        throw new ForbiddenException(messages.FORBIDDEN_ACTION);
      }

      const attempts = await this.repo.findAttemptsWithAnswersByTestAndUser(testId, student.userId);
      if (attempts.length === 0) {
        throw new NotFoundException(messages.NOT_FOUND_BY_FIELD("Attempt", `studentId=${studentId}, testId=${testId}`));
      }

      return {
        studentId: student.id,
        testId,
        attempts: attempts.map(attempt => ({
          id: attempt.id,
          status: attempt.status,
          startedAt: attempt.startedAt,
          submittedAt: attempt.submittedAt,
          responses: attempt.responses.map(response => ({
            id: response.id,
            questionId: response.questionId,
            question: {
              id: response.question.id,
              order: response.question.order,
              text: response.question.text,
              type: response.question.type,
              required: response.question.required,
              options: response.question.options,
            },
            answer: {
              valueText: response.valueText,
              valueNum: response.valueNum,
              valueOptionId: response.valueOptionId,
              selectedOption: response.option,
            },
          })),
        })),
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error fetching student test answers: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("Student test answers"));
    }
  }
}
