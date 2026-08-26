import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { Prisma, Meeting } from "generated/prisma/client";

@Injectable()
export class MeetingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.MeetingCreateInput): Promise<Meeting> {
    return this.prisma.meeting.create({ data });
  }

  async findAll(args: { where?: Prisma.MeetingWhereInput; skip?: number; take?: number }): Promise<Meeting[]> {
    const { where, skip, take } = args;
    return this.prisma.meeting.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string) {
    return this.prisma.meeting.findUnique({
      where: { id },
      include: {
        consultation: {
          include: {
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
          },
        },
      },
    });
  }

  async updateById(id: string, data: Prisma.MeetingUpdateInput): Promise<Meeting> {
    return this.prisma.meeting.update({ where: { id }, data });
  }
}
