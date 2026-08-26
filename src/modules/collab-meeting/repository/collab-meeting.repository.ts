import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";

const MEETING_INCLUDE = {
  createdBy: { select: { id: true, firstname: true, lastname: true, email: true } },
  invitees: {
    include: {
      user: { select: { id: true, firstname: true, lastname: true, email: true } },
    },
  },
  todos: {
    include: {
      createdBy: { select: { id: true, firstname: true, lastname: true } },
      assignee: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
};

@Injectable()
export class CollabMeetingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    id: string;
    roomName: string;
    title: string;
    startTime: Date;
    endTime: Date;
    createdById: number;
    inviteeUserIds: number[];
    isRecurring?: boolean;
    recurringGroupId?: string;
  }) {
    return this.prisma.collabMeeting.create({
      data: {
        id: data.id,
        roomName: data.roomName,
        title: data.title,
        startTime: data.startTime,
        endTime: data.endTime,
        createdById: data.createdById,
        isRecurring: data.isRecurring ?? false,
        recurringGroupId: data.recurringGroupId,
        invitees: {
          create: data.inviteeUserIds.map(userId => ({ userId })),
        },
      },
      include: MEETING_INCLUDE,
    });
  }

  async findAllForUser(userId: number) {
    return this.prisma.collabMeeting.findMany({
      where: {
        OR: [{ createdById: userId }, { invitees: { some: { userId } } }],
      },
      include: MEETING_INCLUDE,
      orderBy: { startTime: "asc" },
    });
  }

  async findById(id: string, callerUserId: number) {
    return this.prisma.collabMeeting.findUnique({
      where: { id },
      include: {
        ...MEETING_INCLUDE,
        notes: {
          where: { authorId: callerUserId },
          select: { content: true, updatedAt: true },
        },
      },
    });
  }

  async updateStatus(id: string, status: "SCHEDULED" | "COMPLETED" | "CANCELLED") {
    return this.prisma.collabMeeting.update({
      where: { id },
      data: { status },
    });
  }

  async upsertNote(collabMeetingId: string, authorId: number, content: string) {
    return this.prisma.collabMeetingNote.upsert({
      where: { collabMeetingId_authorId: { collabMeetingId, authorId } },
      create: { collabMeetingId, authorId, content },
      update: { content },
    });
  }

  async createTodo(data: { collabMeetingId: string; createdById: number; text: string; assigneeId?: number }) {
    return this.prisma.collabMeetingTodo.create({
      data,
      include: {
        createdBy: { select: { id: true, firstname: true, lastname: true } },
        assignee: { select: { id: true, firstname: true, lastname: true } },
      },
    });
  }

  async updateTodo(id: number, data: { text?: string; completed?: boolean }) {
    return this.prisma.collabMeetingTodo.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, firstname: true, lastname: true } },
        assignee: { select: { id: true, firstname: true, lastname: true } },
      },
    });
  }

  async deleteTodo(id: number) {
    return this.prisma.collabMeetingTodo.delete({ where: { id } });
  }

  async findTodoById(id: number) {
    return this.prisma.collabMeetingTodo.findUnique({ where: { id } });
  }

  async addInvitees(collabMeetingId: string, userIds: number[]) {
    await this.prisma.collabMeetingInvitee.createMany({
      data: userIds.map(userId => ({ collabMeetingId, userId })),
      skipDuplicates: true,
    });
    return this.prisma.collabMeeting.findUnique({
      where: { id: collabMeetingId },
      include: MEETING_INCLUDE,
    });
  }

  async findInvitableUsers() {
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        role: { code: { in: ["EXPERT", "ADMIN"] } },
      },
      select: { id: true, firstname: true, lastname: true, email: true, role: { select: { code: true } } },
      orderBy: [{ firstname: "asc" }, { lastname: "asc" }],
    });
  }
}
