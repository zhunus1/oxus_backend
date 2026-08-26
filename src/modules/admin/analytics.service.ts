import { Injectable, NotFoundException } from "@nestjs/common";
import { EducationLevel, Prisma, ProcessStep } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";
import type { AnalyticsEventsQueryDto, AnalyticsFunnelQueryDto } from "./api/dto/analytics-query.dto";

const FUNNEL_STEP_ORDER: ProcessStep[] = [
  ProcessStep.DISCOVERY,
  ProcessStep.UNI_SELECTION,
  ProcessStep.DOC_PREPARATION,
  ProcessStep.APPLYING,
  ProcessStep.VISA_SUPPORT,
  ProcessStep.ENROLLED,
  ProcessStep.GAP_YEAR,
];

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildPortraitWhere(q: AnalyticsFunnelQueryDto): Prisma.StudentPortraitWhereInput {
    const userWhere: Prisma.UserWhereInput = {
      deletedAt: null,
      role: { code: "STUDENT" },
    };
    if (q.dateFrom || q.dateTo) {
      userWhere.createdAt = {};
      if (q.dateFrom) userWhere.createdAt.gte = new Date(q.dateFrom);
      if (q.dateTo) userWhere.createdAt.lte = new Date(q.dateTo);
    }
    if (q.country) {
      userWhere.country = { isoCode: q.country };
    }
    const portraitWhere: Prisma.StudentPortraitWhereInput = { user: userWhere };
    if (q.educationLevel) {
      portraitWhere.educationLevel = q.educationLevel;
    }
    return portraitWhere;
  }

  private buildUserWhere(q: AnalyticsFunnelQueryDto): Prisma.UserWhereInput {
    const userWhere: Prisma.UserWhereInput = {
      deletedAt: null,
      role: { code: "STUDENT" },
    };
    if (q.dateFrom || q.dateTo) {
      userWhere.createdAt = {};
      if (q.dateFrom) userWhere.createdAt.gte = new Date(q.dateFrom);
      if (q.dateTo) userWhere.createdAt.lte = new Date(q.dateTo);
    }
    if (q.country) {
      userWhere.country = { isoCode: q.country };
    }
    if (q.educationLevel) {
      userWhere.portrait = { is: { educationLevel: q.educationLevel } };
    }
    return userWhere;
  }

  private eventTimeWhere(q: AnalyticsFunnelQueryDto): Prisma.DateTimeFilter | undefined {
    if (!q.dateFrom && !q.dateTo) return undefined;
    const f: Prisma.DateTimeFilter = {};
    if (q.dateFrom) f.gte = new Date(q.dateFrom);
    if (q.dateTo) f.lte = new Date(q.dateTo);
    return f;
  }

  async getFunnel(q: AnalyticsFunnelQueryDto) {
    const portraitWhere = this.buildPortraitWhere(q);
    const grouped = await this.prisma.studentPortrait.groupBy({
      by: ["currentStep"],
      where: portraitWhere,
      _count: { id: true },
    });
    const byStep = new Map<ProcessStep, number>(grouped.map(g => [g.currentStep, g._count.id]));
    const counts = FUNNEL_STEP_ORDER.map(s => byStep.get(s) ?? 0);
    return FUNNEL_STEP_ORDER.map((stage, i) => {
      const count = counts[i];
      const prevCount = i > 0 ? counts[i - 1] : 0;
      const conversionRate = i > 0 && prevCount > 0 ? Math.round((count / prevCount) * 10000) / 100 : i > 0 && prevCount === 0 ? 0 : undefined;
      return { stage, count, conversionRate };
    });
  }

  async listEvents(q: AnalyticsEventsQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const skip = (page - 1) * limit;
    const userWhere = this.buildUserWhere(q);
    const createdAt = this.eventTimeWhere(q);

    const where: Prisma.UserJourneyEventWhereInput = {
      user: userWhere,
      ...(q.eventType ? { eventType: q.eventType } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.userJourneyEvent.count({ where }),
      this.prisma.userJourneyEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          userId: true,
          eventType: true,
          eventData: true,
          createdAt: true,
          user: {
            select: { firstname: true, lastname: true },
          },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      data: rows.map(r => ({
        id: r.id,
        studentId: r.userId,
        studentName: `${r.user.firstname} ${r.user.lastname}`.trim(),
        eventType: r.eventType,
        eventData: r.eventData,
        createdAt: r.createdAt,
      })),
      total,
      page,
      totalPages,
    };
  }

  async getStudentJourney(studentId: number) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        deletedAt: null,
        role: { code: "STUDENT" },
      },
      select: {
        id: true,
        firstname: true,
        lastname: true,
        createdAt: true,
        portrait: { select: { currentStep: true } },
      },
    });
    if (!user) {
      throw new NotFoundException(`Student with id ${studentId} not found`);
    }

    const events = await this.prisma.userJourneyEvent.findMany({
      where: { userId: studentId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        eventType: true,
        eventData: true,
        createdAt: true,
      },
    });

    const stageDurations = this.computeStageDurations(events, user.createdAt);
    return {
      studentId: user.id,
      studentName: `${user.firstname} ${user.lastname}`.trim(),
      currentStep: user.portrait?.currentStep ?? ProcessStep.DISCOVERY,
      registeredAt: user.createdAt,
      events,
      stageDurations,
    };
  }

  private computeStageDurations(events: { eventType: string; createdAt: Date }[], registeredAt: Date) {
    const firstAt = (type: string) => events.find(e => e.eventType === type)?.createdAt ?? null;

    const reg = firstAt(USER_JOURNEY_EVENT.REGISTRATION) ?? registeredAt;
    const profileAt = firstAt(USER_JOURNEY_EVENT.PROFILE_FILLED);
    const programAt = firstAt(USER_JOURNEY_EVENT.PROGRAM_SELECTED);
    const docAt = firstAt(USER_JOURNEY_EVENT.DOCUMENT_UPLOADED);
    const contractAt = firstAt(USER_JOURNEY_EVENT.CONTRACT_SIGNED);
    const payAt = firstAt(USER_JOURNEY_EVENT.PAYMENT_COMPLETED);

    type Row = {
      stage: ProcessStep;
      labelRu: string;
      durationMs: number | null;
      durationDays: number | null;
    };

    const rows: Row[] = [
      {
        stage: ProcessStep.DISCOVERY,
        labelRu: "Знакомство / профиль",
        durationMs: profileAt ? profileAt.getTime() - reg.getTime() : null,
        durationDays: null,
      },
      {
        stage: ProcessStep.UNI_SELECTION,
        labelRu: "Выбор программ",
        durationMs: profileAt && programAt ? programAt.getTime() - profileAt.getTime() : null,
        durationDays: null,
      },
      {
        stage: ProcessStep.DOC_PREPARATION,
        labelRu: "Подготовка документов",
        durationMs: programAt && docAt ? docAt.getTime() - programAt.getTime() : null,
        durationDays: null,
      },
      {
        stage: ProcessStep.APPLYING,
        labelRu: "Подача / заявка",
        durationMs: docAt && contractAt ? contractAt.getTime() - docAt.getTime() : null,
        durationDays: null,
      },
      {
        stage: ProcessStep.VISA_SUPPORT,
        labelRu: "Договор / виза",
        durationMs: contractAt && payAt ? payAt.getTime() - contractAt.getTime() : null,
        durationDays: null,
      },
    ];

    return rows.map(r => {
      const ms = r.durationMs;
      const days = ms != null && ms >= 0 ? Math.round((ms / 86400000) * 100) / 100 : null;
      return { ...r, durationDays: days };
    });
  }

  async getSummary(q: AnalyticsFunnelQueryDto) {
    const userWhere = this.buildUserWhere(q);

    const totalStudents = await this.prisma.user.count({ where: userWhere });

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const lostCreated: Prisma.DateTimeFilter = { lte: weekAgo };
    if (q.dateFrom) lostCreated.gte = new Date(q.dateFrom);

    const lostLeads = await this.prisma.user.count({
      where: {
        deletedAt: null,
        role: { code: "STUDENT" },
        ...(q.country ? { country: { isoCode: q.country } } : {}),
        createdAt: lostCreated,
        portrait: {
          is: {
            currentStep: ProcessStep.DISCOVERY,
            educationLevel: EducationLevel.NONE,
          },
        },
      },
    });

    const withProgram = await this.prisma.userJourneyEvent.findMany({
      where: {
        eventType: USER_JOURNEY_EVENT.PROGRAM_SELECTED,
        user: userWhere,
      },
      select: {
        createdAt: true,
        user: { select: { createdAt: true } },
      },
    });
    const msToProgram = withProgram.map(e => e.createdAt.getTime() - e.user.createdAt.getTime()).filter(x => x >= 0);
    const avgMsToProgram = msToProgram.length > 0 ? msToProgram.reduce((a, b) => a + b, 0) / msToProgram.length : null;

    const withPay = await this.prisma.userJourneyEvent.findMany({
      where: {
        eventType: USER_JOURNEY_EVENT.PAYMENT_COMPLETED,
        user: userWhere,
      },
      select: {
        createdAt: true,
        user: { select: { createdAt: true } },
      },
    });
    const msToPay = withPay.map(e => e.createdAt.getTime() - e.user.createdAt.getTime()).filter(x => x >= 0);
    const avgMsToPayment = msToPay.length > 0 ? msToPay.reduce((a, b) => a + b, 0) / msToPay.length : null;

    const paidCount = withPay.length;
    const conversionToPaymentPercent = totalStudents > 0 ? Math.round((paidCount / totalStudents) * 10000) / 100 : 0;

    return {
      totalStudents,
      averageDaysToProgramSelection: avgMsToProgram != null ? Math.round((avgMsToProgram / 86400000) * 100) / 100 : null,
      averageDaysToPayment: avgMsToPayment != null ? Math.round((avgMsToPayment / 86400000) * 100) / 100 : null,
      conversionToPaymentPercent,
      lostLeads,
      paymentsCompletedCount: paidCount,
    };
  }

  async listCountriesForFilters() {
    return this.prisma.country.findMany({
      orderBy: { isoCode: "asc" },
      select: {
        isoCode: true,
        nameEn: true,
        nameRu: true,
      },
    });
  }
}
