import type { ConsultationActor } from "../domain/consultation-access";
import { BadRequestException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
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

/** Coordinates participant-scoped consultation actions and post-commit reminders. */
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

  /** Creates a consultation for the authenticated actor and preserves domain HTTP errors. */
  async create(dto: CreateConsultationDto, actor: ConsultationActor) {
    try {
      const consultation = await this.consultationRepo.create(dto, actor);

      // Schedule reminder email
      await this.scheduleReminder(consultation);

      return consultation;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Error creating consultation: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  /** Updates an authorized consultation and removes reminders when it is cancelled or completed. */
  async update(id: number, dto: UpdateConsultationDto, actor: ConsultationActor) {
    try {
      const updatedConsultation = await this.consultationRepo.update(id, dto, actor);

      if (dto.startTime || dto.endTime || dto.status) {
        await this.removeReminder(id);
        if (updatedConsultation.status !== ConsultationStatus.CANCELLED && updatedConsultation.status !== ConsultationStatus.DONE) await this.scheduleReminder(updatedConsultation);
      }

      return updatedConsultation;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Error updating consultation: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entityName));
    }
  }

  private getJobId(consultationId: number) {
    return `reminder-${consultationId}`;
  }

  /** Schedules reminders only for active meetings using the consultant user contact. */
  private async scheduleReminder(consultation: any) {
    if (!consultation.meeting || consultation.status === ConsultationStatus.CANCELLED || consultation.status === ConsultationStatus.DONE) return;
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
          consultantEmail: consultation.consultant.user.email,
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

  /** Returns a consultation only within the authenticated actor visibility scope. */
  async findById(id: number, actor: ConsultationActor) {
    const consultation = await this.consultationRepo.findById(id, actor);
    if (!consultation) {
      throw new NotFoundException(messages.NOT_FOUND(this.entityName));
    }
    return consultation;
  }

  /** Combines filters with participant visibility without exposing other users consultations. */
  async findMany(query: ConsultationQueryDto, actor: ConsultationActor) {
    try {
      return await this.consultationRepo.findMany(query, actor);
    } catch (error) {
      if (error instanceof HttpException) throw error;
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

  /** Books a student consultation, preserving domain conflicts from transactional persistence. */
  async book(studentUserId: number, dto: BookConsultationDto) {
    try {
      const portrait = await this.consultationRepo.findPortraitByUserId(studentUserId);
      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND("StudentPortrait"));
      }

      return await this.bookConsultationForStudentPortfolio(studentUserId, portrait, dto);
    } catch (error) {
      if (error instanceof HttpException) throw error;
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
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Error expert booking consultation: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  /** Confirms or declines a pending request, rechecking ownership and state inside the update transaction. */
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
      const updated = await this.consultationRepo.update(meetingId, { status: newStatus }, { id: expertUserId, roleCode: "EXPERT" }, ConsultationStatus.REQUESTED);

      if (action === "decline") {
        await this.removeReminder(meetingId);
      }

      return updated;
    } catch (error) {
      if (error instanceof HttpException) throw error;
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

    if (localStart.year !== localEnd.year || localStart.month !== localEnd.month || localStart.day !== localEnd.day) {
      throw new BadRequestException("A consultation must start and end on the same local day");
    }

    const daySchedule = await this.consultationRepo.findExpertScheduleByUserIdAndDay(consultantProfile.user.id, localStart.dayOfWeek);

    if (daySchedule.length === 0) {
      throw new BadRequestException("Expert is not available on this day");
    }

    const isInsideSchedule = this.isInsideScheduleBlock(localStart.minuteOfDay, localEnd.minuteOfDay, daySchedule);

    if (!isInsideSchedule) {
      throw new BadRequestException("Requested time is outside expert schedule");
    }

    const consultation = await this.consultationRepo.createIfExpertAvailable({
      clientId: studentUserId,
      consultantId: portrait.consultantProfileId,
      startTime: dto.startTime,
      endTime: dto.endTime,
      status: initialStatus,
      packageId: studentPackage?.id,
      studentId: studentUserId,
      expertId: portrait.consultantProfileId,
      expertUserId: consultantProfile.user.id,
    });

    if (!consultation) {
      throw new BadRequestException("This time slot is already booked");
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

  /** Lists the authenticated expert meetings and preserves access errors. */
  async findMyExpertMeetings(userId: number, query: ConsultationQueryDto) {
    try {
      const consultantProfile = await this.consultationRepo.findConsultantProfileByUserId(userId);

      if (!consultantProfile) {
        throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
      }

      const consultations = await this.consultationRepo.findByConsultantProfileId(consultantProfile.id, query);
      return this.localizeExpertMeetingTimes(consultations);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Error fetching expert meetings: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  /** Lists pending requests for the authenticated expert. */
  async findMyPendingExpertMeetings(userId: number) {
    try {
      const consultantProfile = await this.consultationRepo.findConsultantProfileByUserId(userId);

      if (!consultantProfile) {
        throw new NotFoundException(messages.NOT_FOUND("ConsultantProfile"));
      }

      const consultations = await this.consultationRepo.findPendingByConsultantProfileId(consultantProfile.id);
      return this.localizeExpertMeetingTimes(consultations);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Error fetching pending expert meetings: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  /** Paginates the authenticated expert completed request history. */
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
      if (error instanceof HttpException) throw error;
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
