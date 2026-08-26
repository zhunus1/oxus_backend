import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { CreateEventDto } from "../api/dto/create-event.dto";
import { Event as EventModel, Prisma } from "generated/prisma/client";
import { AttemptStatus } from "generated/prisma/enums";
import { UpdateEventDto } from "../api/dto/update-event.dto";
import { QueryEventDto } from "../api/dto/query-event.dto";

@Injectable()
export class EventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBySlug(slug: string): Promise<EventModel | null> {
    return this.prisma.event.findUnique({ where: { slug } });
  }

  async findByTestId(testId: number) {
    return this.prisma.event.findFirst({
      where: { testId },
      include: {
        speaker: {
          include: {
            consultantProfile: { select: { id: true } },
          },
        },
      },
    });
  }

  async findById(id: number): Promise<EventModel | null> {
    return this.prisma.event.findUnique({ where: { id } });
  }

  async create(createEventDto: CreateEventDto, speakerId: number): Promise<EventModel> {
    const { title, slug, eventDate, location, isActive, testId, promoCodeId } = createEventDto;
    return this.prisma.event.create({
      data: {
        title,
        slug,
        eventDate: new Date(eventDate),
        location,
        isActive,
        testId,
        speakerId,
        promoCodeId,
      },
    });
  }

  async updateById(id: number, updateEventDto: UpdateEventDto): Promise<EventModel> {
    const updateData: Prisma.EventUpdateInput = {};
    if (updateEventDto.title !== undefined) updateData.title = updateEventDto.title;
    if (updateEventDto.slug !== undefined) updateData.slug = updateEventDto.slug;
    if (updateEventDto.eventDate !== undefined) updateData.eventDate = new Date(updateEventDto.eventDate);
    if (updateEventDto.location !== undefined) updateData.location = updateEventDto.location;
    if (updateEventDto.isActive !== undefined) updateData.isActive = updateEventDto.isActive;
    if (updateEventDto.testId !== undefined) updateData.test = { connect: { id: updateEventDto.testId } };
    if (updateEventDto.promoCodeId !== undefined) updateData.promoCode = { connect: { id: updateEventDto.promoCodeId } };

    return this.prisma.event.update({
      where: { id },
      data: updateData,
    });
  }

  async findLeadsByEventId(eventId: number) {
    return this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        leadsGenerated: {
          include: {
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                email: true,
                phoneNumber: true,
                createdAt: true,
              },
            },
          },
        },
        test: {
          include: {
            attempts: {
              where: { status: AttemptStatus.SUBMITTED },
              include: {
                responses: {
                  include: {
                    question: { select: { order: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async findLeadAnswers(eventId: number, userId: number) {
    return this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        test: {
          include: {
            attempts: {
              where: { userId },
              orderBy: { createdAt: "desc" as const },
              include: {
                responses: {
                  orderBy: { questionId: "asc" as const },
                  include: {
                    question: {
                      include: {
                        options: {
                          orderBy: { order: "asc" as const },
                          select: { id: true, order: true, text: true },
                        },
                      },
                    },
                    option: {
                      select: { id: true, order: true, text: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async findAllLeadsBySpeakerId(speakerId: number) {
    return this.prisma.event.findMany({
      where: { speakerId },
      select: {
        id: true,
        title: true,
        leadsGenerated: {
          include: {
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                email: true,
                phoneNumber: true,
                createdAt: true,
                studentContracts: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: { status: true },
                },
              },
            },
          },
        },
        test: {
          include: {
            attempts: {
              where: { status: AttemptStatus.SUBMITTED },
              include: {
                responses: {
                  include: {
                    question: { select: { order: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async findAll(queryEventDto: QueryEventDto): Promise<EventModel[]> {
    const { search, dateFrom, dateTo, isActive, take, skip } = queryEventDto;
    const where: Prisma.EventWhereInput = {};

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }

    if (dateFrom || dateTo) {
      where.eventDate = {};
      if (dateFrom) where.eventDate.gte = new Date(dateFrom);
      if (dateTo) where.eventDate.lte = new Date(dateTo);
    }
    if (isActive !== undefined) where.isActive = isActive;

    return this.prisma.event.findMany({
      where,
      skip,
      take,
      orderBy: { eventDate: "desc" },
    });
  }
}
