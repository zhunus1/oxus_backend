import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { ConsultationStatus, LeadExpertCallStatus } from "generated/prisma/enums";
import { ExpertSchedule } from "generated/prisma/client";
import { ExpertScheduleItemDto } from "../api/dto/expert-schedule-item.dto";

@Injectable()
export class ExpertScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByExpertUserId(expertUserId: number): Promise<ExpertSchedule[]> {
    return this.prisma.expertSchedule.findMany({
      where: { expertId: expertUserId },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    });
  }

  async replaceSchedule(expertUserId: number, items: ExpertScheduleItemDto[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.expertSchedule.deleteMany({
        where: { expertId: expertUserId },
      }),
      this.prisma.expertSchedule.createMany({
        data: items.map(item => ({
          expertId: expertUserId,
          dayOfWeek: item.dayOfWeek,
          startMinute: item.startMinute,
          endMinute: item.endMinute,
        })),
      }),
    ]);
  }

  async findConsultantProfileByUserId(userId: number) {
    return this.prisma.consultantProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: { timezone: true },
        },
      },
    });
  }

  async findConsultationsForExpertInRange(consultantProfileId: number, rangeStart: Date, rangeEnd: Date) {
    return this.prisma.consultation.findMany({
      where: {
        consultantProfileId,
        status: {
          not: ConsultationStatus.CANCELLED,
        },
        startTime: {
          lt: rangeEnd,
        },
        endTime: {
          gt: rangeStart,
        },
      },
      orderBy: {
        startTime: "asc",
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
      },
    });
  }

  async findLeadCallsForExpertInRange(expertUserId: number, rangeStart: Date, rangeEnd: Date) {
    return this.prisma.leadExpertCall.findMany({
      where: {
        expertUserId,
        status: { in: [LeadExpertCallStatus.REQUESTED, LeadExpertCallStatus.CONFIRMED] },
        startTime: { lt: rangeEnd },
        endTime: { gt: rangeStart },
      },
      orderBy: { startTime: "asc" },
      select: { id: true, startTime: true, endTime: true, status: true },
    });
  }

  async findConsultationsForExpertOnDate(consultantProfileId: number, dayStart: Date, dayEnd: Date) {
    return this.prisma.consultation.findMany({
      where: {
        consultantProfileId,
        status: {
          not: ConsultationStatus.CANCELLED,
        },
        startTime: {
          lt: dayEnd,
        },
        endTime: {
          gt: dayStart,
        },
      },
      orderBy: {
        startTime: "asc",
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
      },
    });
  }
}
