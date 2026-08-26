import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { v4 as uuid } from "uuid";
import { ConfigService } from "@nestjs/config";
import fs from "node:fs";
import jwt from "jsonwebtoken";

import messages from "src/configs/messages";
import { CollabMeetingRepository } from "../repository/collab-meeting.repository";
import { CreateCollabMeetingDto } from "../api/dto/create-collab-meeting.dto";
import { CreateCollabTodoDto } from "../api/dto/create-collab-todo.dto";
import { UpdateCollabTodoDto } from "../api/dto/update-collab-todo.dto";

@Injectable()
export class CollabMeetingService {
  private readonly entity = "CollabMeeting";
  private readonly logger = new Logger(CollabMeetingService.name);
  private readonly privateKey: Buffer;

  constructor(
    private readonly repo: CollabMeetingRepository,
    private readonly configService: ConfigService,
    @InjectQueue("mail") private readonly mailQueue: Queue,
  ) {
    const privateKeyPath = this.configService.get<string>("JITSI_PRIVATE_KEY_PATH", "src/assets/jitsi-private-key.pk");
    this.privateKey = fs.readFileSync(privateKeyPath);
  }

  async create(creatorUserId: number, creatorName: string, dto: CreateCollabMeetingDto) {
    try {
      const dashboardUrl = this.configService.get<string>("EXPERT_DASHBOARD_URL") ?? "https://expert.oxusedu.com/collab-meetings";
      const jitsiAppId = this.configService.get<string>("JITSI_APP_ID") ?? "";
      const jitsiDomain = this.configService.get<string>("JITSI_DOMAIN") ?? "8x8.vc";

      const isRecurring = dto.isRecurring ?? false;
      const weeks = isRecurring ? Math.max(2, Math.min(12, dto.recurrenceWeeks ?? 4)) : 1;
      const recurringGroupId = isRecurring ? uuid() : undefined;

      const meetings: Awaited<ReturnType<typeof this.repo.create>>[] = [];
      for (let i = 0; i < weeks; i++) {
        const id = uuid();
        const roomName = `collab-${id}`;
        const offsetMs = i * 7 * 24 * 60 * 60 * 1000;
        const startTime = new Date(new Date(dto.startTime).getTime() + offsetMs);
        const endTime = new Date(new Date(dto.endTime).getTime() + offsetMs);

        const meeting = await this.repo.create({
          id,
          roomName,
          title: dto.title,
          startTime,
          endTime,
          createdById: creatorUserId,
          inviteeUserIds: dto.inviteeUserIds,
          isRecurring,
          recurringGroupId,
        });
        meetings.push(meeting);

        // Only send invite emails for the first occurrence
        if (i === 0) {
          const jitsiUrl = `https://${jitsiDomain}/${jitsiAppId}/${roomName}`;
          for (const invitee of meeting.invitees) {
            void this.mailQueue.add(
              "collab-invite",
              {
                to: invitee.user.email,
                inviteeName: `${invitee.user.firstname} ${invitee.user.lastname}`.trim(),
                inviterName: creatorName,
                meetingTitle: dto.title,
                startTime,
                dashboardUrl: `${dashboardUrl}/${id}`,
                jitsiUrl,
              },
              { removeOnComplete: true },
            );
          }
        }
      }

      return meetings[0];
    } catch (err) {
      if (err instanceof Error && "status" in err) throw err;
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async listForUser(userId: number) {
    try {
      return await this.repo.findAllForUser(userId);
    } catch (err) {
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async getDetail(id: string, callerUserId: number) {
    try {
      // Collab meetings are internal staff meetings — every endpoint is already
      // restricted to EXPERT/ADMIN by RolesGuard. Any such user may view the
      // meeting and its shared todos; notes are filtered to the caller (authorId)
      // inside the repository, so they stay private per user.
      const meeting = await this.repo.findById(id, callerUserId);
      if (!meeting) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));

      return meeting;
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id), err);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id));
    }
  }

  async updateStatus(id: string, callerUserId: number, status: "SCHEDULED" | "COMPLETED" | "CANCELLED") {
    try {
      const meeting = await this.repo.findById(id, callerUserId);
      if (!meeting) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));

      return await this.repo.updateStatus(id, status);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entity), err);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entity));
    }
  }

  async upsertNote(id: string, authorId: number, content: string) {
    try {
      const meeting = await this.repo.findById(id, authorId);
      if (!meeting) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));

      return await this.repo.upsertNote(id, authorId, content);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entity), err);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entity));
    }
  }

  async createTodo(id: string, createdById: number, dto: CreateCollabTodoDto) {
    try {
      const meeting = await this.repo.findById(id, createdById);
      if (!meeting) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));

      return await this.repo.createTodo({ collabMeetingId: id, createdById, text: dto.text, assigneeId: dto.assigneeId });
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async updateTodo(meetingId: string, todoId: number, callerUserId: number, dto: UpdateCollabTodoDto) {
    try {
      const todo = await this.repo.findTodoById(todoId);
      if (!todo || todo.collabMeetingId !== meetingId) throw new NotFoundException(messages.NOT_FOUND_BY_ID("Todo", todoId));

      const meeting = await this.repo.findById(meetingId, callerUserId);
      if (!meeting) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, meetingId));

      return await this.repo.updateTodo(todoId, dto);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entity), err);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entity));
    }
  }

  async deleteTodo(meetingId: string, todoId: number) {
    try {
      const todo = await this.repo.findTodoById(todoId);
      if (!todo || todo.collabMeetingId !== meetingId) throw new NotFoundException(messages.NOT_FOUND_BY_ID("Todo", todoId));

      return await this.repo.deleteTodo(todoId);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_DELETE_ERROR(this.entity, todoId), err);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR(this.entity, todoId));
    }
  }

  async addInvitees(id: string, userIds: number[]) {
    try {
      const meeting = await this.repo.findById(id, 0);
      if (!meeting) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      return await this.repo.addInvitees(id, userIds);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entity), err);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entity));
    }
  }

  async getInvitableUsers() {
    try {
      return await this.repo.findInvitableUsers();
    } catch (err) {
      this.logger.error(messages.DATABASE_FETCH_ERROR("User"), err);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("User"));
    }
  }

  async getAccess(id: string, callerUserId: number, callerName: string) {
    try {
      const meeting = await this.repo.findById(id, callerUserId);
      if (!meeting) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));

      const isModerator = meeting.createdById === callerUserId;
      const appId = this.configService.get<string>("JITSI_APP_ID");
      const jitsiDomain = this.configService.get<string>("JITSI_DOMAIN") ?? "8x8.vc";

      const payload = {
        aud: "jitsi",
        iss: "chat",
        sub: appId,
        room: meeting.roomName,
        context: {
          user: {
            id: String(callerUserId),
            name: callerName,
            avatar: "",
            moderator: isModerator ? "true" : "false",
          },
          features: { recording: true, livestreaming: true },
        },
        exp: Math.floor(Date.now() / 1000) + 7200,
      };

      const rawKeyId = this.configService.get<string>("JAAS_API_KEY_ID") ?? "";
      const kid = rawKeyId.includes("/") ? rawKeyId : `${appId}/${rawKeyId}`;

      const jwtToken = jwt.sign(payload, this.privateKey, {
        algorithm: "RS256",
        header: { alg: "RS256", kid },
      });

      const jitsiUrl = `https://${jitsiDomain}/${appId}/${meeting.roomName}`;
      return { roomName: meeting.roomName, jwt: jwtToken, role: isModerator ? "moderator" : "participant", jitsiUrl };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error("Failed to generate collab meeting access token", err);
      throw new InternalServerErrorException("Failed to generate access token");
    }
  }
}
