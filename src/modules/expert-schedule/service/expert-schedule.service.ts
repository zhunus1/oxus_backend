import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { ExpertScheduleRepository } from "../repository/expert-schedule.repository";
import { PrismaService } from "src/database/prisma.service";
import { UpdateExpertScheduleDto } from "../api/dto/update-expert-schedule.dto";
import messages from "src/configs/messages";
import { GetAvailableSlotsDto } from "../api/dto/get-available-slots.dto";
import { AvailableSlotEntity } from "../api/dto/available-slot.entity";
import { MEETING_BOOKING_MIN_LEAD_MS } from "src/common/constants/booking.constants";
import { getLocalDateParts, incrementCalendarDay, localDateKey, rangesOverlap, zonedLocalToUtc } from "src/common/helpers/timezone";

const MAX_AVAILABILITY_RANGE_DAYS = 62;

@Injectable()
export class ExpertScheduleService {
  private readonly logger = new Logger(ExpertScheduleService.name);

  constructor(
    private readonly repo: ExpertScheduleRepository,
    private readonly prisma: PrismaService,
  ) {}

  private async getConsultantProfile(userId: number) {
    const profile = await this.prisma.consultantProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
    }

    return profile;
  }

  private validateScheduleItems(items: { dayOfWeek: number; startMinute: number; endMinute: number }[]) {
    const grouped = new Map<number, { startMinute: number; endMinute: number }[]>();

    for (const item of items) {
      if (item.startMinute >= item.endMinute) {
        throw new BadRequestException("startMinute must be less than endMinute");
      }

      if (!grouped.has(item.dayOfWeek)) {
        grouped.set(item.dayOfWeek, []);
      }

      grouped.get(item.dayOfWeek)!.push({
        startMinute: item.startMinute,
        endMinute: item.endMinute,
      });
    }

    for (const [, dayItems] of grouped) {
      dayItems.sort((a, b) => a.startMinute - b.startMinute);

      for (let i = 1; i < dayItems.length; i++) {
        const prev = dayItems[i - 1];
        const curr = dayItems[i];

        if (curr.startMinute < prev.endMinute) {
          throw new BadRequestException("Schedule items must not overlap on the same day");
        }
      }
    }
  }

  async getMySchedule(userId: number) {
    try {
      await this.getConsultantProfile(userId);

      return await this.repo.findByExpertUserId(userId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;

      this.logger.error(`Error fetching schedule: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("ExpertSchedule"));
    }
  }

  async updateMySchedule(userId: number, dto: UpdateExpertScheduleDto) {
    try {
      await this.getConsultantProfile(userId);

      this.validateScheduleItems(dto.items);

      await this.repo.replaceSchedule(userId, dto.items);

      return { success: true };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;

      this.logger.error(`Error updating schedule: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR("ExpertSchedule", 0));
    }
  }

  async getAvailableSlots(expertUserId: number, dto: GetAvailableSlotsDto): Promise<AvailableSlotEntity[]> {
    try {
      const from = new Date(dto.from);
      const to = new Date(dto.to);

      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new BadRequestException("'from' and 'to' must be valid dates");
      }

      if (from > to) {
        throw new BadRequestException("'from' must be less than or equal to 'to'");
      }
      if (to.getTime() - from.getTime() > MAX_AVAILABILITY_RANGE_DAYS * 24 * 60 * 60 * 1000) {
        throw new BadRequestException(`Availability range cannot exceed ${MAX_AVAILABILITY_RANGE_DAYS} days`);
      }

      const consultantProfile = await this.repo.findConsultantProfileByUserId(expertUserId);
      if (!consultantProfile) {
        throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
      }

      const schedule = await this.repo.findByExpertUserId(expertUserId);
      if (schedule.length === 0) {
        return [];
      }

      const expertTimezone = consultantProfile.user?.timezone ?? "Asia/Almaty";
      const now = new Date();
      const minBookableStart = new Date(now.getTime() + MEETING_BOOKING_MIN_LEAD_MS);
      const rangeStart = getLocalDateParts(from, expertTimezone);
      const rangeEnd = getLocalDateParts(to, expertTimezone);
      const nextDayAfterRange = incrementCalendarDay(rangeEnd.year, rangeEnd.month, rangeEnd.day);
      const bookingRangeStart = zonedLocalToUtc(rangeStart.year, rangeStart.month, rangeStart.day, 0, expertTimezone);
      const bookingRangeEnd = zonedLocalToUtc(nextDayAfterRange.year, nextDayAfterRange.month, nextDayAfterRange.day, 0, expertTimezone);

      const [bookedConsultations, bookedLeadCalls] = await Promise.all([
        this.repo.findConsultationsForExpertInRange(consultantProfile.id, bookingRangeStart, bookingRangeEnd),
        this.repo.findLeadCallsForExpertInRange(expertUserId, bookingRangeStart, bookingRangeEnd),
      ]);

      const result: AvailableSlotEntity[] = [];
      const seenDays = new Set<string>();

      let year = rangeStart.year;
      let month = rangeStart.month;
      let day = rangeStart.day;
      const endKey = localDateKey(rangeEnd);

      while (localDateKey({ year, month, day }) <= endKey) {
        const dayKey = localDateKey({ year, month, day });
        if (!seenDays.has(dayKey)) {
          seenDays.add(dayKey);

          const noonUtc = zonedLocalToUtc(year, month, day, 12 * 60, expertTimezone);
          const { dayOfWeek } = getLocalDateParts(noonUtc, expertTimezone);
          const daySchedule = schedule.filter(item => item.dayOfWeek === dayOfWeek);

          for (const slot of daySchedule) {
            const slotStart = zonedLocalToUtc(year, month, day, slot.startMinute, expertTimezone);
            const slotEnd = zonedLocalToUtc(year, month, day, slot.endMinute, expertTimezone);

            if (slotEnd <= now || slotStart < minBookableStart) {
              continue;
            }

            const isBooked = [...bookedConsultations, ...bookedLeadCalls].some(booking => rangesOverlap(slotStart, slotEnd, booking.startTime, booking.endTime));

            if (!isBooked) {
              result.push(
                new AvailableSlotEntity({
                  startTime: slotStart,
                  endTime: slotEnd,
                  expertId: expertUserId,
                }),
              );
            }
          }
        }

        ({ year, month, day } = incrementCalendarDay(year, month, day));
      }

      result.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      return result;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;

      this.logger.error(`Error generating slots: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("AvailableSlots"));
    }
  }
}
