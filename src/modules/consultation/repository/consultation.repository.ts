import { ConsultationActor, consultationScope } from "../domain/consultation-access";
import { leadTransaction } from "src/modules/lead/domain/lead-transaction";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { CreateConsultationDto } from "../api/dto/create-consultation.dto";
import { Consultation, ConsultationStatus, LeadExpertCallStatus, MeetingStatus, Prisma } from "generated/prisma/client";
import { UpdateConsultationDto } from "../api/dto/update-consultation.dto";
import { ConsultationQueryDto } from "../api/dto/consultation-query.dto";
import { v4 as uuidv4 } from "uuid";
import { lockExpertBookings } from "src/common/database/expert-booking-lock";

// Preserve existing public user fields, excluding credentials from every consultation response.
const consultationInclude = {
  client: {
    select: {
      id: true,
      firstname: true,
      lastname: true,
      email: true,
      phoneNumber: true,
      roleId: true,
      hasAcceptedTerms: true,
      termsAcceptedAt: true,
      timezone: true,
      countryId: true,
      citizenshipCountryId: true,
      organisationId: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  },
  consultant: { include: { user: { select: { id: true, email: true, firstname: true, lastname: true } } } },
  meeting: true,
} satisfies Prisma.ConsultationInclude;

const expertMeetingInclude = {
  client: {
    select: {
      id: true,
      firstname: true,
      lastname: true,
      email: true,
      timezone: true,
    },
  },
  consultant: {
    include: {
      user: {
        select: {
          id: true,
          firstname: true,
          lastname: true,
          email: true,
          timezone: true,
        },
      },
    },
  },
  meeting: true,
} as const;

/** Persists participant-scoped consultations under the shared expert booking lock. */
@Injectable()
export class ConsultationRepository {
  constructor(private prisma: PrismaService) {}

  /** Builds the consultation and linked meeting as one nested write without credential fields. */
  private createArgs(
    data: CreateConsultationDto & {
      packageId?: number;
      studentId?: number;
      expertId?: number;
    },
  ): Prisma.ConsultationCreateArgs {
    const startTime = new Date(data.startTime);
    const endTime = new Date(data.endTime);
    return {
      data: {
        clientId: data.clientId,
        consultantProfileId: data.consultantId,
        startTime,
        endTime,
        status: data.status,
        meeting: {
          create: {
            roomName: uuidv4(),
            packageId: data.packageId,
            studentId: data.studentId,
            expertId: data.expertId,
            startTime,
            endTime,
            status:
              data.status === ConsultationStatus.CANCELLED ? MeetingStatus.CANCELLED : data.status === ConsultationStatus.DONE ? MeetingStatus.COMPLETED : MeetingStatus.SCHEDULED,
          },
        },
      },
      include: consultationInclude,
    };
  }

  /** Creates a consultation for an authorized actor, rechecking assignment and slot availability atomically. */
  async create(data: CreateConsultationDto, actor: ConsultationActor): Promise<Consultation> {
    consultationScope(actor);
    return leadTransaction(this.prisma, async tx => {
      const expert = await tx.consultantProfile.findUnique({ where: { id: data.consultantId }, select: { userId: true } });
      if (!expert) throw new NotFoundException("Expert profile not found");
      if (actor.roleCode !== "ADMIN") {
        if (actor.roleCode === "EXPERT" ? expert.userId !== actor.id : data.clientId !== actor.id) throw new ForbiddenException("Consultation does not belong to you");
        const portrait = await tx.studentPortrait.findFirst({ where: { userId: data.clientId, consultantProfileId: data.consultantId }, select: { id: true } });
        if (!portrait) throw new ForbiddenException("Student is not assigned to this expert");
        if (actor.roleCode !== "EXPERT" && data.status && data.status !== ConsultationStatus.REQUESTED) throw new ForbiddenException("Students can only request consultations");
      }
      const startTime = new Date(data.startTime),
        endTime = new Date(data.endTime);
      this.assertInterval(startTime, endTime);
      await lockExpertBookings(tx, expert.userId);
      if (data.status !== ConsultationStatus.CANCELLED && (await this.slotOccupied(tx, expert.userId, data.consultantId, startTime, endTime)))
        throw new ConflictException("This expert slot is already booked");
      return tx.consultation.create(this.createArgs(data));
    });
  }

  async findStudentPackage(studentId: number, expertId: number) {
    return this.prisma.studentPackage.findUnique({
      where: {
        studentId_expertId: {
          studentId,
          expertId,
        },
      },
    });
  }

  async findStudentPackageWithExpert(studentId: number, expertId: number) {
    return this.prisma.studentPackage.findUnique({
      where: {
        studentId_expertId: {
          studentId,
          expertId,
        },
      },
      include: {
        expert: {
          include: {
            user: {
              select: {
                id: true,
                timezone: true,
              },
            },
          },
        },
      },
    });
  }

  /** Rechecks participant access and availability during edits, including reactivation of cancelled meetings. */
  async update(id: number, data: UpdateConsultationDto, actor: ConsultationActor, expectedStatus?: ConsultationStatus): Promise<Consultation> {
    const scope = consultationScope(actor);
    return leadTransaction(this.prisma, async tx => {
      const current = await tx.consultation.findFirst({ where: { id, ...scope }, include: { consultant: { select: { userId: true } } } });
      if (!current) throw new NotFoundException("Consultation not found");
      if (expectedStatus && current.status !== expectedStatus) throw new ConflictException("Consultation has already changed");
      if (!["ADMIN", "EXPERT"].includes(actor.roleCode)) {
        if (data.status && data.status !== ConsultationStatus.REQUESTED && data.status !== ConsultationStatus.CANCELLED)
          throw new ForbiddenException("Students cannot confirm or complete consultations");
        if (current.status !== ConsultationStatus.REQUESTED && (data.startTime || data.endTime || data.status === ConsultationStatus.REQUESTED))
          throw new ConflictException("Only a pending consultation can be rescheduled by the student");
      }
      const startTime = data.startTime ? new Date(data.startTime) : current.startTime;
      const endTime = data.endTime ? new Date(data.endTime) : current.endTime;
      const status = data.status ?? current.status;
      this.assertInterval(startTime, endTime);
      await lockExpertBookings(tx, current.consultant.userId);
      if (status !== ConsultationStatus.CANCELLED && (await this.slotOccupied(tx, current.consultant.userId, current.consultantProfileId, startTime, endTime, id)))
        throw new ConflictException("This expert slot is already booked");
      await tx.meeting.updateMany({
        where: { consultationId: id },
        data: {
          startTime,
          endTime,
          status: status === ConsultationStatus.CANCELLED ? MeetingStatus.CANCELLED : status === ConsultationStatus.DONE ? MeetingStatus.COMPLETED : MeetingStatus.SCHEDULED,
        },
      });
      return tx.consultation.update({
        where: { id },
        data: {
          startTime,
          endTime,
          status,
        },
        include: consultationInclude,
      });
    });
  }

  /** Loads a consultation with public participant fields; external callers must supply their identity. */
  async findById(id: number, actor?: ConsultationActor): Promise<Consultation | null> {
    return this.prisma.consultation.findFirst({ where: { id, ...(actor ? consultationScope(actor) : {}) }, include: consultationInclude });
  }

  async findByClientId(clientId: number) {
    return this.prisma.consultation.findMany({
      where: { clientId },
      include: {
        client: { select: { id: true, firstname: true, lastname: true, timezone: true } },
        consultant: { include: { user: { select: { id: true, firstname: true, lastname: true } } } },
        meeting: true,
      },
      orderBy: { startTime: "asc" },
    });
  }

  // async decrementConsultationBalance(portraitId: number) {
  //   return this.prisma.studentPortrait.update({
  //     where: { id: portraitId },
  //     data: { consultationBalance: { decrement: 1 } },
  //   });
  // }

  async findPortraitByUserId(userId: number) {
    return this.prisma.studentPortrait.findUnique({ where: { userId } });
  }

  /** Applies caller visibility together with filters, so query parameters cannot widen access. */
  async findMany(query: ConsultationQueryDto, actor: ConsultationActor) {
    const { clientId, consultantId, status, startDate, endDate, skip, take } = query;

    const where: Prisma.ConsultationWhereInput = { AND: [consultationScope(actor)] };

    if (clientId) where.clientId = clientId;
    if (consultantId) where.consultantProfileId = consultantId;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.startTime = {};
      if (startDate) where.startTime.gte = new Date(startDate);
      if (endDate) where.startTime.lte = new Date(endDate);
    }

    return this.prisma.consultation.findMany({
      where,
      skip,
      take,
      include: consultationInclude,
      orderBy: { startTime: "asc" },
    });
  }

  /** Checks an interval for legacy callers without loading private participant credentials. */
  async findOverlappingConsultation(consultantProfileId: number, startTime: Date, endTime: Date) {
    return this.prisma.consultation.findFirst({
      where: {
        consultantProfileId,
        status: {
          not: ConsultationStatus.CANCELLED,
        },
        startTime: {
          lt: endTime,
        },
        endTime: {
          gt: startTime,
        },
      },
      include: consultationInclude,
    });
  }

  /** Books an assigned student consultation and consumes its package slot under the shared transaction lock. */
  async createIfExpertAvailable(
    data: CreateConsultationDto & {
      packageId?: number;
      studentId?: number;
      expertId?: number;
      expertUserId: number;
    },
  ) {
    return leadTransaction(this.prisma, async tx => {
      await lockExpertBookings(tx, data.expertUserId);
      const startTime = new Date(data.startTime),
        endTime = new Date(data.endTime);
      this.assertInterval(startTime, endTime);
      if (await this.slotOccupied(tx, data.expertUserId, data.consultantId, startTime, endTime)) return null;

      const created = await tx.consultation.create(this.createArgs(data));

      if (data.packageId != null) {
        await tx.studentPackage.update({
          where: { id: data.packageId },
          data: { usedSlots: { increment: 1 } },
        });
      }

      return created;
    });
  }

  /** Rejects invalid or reversed intervals before reading or reserving availability. */
  private assertInterval(startTime: Date, endTime: Date) {
    if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || startTime >= endTime)
      throw new BadRequestException("startTime must be earlier than endTime");
  }

  /** Checks ordinary and CRM bookings while the caller holds the expert transaction lock. */
  private async slotOccupied(tx: Prisma.TransactionClient, expertUserId: number, profileId: number, startTime: Date, endTime: Date, excludeId?: number) {
    const consultation = await tx.consultation.findFirst({
      where: {
        consultantProfileId: profileId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        status: { not: ConsultationStatus.CANCELLED },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
      select: { id: true },
    });
    if (consultation) return true;
    return !!(await tx.leadExpertCall.findFirst({
      where: { expertUserId, status: { in: [LeadExpertCallStatus.REQUESTED, LeadExpertCallStatus.CONFIRMED] }, startTime: { lt: endTime }, endTime: { gt: startTime } },
      select: { id: true },
    }));
  }

  async findByConsultantProfileId(consultantProfileId: number, query: ConsultationQueryDto) {
    const { status, startDate, endDate, skip, take, clientId } = query;

    const where: Prisma.ConsultationWhereInput = {
      consultantProfileId,
    };

    if (clientId != null) where.clientId = clientId;

    if (status) where.status = status;

    if (startDate || endDate) {
      where.startTime = {};
      if (startDate) where.startTime.gte = new Date(startDate);
      if (endDate) where.startTime.lte = new Date(endDate);
    }

    return this.prisma.consultation.findMany({
      where,
      skip,
      take,
      include: expertMeetingInclude,
      orderBy: { startTime: "asc" },
    });
  }

  async findPendingByConsultantProfileId(consultantProfileId: number) {
    return this.prisma.consultation.findMany({
      where: {
        consultantProfileId,
        status: ConsultationStatus.REQUESTED,
      },
      include: expertMeetingInclude,
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
    });
  }

  async findHistoryPageByConsultantProfileId(consultantProfileId: number, page: number, limit: number) {
    const where: Prisma.ConsultationWhereInput = {
      consultantProfileId,
      status: { not: ConsultationStatus.REQUESTED },
    };

    const [data, totalItems] = await Promise.all([
      this.prisma.consultation.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: expertMeetingInclude,
        orderBy: [{ startTime: "desc" }, { id: "desc" }],
      }),
      this.prisma.consultation.count({ where }),
    ]);

    return { data, totalItems };
  }

  async findConsultantProfileByUserId(userId: number) {
    return this.prisma.consultantProfile.findUnique({
      where: { userId },
    });
  }

  async findConsultantProfileWithUserById(consultantProfileId: number) {
    return this.prisma.consultantProfile.findUnique({
      where: { id: consultantProfileId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            timezone: true,
            firstname: true,
            lastname: true,
            phoneNumber: true,
          },
        },
      },
    });
  }

  async findExpertScheduleByUserIdAndDay(expertUserId: number, dayOfWeek: number) {
    return this.prisma.expertSchedule.findMany({
      where: {
        expertId: expertUserId,
        dayOfWeek,
      },
      orderBy: {
        startMinute: "asc",
      },
    });
  }
}
