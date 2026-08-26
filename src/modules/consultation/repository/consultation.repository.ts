import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { CreateConsultationDto } from "../api/dto/create-consultation.dto";
import { Consultation, ConsultationStatus, LeadExpertCallStatus, MeetingStatus, Prisma } from "generated/prisma/client";
import { UpdateConsultationDto } from "../api/dto/update-consultation.dto";
import { ConsultationQueryDto } from "../api/dto/consultation-query.dto";
import { v4 as uuidv4 } from "uuid";
import { lockExpertBookings } from "src/common/database/expert-booking-lock";

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

@Injectable()
export class ConsultationRepository {
  constructor(private prisma: PrismaService) {}

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
            status: MeetingStatus.SCHEDULED,
          },
        },
      },
      include: {
        client: true,
        consultant: true,
        meeting: true,
      },
    };
  }

  async create(
    data: CreateConsultationDto & {
      packageId?: number;
      studentId?: number;
      expertId?: number;
    },
  ): Promise<Consultation> {
    return this.prisma.consultation.create(this.createArgs(data));
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

  async update(id: number, data: UpdateConsultationDto): Promise<Consultation> {
    const updateData: Prisma.ConsultationUpdateInput = {};
    if (data.startTime) updateData.startTime = new Date(data.startTime);
    if (data.endTime) updateData.endTime = new Date(data.endTime);
    if (data.status) updateData.status = data.status;

    return this.prisma.consultation.update({
      where: { id },
      data: updateData,
      include: {
        client: true,
        consultant: true,
        meeting: true,
      },
    });
  }

  async findById(id: number): Promise<Consultation | null> {
    return this.prisma.consultation.findUnique({
      where: { id },
      include: {
        client: true,
        consultant: true,
        meeting: true,
      },
    });
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

  async findMany(query: ConsultationQueryDto) {
    const { clientId, consultantId, status, startDate, endDate, skip, take } = query;

    const where: Prisma.ConsultationWhereInput = {};

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
      include: {
        client: true,
        consultant: true,
        meeting: true,
      },
      orderBy: { startTime: "asc" },
    });
  }

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
      include: {
        client: true,
        consultant: true,
        meeting: true,
      },
    });
  }

  async createIfExpertAvailable(
    data: CreateConsultationDto & {
      packageId?: number;
      studentId?: number;
      expertId?: number;
      expertUserId: number;
    },
  ) {
    return this.prisma.$transaction(async tx => {
      await lockExpertBookings(tx, data.expertUserId);

      const startTime = new Date(data.startTime);
      const endTime = new Date(data.endTime);
      const [consultation, leadCall] = await Promise.all([
        tx.consultation.findFirst({
          where: {
            consultantProfileId: data.consultantId,
            status: { not: ConsultationStatus.CANCELLED },
            startTime: { lt: endTime },
            endTime: { gt: startTime },
          },
        }),
        tx.leadExpertCall.findFirst({
          where: {
            expertUserId: data.expertUserId,
            status: { in: [LeadExpertCallStatus.REQUESTED, LeadExpertCallStatus.CONFIRMED] },
            startTime: { lt: endTime },
            endTime: { gt: startTime },
          },
        }),
      ]);

      if (consultation || leadCall) return null;

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
