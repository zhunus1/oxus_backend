import { Injectable, NotFoundException } from "@nestjs/common";
import { EducationLevel, Prisma, ProcessStep } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";
import { liveContractStudent } from "src/modules/contract/domain/contract-access";
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
    return { user: this.buildUserWhere(q) };
  }

  private buildUserWhere(q: AnalyticsFunnelQueryDto): Prisma.UserWhereInput {
    const userWhere: Prisma.UserWhereInput = {
      ...liveContractStudent,
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
    const userWhere = this.buildUserWhere({ country: q.country, educationLevel: q.educationLevel });
    const occurredAt = this.eventTimeWhere(q);

    const where: Prisma.UserJourneyEventWhereInput = {
      user: userWhere,
      ...(q.eventType ? { eventType: q.eventType } : {}),
      ...(occurredAt ? { OR: [{ occurredAt }, { occurredAt: null, createdAt: occurredAt }] } : {}),
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
          occurredAt: true,
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
        occurredAt: r.occurredAt ?? r.createdAt,
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
        ...liveContractStudent,
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
        occurredAt: true,
      },
    });

    const stageDurations = this.computeStageDurations(events, user.createdAt);
    return {
      studentId: user.id,
      studentName: `${user.firstname} ${user.lastname}`.trim(),
      currentStep: user.portrait?.currentStep ?? ProcessStep.DISCOVERY,
      registeredAt: user.createdAt,
      events: events.map(event => ({ ...event, occurredAt: event.occurredAt ?? event.createdAt })),
      stageDurations,
    };
  }

  private computeStageDurations(events: { eventType: string; createdAt: Date; occurredAt?: Date | null }[], registeredAt: Date) {
    const firstAt = (type: string) => {
      const times = events.filter(e => e.eventType === type).map(e => (e.occurredAt ?? e.createdAt).getTime());
      return times.length ? new Date(Math.min(...times)) : null;
    };

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
      return { ...r, durationMs: ms != null && ms >= 0 ? ms : null, durationDays: days };
    });
  }

  async getSummary(q: AnalyticsFunnelQueryDto) {
    // One snapshot prevents a concurrent first payment appearing in both lost and paid counts.
    return this.prisma.$transaction(
      async tx => {
        const userWhere = this.buildUserWhere(q);

        const totalStudents = await tx.user.count({ where: userWhere });

        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const lostLeads = await tx.user.count({
          where: {
            // This remains the existing stalled-registration metric, within the same cohort.
            AND: [
              userWhere,
              {
                createdAt: { lte: weekAgo },
                portrait: { is: { currentStep: ProcessStep.DISCOVERY, educationLevel: EducationLevel.NONE } },
                journeyEvents: { none: { eventType: { in: [USER_JOURNEY_EVENT.PAYMENT_COMPLETED, USER_JOURNEY_EVENT.LEAD_CONVERTED] } } },
                transactions: { none: { status: "SUCCESS" } },
                studentContracts: {
                  none: {
                    OR: [
                      { status: "PAID" },
                      { manualConfirmedAt: { not: null } },
                      { installments: { some: { paidAt: { not: null } } } },
                      { lead: { is: { status: "CONVERTED" } } },
                    ],
                  },
                },
              },
            ],
          },
        });

        const withProgram = await tx.userJourneyEvent.findMany({
          where: {
            eventType: USER_JOURNEY_EVENT.PROGRAM_SELECTED,
            user: userWhere,
          },
          select: {
            userId: true,
            occurredAt: true,
            createdAt: true,
            user: { select: { createdAt: true } },
          },
        });
        const msToProgram = firstUserEvents(withProgram)
          .map(e => e.at - e.registeredAt)
          .filter(x => x >= 0);
        const avgMsToProgram = msToProgram.length > 0 ? msToProgram.reduce((a, b) => a + b, 0) / msToProgram.length : null;

        const withPay = await tx.userJourneyEvent.findMany({
          where: {
            eventType: USER_JOURNEY_EVENT.PAYMENT_COMPLETED,
            user: userWhere,
          },
          select: {
            userId: true,
            occurredAt: true,
            createdAt: true,
            user: { select: { createdAt: true } },
          },
        });
        const firstPayments = firstUserEvents(withPay);
        // A manually paid student may be registered later. This duration is undefined, not zero.
        const msToPay = firstPayments.map(e => e.at - e.registeredAt).filter(x => x >= 0);
        const avgMsToPayment = msToPay.length > 0 ? msToPay.reduce((a, b) => a + b, 0) / msToPay.length : null;

        const paidCount = firstPayments.length;
        const conversionToPaymentPercent = totalStudents > 0 ? Math.round((paidCount / totalStudents) * 10000) / 100 : 0;

        return {
          totalStudents,
          averageDaysToProgramSelection: avgMsToProgram != null ? Math.round((avgMsToProgram / 86400000) * 100) / 100 : null,
          averageDaysToPayment: avgMsToPayment != null ? Math.round((avgMsToPayment / 86400000) * 100) / 100 : null,
          conversionToPaymentPercent,
          lostLeads,
          paymentsCompletedCount: paidCount,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
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

/** Conversion counts students, not repeat purchases or repeated historical events. */
function firstUserEvents(events: { userId: number; occurredAt: Date | null; createdAt: Date; user: { createdAt: Date } }[]) {
  const first = new Map<number, { at: number; registeredAt: number }>();
  for (const event of events) {
    const at = (event.occurredAt ?? event.createdAt).getTime();
    if (!first.has(event.userId) || at < first.get(event.userId)!.at) first.set(event.userId, { at, registeredAt: event.user.createdAt.getTime() });
  }
  return [...first.values()];
}
