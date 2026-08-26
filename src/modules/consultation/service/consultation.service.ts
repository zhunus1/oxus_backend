import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { ConsultationRepository } from "../repository/consultation.repository";
import { CreateConsultationDto } from "../api/dto/create-consultation.dto";
import { BookConsultationDto } from "../api/dto/book-consultation.dto";
import { ExpertBookConsultationDto } from "../api/dto/expert-book-consultation.dto";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import messages from "src/configs/messages";
import { UpdateConsultationDto } from "../api/dto/update-consultation.dto";
import { ConsultationQueryDto } from "../api/dto/consultation-query.dto";
import { ConsultationStatus } from "generated/prisma/enums";

import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";
import { MEETING_BOOKING_MIN_LEAD_HOURS, MEETING_BOOKING_MIN_LEAD_MS } from "src/common/constants/booking.constants";
import { SmsService } from "src/modules/sms/sms.service";
import { ExpertMeetingHistoryQueryDto } from "../api/dto/expert-meeting-history-query.dto";

type ExpertMeeting = Awaited<ReturnType<ConsultationRepository["findByConsultantProfileId"]>>[number];

@Injectable()
export class ConsultationService {
  private readonly logger = new Logger(ConsultationService.name);
  private readonly entityName = "Consultation";

  constructor(
    private readonly consultationRepo: ConsultationRepository,
    @InjectQueue("mail") private readonly mailQueue: Queue,
    private readonly userJourneyLog: UserJourneyLogService,
    private readonly sms: SmsService,
  ) {}

  async create(dto: CreateConsultationDto) {
    try {
      const consultation = await this.consultationRepo.create(dto);

      // Schedule reminder email
      await this.scheduleReminder(consultation);

      return consultation;
    } catch (error) {
      this.logger.error(`Error creating consultation: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  async update(id: number, dto: UpdateConsultationDto) {
    try {
      const updatedConsultation = await this.consultationRepo.update(id, dto);

      // If startTime changed or status changed to CANCELLED, update/remove job
      if (dto.startTime || dto.status === ConsultationStatus.DONE) {
        // Remove old job if exists
        await this.removeReminder(id);

        // Reschedule if not cancelled/done
        if (updatedConsultation.status !== ConsultationStatus.DONE) {
          await this.scheduleReminder(updatedConsultation);
        }
      } else if (dto.status === ConsultationStatus.REQUESTED) {
        // If status changed back to requested, we might want to reschedule or keep it
        await this.removeReminder(id);
        await this.scheduleReminder(updatedConsultation);
      }

      return updatedConsultation;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error updating consultation: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entityName));
    }
  }

  private getJobId(consultationId: number) {
    return `reminder-${consultationId}`;
  }

  private async scheduleReminder(consultation: any) {
    const startTime = new Date(consultation.startTime);
    const now = new Date();

    // Reminder 10 minutes before start
    const reminderTime = new Date(startTime.getTime() - 10 * 60 * 1000);
    const delay = reminderTime.getTime() - now.getTime();

    if (delay > 0) {
      await this.mailQueue.add(
        "consultation-reminder",
        {
          clientEmail: consultation.client.email,
          consultantEmail: consultation.consultant.email,
          startTime: consultation.startTime,
          meetingLink: `http://localhost:3000/meet/${consultation.meeting.id}`,
        },
        {
          delay,
          jobId: this.getJobId(consultation.id),
          removeOnComplete: true,
        },
      );
      this.logger.log(`Scheduled reminder for consultation ${consultation.id} with delay ${delay}ms`);
    } else {
      this.logger.warn(`Consultation ${consultation.id} starts too soon (${startTime.toDateString()}), skipping reminder scheduling.`);
    }
  }

  private async removeReminder(consultationId: number) {
    const jobId = this.getJobId(consultationId);
    const job = await this.mailQueue.getJob(jobId);
    if (job) {
      await job.remove();
      this.logger.log(`Removed reminder job for consultation ${consultationId}`);
    }
  }

  async findById(id: number) {
    const consultation = await this.consultationRepo.findById(id);
    if (!consultation) {
      throw new NotFoundException(messages.NOT_FOUND(this.entityName));
    }
    return consultation;
  }

  async findMany(query: ConsultationQueryDto) {
    try {
      return await this.consultationRepo.findMany(query);
    } catch (error) {
      this.logger.error(`Error fetching consultations: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  private getLocalDateParts(date: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(date);

    const year = Number(parts.find(p => p.type === "year")?.value);
    const month = Number(parts.find(p => p.type === "month")?.value);
    const day = Number(parts.find(p => p.type === "day")?.value);
    const hour = Number(parts.find(p => p.type === "hour")?.value);
    const minute = Number(parts.find(p => p.type === "minute")?.value);
    const weekdayShort = parts.find(p => p.type === "weekday")?.value;

    const weekdayMap: Record<string, number> = {
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
      Sun: 7,
    };

    return {
      year,
      month,
      day,
      dayOfWeek: weekdayMap[weekdayShort ?? "Mon"],
      minuteOfDay: hour * 60 + minute,
    };
  }

  private isInsideScheduleBlock(startMinute: number, endMinute: number, schedule: { startMinute: number; endMinute: number }[]) {
    return schedule.some(block => startMinute >= block.startMinute && endMinute <= block.endMinute);
  }

  async book(studentUserId: number, dto: BookConsultationDto) {
    try {
      const portrait = await this.consultationRepo.findPortraitByUserId(studentUserId);
      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND("StudentPortrait"));
      }

      return await this.bookConsultationForStudentPortfolio(studentUserId, portrait, dto);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error(`Error booking consultation: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  /** Expert schedules a consultation for an assigned student (consumes one slot from the student's package). */
  async bookForStudentByExpert(expertUserId: number, dto: ExpertBookConsultationDto) {
    try {
      const consultantProfile = await this.consultationRepo.findConsultantProfileByUserId(expertUserId);
      if (!consultantProfile) {
        throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
      }

      const portrait = await this.consultationRepo.findPortraitByUserId(dto.clientUserId);
      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND("StudentPortrait"));
      }

      if (!portrait.consultantProfileId || portrait.consultantProfileId !== consultantProfile.id) {
        throw new ForbiddenException("Student is not assigned to this expert");
      }

      const bookingDto: BookConsultationDto = {
        startTime: dto.startTime,
        endTime: dto.endTime,
      };

      return await this.bookConsultationForStudentPortfolio(dto.clientUserId, portrait, bookingDto, ConsultationStatus.CONFIRMED);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Error expert booking consultation: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  async respondToMeetingRequest(expertUserId: number, meetingId: number, action: "confirm" | "decline") {
    try {
      const consultantProfile = await this.consultationRepo.findConsultantProfileByUserId(expertUserId);
      if (!consultantProfile) throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));

      const consultation = await this.consultationRepo.findById(meetingId);
      if (!consultation) throw new NotFoundException(messages.NOT_FOUND("Consultation"));

      if (consultation.consultantProfileId !== consultantProfile.id) {
        throw new ForbiddenException("This meeting does not belong to you");
      }

      if (consultation.status !== ConsultationStatus.REQUESTED) {
        throw new BadRequestException("Only REQUESTED meetings can be confirmed or declined");
      }

      const newStatus = action === "confirm" ? ConsultationStatus.CONFIRMED : ConsultationStatus.CANCELLED;
      const updated = await this.consultationRepo.update(meetingId, { status: newStatus });

      if (action === "decline") {
        await this.removeReminder(meetingId);
      }

      return updated;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error responding to meeting request: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entityName));
    }
  }

  private async bookConsultationForStudentPortfolio(
    studentUserId: number,
    portrait: NonNullable<Awaited<ReturnType<ConsultationRepository["findPortraitByUserId"]>>>,
    dto: BookConsultationDto,
    initialStatus: ConsultationStatus = ConsultationStatus.REQUESTED,
  ) {
    if (!portrait.consultantProfileId) {
      throw new BadRequestException("Please select an expert first");
    }

    const studentPackage = await this.consultationRepo.findStudentPackage(studentUserId, portrait.consultantProfileId);

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      throw new BadRequestException("Invalid consultation time");
    }

    if (startTime >= endTime) {
      throw new BadRequestException("startTime must be earlier than endTime");
    }

    const minBookableStart = new Date(Date.now() + MEETING_BOOKING_MIN_LEAD_MS);
    if (startTime < minBookableStart) {
      throw new BadRequestException(`Meetings must be booked at least ${MEETING_BOOKING_MIN_LEAD_HOURS} hours in advance`);
    }

    const durationMinutes = (endTime.getTime() - startTime.getTime()) / 60000;
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      throw new BadRequestException("Invalid consultation duration");
    }

    const consultantProfile = await this.consultationRepo.findConsultantProfileWithUserById(portrait.consultantProfileId);
    if (!consultantProfile) {
      throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
    }

    const expertTimezone = consultantProfile.user.timezone ?? "Asia/Almaty";

    const localStart = this.getLocalDateParts(startTime, expertTimezone);
    const localEnd = this.getLocalDateParts(endTime, expertTimezone);

    const daySchedule = await this.consultationRepo.findExpertScheduleByUserIdAndDay(consultantProfile.user.id, localStart.dayOfWeek);

    if (daySchedule.length === 0) {
      throw new BadRequestException("Expert is not available on this day");
    }

    const isInsideSchedule = this.isInsideScheduleBlock(localStart.minuteOfDay, localEnd.minuteOfDay, daySchedule);

    if (!isInsideSchedule) {
      throw new BadRequestException("Requested time is outside expert schedule");
    }

    const overlappingConsultation = await this.consultationRepo.findOverlappingConsultation(portrait.consultantProfileId, startTime, endTime);

    if (overlappingConsultation) {
      throw new BadRequestException("This time slot is already booked");
    }

    const consultation = await this.consultationRepo.create({
      clientId: studentUserId,
      consultantId: portrait.consultantProfileId,
      startTime: dto.startTime,
      endTime: dto.endTime,
      status: initialStatus,
      packageId: studentPackage?.id,
      studentId: studentUserId,
      expertId: portrait.consultantProfileId,
    });

    if (studentPackage) {
      await this.consultationRepo.incrementUsedSlots(studentPackage.id);
    }
    await this.scheduleReminder(consultation);

    const studentName = `${(consultation as any).client?.firstname ?? ""} ${(consultation as any).client?.lastname ?? ""}`.trim() || "A student";
    const expertEmail = consultantProfile?.user?.email;
    if (expertEmail) {
      void this.mailQueue.add(
        "meeting-request",
        {
          expertEmail,
          studentName,
          startTime: consultation.startTime,
          dashboardUrl: "https://expert.academicapply.com/meetings",
        },
        { removeOnComplete: true },
      );
    }

    const expertPhone = consultantProfile?.user?.phoneNumber;
    if (expertPhone) {
      const expertName = `${consultantProfile.user.firstname} ${consultantProfile.user.lastname}`.trim();
      void this.sms.sendMeetingRequest({ phone: expertPhone, name: expertName }, { name: studentName }, new Date(consultation.startTime));
    }

    void this.userJourneyLog.logEvent(studentUserId, USER_JOURNEY_EVENT.CONSULTATION_BOOKED, {
      consultationId: consultation.id,
      startTime: dto.startTime,
      endTime: dto.endTime,
    });

    return consultation;
  }

  async findMyConsultations(userId: number) {
    try {
      const consultations = await this.consultationRepo.findByClientId(userId);

      // Convert times to student's timezone
      if (consultations.length > 0) {
        const timezone = (consultations[0].client as any)?.timezone ?? "Asia/Almaty";
        const formatter = new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });

        return consultations.map(c => ({
          ...c,
          startTimeLocal: formatter.format(new Date(c.startTime)),
          endTimeLocal: formatter.format(new Date(c.endTime)),
        }));
      }

      return consultations;
    } catch (error) {
      this.logger.error(`Error fetching my consultations: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findMyExpertMeetings(userId: number, query: ConsultationQueryDto) {
    try {
      const consultantProfile = await this.consultationRepo.findConsultantProfileByUserId(userId);

      if (!consultantProfile) {
        throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
      }

      const consultations = await this.consultationRepo.findByConsultantProfileId(consultantProfile.id, query);
      return this.localizeExpertMeetingTimes(consultations);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching expert meetings: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findMyPendingExpertMeetings(userId: number) {
    try {
      const consultantProfile = await this.consultationRepo.findConsultantProfileByUserId(userId);

      if (!consultantProfile) {
        throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
      }

      const consultations = await this.consultationRepo.findPendingByConsultantProfileId(consultantProfile.id);
      return this.localizeExpertMeetingTimes(consultations);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching pending expert meetings: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findMyExpertMeetingHistory(userId: number, query: ExpertMeetingHistoryQueryDto) {
    try {
      const consultantProfile = await this.consultationRepo.findConsultantProfileByUserId(userId);

      if (!consultantProfile) {
        throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
      }

      const { page, limit } = query;
      const { data, totalItems } = await this.consultationRepo.findHistoryPageByConsultantProfileId(consultantProfile.id, page, limit);

      return {
        data: this.localizeExpertMeetingTimes(data),
        meta: {
          page,
          limit,
          totalItems,
          totalPages: Math.max(1, Math.ceil(totalItems / limit)),
        },
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching expert meeting history: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  private localizeExpertMeetingTimes(consultations: ExpertMeeting[]) {
    const expertTimezone = consultations[0]?.consultant?.user?.timezone ?? "Asia/Almaty";
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: expertTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    return consultations.map(consultation => ({
      ...consultation,
      startTimeLocal: formatter.format(new Date(consultation.startTime)),
      endTimeLocal: formatter.format(new Date(consultation.endTime)),
    }));
  }
}
