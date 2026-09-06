import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { GetAvailableSlotsDto } from "src/modules/expert-schedule/api/dto/get-available-slots.dto";
import { getLocalDateParts, incrementCalendarDay, localDateKey, rangesOverlap, zonedLocalToUtc } from "src/common/helpers/timezone";
import { MEETING_BOOKING_MIN_LEAD_MS } from "src/common/constants/booking.constants";
import { splitLeadSlots } from "../domain/lead-booking";

/** Builds first-consultation availability from expert schedules and existing bookings. */
@Injectable()
export class LeadAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns configured thirty-minute slots with busy and minimum-notice flags in the expert timezone. */
  async slots(expertUserId: number, dto: GetAvailableSlotsDto) {
    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to || to.getTime() - from.getTime() > 62 * 86400_000) {
      throw new BadRequestException("Availability range must be valid and no longer than 62 days");
    }
    const expert = await this.prisma.user.findFirst({
      where: { id: expertUserId, role: { code: "EXPERT" }, deletedAt: null, consultantProfile: { isActive: true } },
      select: { timezone: true, consultantProfile: { select: { id: true } }, expertSchedules: true },
    });
    if (!expert?.consultantProfile) throw new NotFoundException("Expert not found");
    const timezone = expert.timezone || "Asia/Almaty";
    let day = getLocalDateParts(from, timezone);
    const last = getLocalDateParts(to, timezone);
    const after = incrementCalendarDay(last.year, last.month, last.day);
    const startTime = { lt: zonedLocalToUtc(after.year, after.month, after.day, 0, timezone) };
    const endTime = { gt: zonedLocalToUtc(day.year, day.month, day.day, 0, timezone) };
    const [calls, consultations] = await Promise.all([
      this.prisma.leadExpertCall.findMany({ where: { expertUserId, status: { in: ["REQUESTED", "CONFIRMED"] }, startTime, endTime }, select: { startTime: true, endTime: true } }),
      this.prisma.consultation.findMany({
        where: { consultantProfileId: expert.consultantProfile.id, status: { not: "CANCELLED" }, startTime, endTime },
        select: { startTime: true, endTime: true },
      }),
    ]);
    const bookings = [...calls, ...consultations];
    const minStart = Date.now() + MEETING_BOOKING_MIN_LEAD_MS;
    const slots: { startTime: Date; endTime: Date; available: boolean; reason: string | null }[] = [];
    while (localDateKey(day) <= localDateKey(last)) {
      for (const schedule of expert.expertSchedules.filter(s => s.dayOfWeek === day.dayOfWeek)) {
        for (const slot of splitLeadSlots(day, schedule.startMinute, schedule.endMinute, timezone)) {
          const busy = bookings.some(b => rangesOverlap(slot.startTime, slot.endTime, b.startTime, b.endTime));
          const reason = busy ? "BUSY" : slot.startTime.getTime() < minStart ? "TOO_SOON" : null;
          slots.push({ ...slot, available: reason === null, reason });
        }
      }
      const next = incrementCalendarDay(day.year, day.month, day.day);
      day = getLocalDateParts(zonedLocalToUtc(next.year, next.month, next.day, 12 * 60, timezone), timezone);
    }
    slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    return { expertUserId, timezone, slots };
  }
}
