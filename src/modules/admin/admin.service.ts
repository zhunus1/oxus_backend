import { LeadRealtimeGateway } from "../lead/realtime/lead-realtime.gateway";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EducationLevel, Prisma, ProcessStep } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import type { CrmStudentsQueryDto } from "./api/dto/crm-students-query.dto";
import type { UpdateCrmStudentStatusDto } from "./api/dto/update-crm-student-status.dto";
import { crmStatusToProcessStep, parseCrmStudentStatus, processStepToCrmStatus } from "./crm/crm-status.mapper";
import { ADMIN_USER_DETAIL_SELECT, ADMIN_USER_LIST_SELECT } from "./admin-user.select";
import type { AdminCreateUserDto } from "./api/dto/admin-create-user.dto";
import type { AdminPatchUserDto } from "./api/dto/admin-patch-user.dto";
import { FinanceService } from "./finance.service";
import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";
import * as bcrypt from "bcrypt";

const studentListSelect = {
  id: true,
  firstname: true,
  lastname: true,
  email: true,
  phoneNumber: true,
  createdAt: true,
  updatedAt: true,
  portrait: {
    select: {
      currentStep: true,
      overallProgress: true,
      gpa: true,
      educationLevel: true,
      updatedAt: true,
      targetCountries: {
        select: {
          country: {
            select: {
              id: true,
              isoCode: true,
              nameEn: true,
              nameRu: true,
              nameKk: true,
            },
          },
        },
      },
      assignedExpert: {
        select: {
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              email: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

export type StudentWithStatusRow = Prisma.UserGetPayload<{
  select: typeof studentListSelect;
}>;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userJourneyLog: UserJourneyLogService,
    private readonly financeService: FinanceService,
    private readonly leadRealtime: LeadRealtimeGateway,
  ) {}

  private mapToStudentWithStatus(user: StudentWithStatusRow) {
    const portrait = user.portrait;
    const step = portrait?.currentStep ?? ProcessStep.DISCOVERY;
    const currentStatus = processStepToCrmStatus(step, portrait);

    const lastActivity = this.maxDate(user.updatedAt, portrait?.updatedAt ?? null);

    return {
      id: user.id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phone: user.phoneNumber,
      createdAt: user.createdAt.toISOString(),
      portrait: portrait
        ? {
            gpa: portrait.gpa,
            educationLevel: portrait.educationLevel,
            targetCountries: portrait.targetCountries.map(t => ({
              id: t.country.id,
              isoCode: t.country.isoCode,
              nameEn: t.country.nameEn,
              nameRu: t.country.nameRu,
              nameKk: t.country.nameKk,
            })),
          }
        : null,
      currentStatus,
      assignedExpert: portrait?.assignedExpert?.user
        ? {
            id: portrait.assignedExpert.user.id,
            firstname: portrait.assignedExpert.user.firstname,
            lastname: portrait.assignedExpert.user.lastname,
            email: portrait.assignedExpert.user.email,
          }
        : null,
      lastActivity: lastActivity.toISOString(),
      overallProgress: portrait?.overallProgress ?? 0,
    };
  }

  private maxDate(...dates: (Date | null)[]): Date {
    const valid = dates.filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
    if (valid.length === 0) return new Date(0);
    return new Date(Math.max(...valid.map(d => d.getTime())));
  }

  async listCrmStudents(dto: CrmStudentsQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const andConditions: Prisma.UserWhereInput[] = [{ deletedAt: null }, { role: { code: "STUDENT" } }];

    if (dto.search?.trim()) {
      const q = dto.search.trim();
      andConditions.push({
        OR: [{ firstname: { contains: q, mode: "insensitive" } }, { lastname: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }],
      });
    }

    if (dto.country?.trim()) {
      andConditions.push({
        portrait: {
          targetCountries: {
            some: { country: { isoCode: dto.country.trim().toUpperCase() } },
          },
        },
      });
    }

    if (dto.educationLevel !== undefined) {
      andConditions.push({ portrait: { educationLevel: dto.educationLevel } });
    }

    if (dto.status?.trim()) {
      try {
        const s = parseCrmStudentStatus(dto.status.trim());
        if (s === "NEW_LEAD") {
          andConditions.push({
            OR: [{ portrait: null }, { portrait: { currentStep: ProcessStep.DISCOVERY } }],
          });
        } else if (s === "PAYMENT_RECEIVED") {
          andConditions.push({
            portrait: {
              currentStep: ProcessStep.ENROLLED,
              overallProgress: { lt: 100 },
            },
          });
        } else if (s === "COMPLETED") {
          andConditions.push({
            OR: [
              { portrait: { currentStep: ProcessStep.GAP_YEAR } },
              {
                portrait: {
                  currentStep: ProcessStep.ENROLLED,
                  overallProgress: { gte: 100 },
                },
              },
            ],
          });
        } else {
          const step = crmStatusToProcessStep(s);
          andConditions.push({ portrait: { currentStep: step } });
        }
      } catch {
        throw new BadRequestException(`Invalid status: ${dto.status}`);
      }
    }

    const where: Prisma.UserWhereInput = { AND: andConditions };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { id: "asc" },
        skip,
        take: limit,
        select: studentListSelect,
      }),
      this.prisma.user.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: users.map(u => this.mapToStudentWithStatus(u)),
      total,
      page,
      totalPages,
    };
  }

  async getCrmStudentById(userId: number) {
    const countrySelect = {
      id: true,
      isoCode: true,
      nameEn: true,
      nameRu: true,
      nameKk: true,
    } as const;

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        role: { code: "STUDENT" },
      },
      include: {
        country: { select: countrySelect },
        citizenship: { select: countrySelect },
        portrait: {
          include: {
            tests: true,
            targetCountries: { include: { country: true } },
            targetPrograms: {
              include: {
                organisation: { include: { country: true } },
                program: true,
              },
              orderBy: { updatedAt: "desc" },
            },
            documents: { orderBy: { updatedAt: "desc" } },
            assignedExpert: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    phoneNumber: true,
                  },
                },
              },
            },
            languages: { include: { language: true } },
          },
        },
        studentContracts: { orderBy: { createdAt: "desc" } },
        meetingsAsStudent: { orderBy: { createdAt: "desc" }, take: 30 },
      },
    });

    if (!user) {
      throw new NotFoundException(`Student with id ${userId} not found`);
    }

    const summary = this.mapToStudentWithStatus({
      id: user.id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phoneNumber: user.phoneNumber,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      portrait: user.portrait
        ? {
            currentStep: user.portrait.currentStep,
            overallProgress: user.portrait.overallProgress,
            gpa: user.portrait.gpa,
            educationLevel: user.portrait.educationLevel,
            updatedAt: user.portrait.updatedAt,
            targetCountries: user.portrait.targetCountries.map(t => ({
              country: {
                id: t.country.id,
                isoCode: t.country.isoCode,
                nameEn: t.country.nameEn,
                nameRu: t.country.nameRu,
                nameKk: t.country.nameKk,
              },
            })),
            assignedExpert: user.portrait.assignedExpert,
          }
        : null,
    });

    const mapCountry = (c: { id: number; isoCode: string; nameEn: string | null; nameRu: string | null; nameKk: string | null } | null) =>
      c
        ? {
            id: c.id,
            isoCode: c.isoCode,
            nameEn: c.nameEn,
            nameRu: c.nameRu,
            nameKk: c.nameKk,
          }
        : null;

    return {
      ...summary,
      residenceCountry: mapCountry(user.country),
      citizenshipCountry: mapCountry(user.citizenship),
      detail: {
        portrait: user.portrait
          ? {
              id: user.portrait.id,
              birthDate: user.portrait.birthDate?.toISOString() ?? null,
              educationLevel: user.portrait.educationLevel,
              major: user.portrait.major,
              gpa: user.portrait.gpa,
              gpaScale: user.portrait.gpaScale,
              budgetLimit: user.portrait.budgetLimit,
              budgetCurrency: user.portrait.budgetCurrency,
              hasVisa: user.portrait.hasVisa,
              overallProgress: user.portrait.overallProgress,
              subscription: user.portrait.subscription,
              tests: user.portrait.tests.map(t => ({
                id: t.id,
                testType: t.testType,
                totalScore: t.totalScore,
                reading: t.reading,
                listening: t.listening,
                writing: t.writing,
                speaking: t.speaking,
                testDate: t.testDate?.toISOString() ?? null,
              })),
              targetCountries: user.portrait.targetCountries.map(t => ({
                country: t.country,
              })),
              targetPrograms: user.portrait.targetPrograms.map(tp => ({
                id: tp.id,
                programTitle: tp.programTitle,
                deadline: tp.deadline?.toISOString() ?? null,
                intake: tp.intake,
                applicationStatus: tp.applicationStatus,
                organisation: tp.organisation
                  ? {
                      id: tp.organisation.id,
                      nameEn: tp.organisation.nameEn,
                      slug: tp.organisation.slug,
                      country: tp.organisation.country,
                    }
                  : null,
                program: tp.program,
              })),
              documents: user.portrait.documents.map(d => ({
                id: d.id,
                title: d.title,
                fileUrl: d.fileUrl,
                documentType: d.documentType,
                version: d.version,
                status: d.status,
                feedback: d.feedback,
                createdAt: d.createdAt.toISOString(),
                updatedAt: d.updatedAt.toISOString(),
              })),
              languages: user.portrait.languages.map(ul => ({
                id: ul.id,
                level: ul.level,
                language: ul.language,
              })),
            }
          : null,
        contracts: user.studentContracts.map(c => ({
          id: c.id,
          contractNumber: c.contractNumber,
          status: c.status,
          subscriptionTier: c.subscriptionTier,
          price: c.price,
          currency: c.currency,
          studentSignedAt: c.studentSignedAt?.toISOString() ?? null,
          expertSignedAt: c.expertSignedAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
        })),
        meetings: user.meetingsAsStudent.map(m => ({
          id: m.id,
          roomName: m.roomName,
          status: m.status,
          startTime: m.startTime?.toISOString() ?? null,
          endTime: m.endTime?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    };
  }

  async updateCrmStudentStatus(userId: number, dto: UpdateCrmStudentStatusDto) {
    let parsed: ReturnType<typeof parseCrmStudentStatus>;
    try {
      parsed = parseCrmStudentStatus(dto.status);
    } catch {
      throw new BadRequestException(`Invalid status: ${dto.status}`);
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        role: { code: "STUDENT" },
      },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException(`Student with id ${userId} not found`);
    }

    const step = crmStatusToProcessStep(parsed);
    const setProgress100 = parsed === "COMPLETED";

    await this.prisma.studentPortrait.upsert({
      where: { userId },
      create: {
        userId,
        currentStep: step,
        overallProgress: setProgress100 ? 100 : 0,
        educationLevel: EducationLevel.NONE,
      },
      update: {
        currentStep: step,
        ...(setProgress100 ? { overallProgress: 100 } : {}),
      },
    });

    const row = await this.prisma.user.findFirstOrThrow({
      where: { id: userId },
      select: studentListSelect,
    });

    return this.mapToStudentWithStatus(row);
  }

  async getCrmStats() {
    const students = await this.prisma.user.findMany({
      where: { deletedAt: null, role: { code: "STUDENT" } },
      select: {
        createdAt: true,
        portrait: {
          select: { currentStep: true, overallProgress: true },
        },
      },
    });

    const byStatus: Record<string, number> = {
      NEW_LEAD: 0,
      PROFILE_FILLED: 0,
      PROGRAMS_SELECTED: 0,
      DOCUMENTS_UPLOADED: 0,
      CONTRACT_SIGNED: 0,
      PAYMENT_RECEIVED: 0,
      COMPLETED: 0,
    };

    let progressSum = 0;
    let progressCount = 0;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    let newStudentsToday = 0;
    let newStudentsWeek = 0;

    for (const s of students) {
      if (s.createdAt >= startOfToday) newStudentsToday += 1;
      if (s.createdAt >= startOfWeek) newStudentsWeek += 1;

      const step = s.portrait?.currentStep ?? ProcessStep.DISCOVERY;
      const label = processStepToCrmStatus(step, s.portrait);
      byStatus[label] = (byStatus[label] ?? 0) + 1;

      if (s.portrait) {
        progressSum += s.portrait.overallProgress;
        progressCount += 1;
      }
    }

    const averageProgress = progressCount > 0 ? Math.round((progressSum / progressCount) * 10) / 10 : 0;

    const countries = await this.prisma.country.findMany({
      where: {
        portraitTargets: {
          some: {
            studentPortrait: {
              user: { deletedAt: null, role: { code: "STUDENT" } },
            },
          },
        },
      },
      select: { isoCode: true, nameEn: true, nameRu: true },
      orderBy: { isoCode: "asc" },
    });

    return {
      byStatus,
      newStudentsToday,
      newStudentsWeek,
      averageProgress,
      countries,
    };
  }

  /** Aggregated snapshot for the admin home dashboard (one round-trip). */
  async getDashboardOverview() {
    const [crm, finance, totalUsers, studentCount, expertCount, recentUsers] = await Promise.all([
      this.getCrmStats(),
      this.financeService.getSummary(),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({
        where: { deletedAt: null, role: { code: "STUDENT" } },
      }),
      this.prisma.user.count({
        where: { deletedAt: null, role: { code: "EXPERT" } },
      }),
      this.prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: ADMIN_USER_LIST_SELECT,
      }),
    ]);

    return {
      crm,
      finance,
      users: {
        total: totalUsers,
        students: studentCount,
        experts: expertCount,
      },
      recentUsers,
    };
  }

  async listRoles() {
    return this.prisma.role.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { id: "asc" },
    });
  }

  async getAdminUserById(id: number) {
    const user = await this.prisma.user.findFirst({
      where: { id },
      select: ADMIN_USER_DETAIL_SELECT,
    });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return user;
  }

  async createAdminUser(dto: AdminCreateUserDto) {
    const emailClash = await this.prisma.user.findFirst({
      where: { email: dto.email },
      select: { id: true },
    });
    if (emailClash) {
      throw new BadRequestException("Email уже занят другим пользователем");
    }

    const phoneClash = await this.prisma.user.findFirst({
      where: { phoneNumber: dto.phoneNumber },
      select: { id: true },
    });
    if (phoneClash) {
      throw new BadRequestException("Телефон уже занят другим пользователем");
    }

    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
      select: { code: true },
    });
    if (!role) {
      throw new BadRequestException("Роль не найдена");
    }

    const hashed = await bcrypt.hash(dto.password, 10);

    const data: Prisma.UserCreateInput = {
      firstname: dto.firstname,
      lastname: dto.lastname,
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      password: hashed,
      timezone: "Asia/Almaty",
      hasAcceptedTerms: false,
      role: { connect: { id: dto.roleId } },
    };

    if (dto.organisationId != null) {
      data.organisation = { connect: { id: dto.organisationId } };
    }
    if (dto.countryId != null) {
      data.country = { connect: { id: dto.countryId } };
    }
    if (dto.citizenshipCountryId != null) {
      data.citizenship = { connect: { id: dto.citizenshipCountryId } };
    }

    if (role.code === "STUDENT") {
      data.portrait = { create: { consultationBalance: 2 } };
    }

    const user = await this.prisma.user.create({
      data,
      select: ADMIN_USER_LIST_SELECT,
    });
    if (role.code === "STUDENT") {
      void this.userJourneyLog.logEvent(user.id, USER_JOURNEY_EVENT.REGISTRATION, {
        source: "admin",
      });
    }
    return user;
  }

  /** Updates account fields and revokes CRM sessions when its role changes. */
  async updateAdminUser(id: number, dto: AdminPatchUserDto, actorUserId: number) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    if (dto.email !== undefined && dto.email !== existing.email) {
      const clash = await this.prisma.user.findFirst({
        where: { email: dto.email, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException("Email уже занят другим пользователем");
      }
    }

    if (dto.phoneNumber !== undefined && dto.phoneNumber !== existing.phoneNumber) {
      const clash = await this.prisma.user.findFirst({
        where: { phoneNumber: dto.phoneNumber, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException("Телефон уже занят другим пользователем");
      }
    }

    if (actorUserId === id && dto.roleId !== undefined && dto.roleId !== existing.roleId) {
      throw new BadRequestException("Нельзя изменить свою роль");
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.firstname !== undefined) data.firstname = dto.firstname;
    if (dto.lastname !== undefined) data.lastname = dto.lastname;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phoneNumber !== undefined) data.phoneNumber = dto.phoneNumber;
    if (dto.roleId !== undefined) {
      data.role = { connect: { id: dto.roleId } };
    }
    if (dto.password !== undefined && dto.password.length > 0) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: ADMIN_USER_DETAIL_SELECT,
    });
    if (dto.roleId !== undefined) this.leadRealtime.revokeUser(id);
    return user;
  }
}
