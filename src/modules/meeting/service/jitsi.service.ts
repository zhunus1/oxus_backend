import { ConfigService } from "@nestjs/config";
import { GenerateJitsiTokenDto } from "../api/dto/generate-jitsi-token.dto";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import messages from "src/configs/messages";
import { MeetingRepository } from "../repository/meeting.repository";
import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

/** Signs Jitsi/JaaS meeting tokens for authenticated users and CRM guests. */
@Injectable()
export class JitsiService {
  private readonly privateKey: Buffer;
  private readonly entity = "Meeting";
  private readonly logger = new Logger(JitsiService.name);

  constructor(
    private readonly repo: MeetingRepository,
    private readonly configService: ConfigService,
    private readonly userJourneyLog: UserJourneyLogService,
  ) {
    const privateKeyPath = this.configService.get<string>("JITSI_PRIVATE_KEY_PATH", "src/assets/jitsi-private-key.pk");
    this.privateKey = fs.readFileSync(privateKeyPath);
    if (!this.configService.get<string>("JAAS_API_KEY_ID")) {
      throw new Error("JAAS_API_KEY_ID env variable is not set");
    }
    if (!this.configService.get<string>("JITSI_APP_ID")) {
      throw new Error("JITSI_APP_ID env variable is not set");
    }
  }

  /** Signs a room-specific CRM token with explicit moderator rights and a bounded expiry. */
  signLeadRoomToken(roomName: string, user: { id: string; name: string }, moderator: boolean, expiresAt: Date) {
    const appId = this.configService.getOrThrow<string>("JITSI_APP_ID");
    const rawKeyId = this.configService.getOrThrow<string>("JAAS_API_KEY_ID");
    const kid = rawKeyId.includes("/") ? rawKeyId : `${appId}/${rawKeyId}`;
    const token = jwt.sign(
      {
        aud: "jitsi",
        iss: "chat",
        sub: appId,
        room: roomName,
        context: { user: { ...user, moderator: moderator ? "true" : "false" }, features: { recording: false, livestreaming: false } },
        exp: Math.floor(expiresAt.getTime() / 1000),
      },
      this.privateKey,
      { algorithm: "RS256", header: { alg: "RS256", kid } },
    );
    return { appId, roomName, jwt: token, role: moderator ? "moderator" : "participant", expiresAt };
  }

  async generateToken(id: string, data: GenerateJitsiTokenDto) {
    try {
      const meeting = await this.repo.findById(id);

      if (!meeting) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      }

      const consultation = meeting.consultation;

      if (!consultation) {
        throw new NotFoundException(messages.NOT_FOUND("Consultation"));
      }

      const isStudent = consultation.clientId === data.userId;
      const isExpert = consultation.consultant.user.id === data.userId;

      if (!isStudent && !isExpert) {
        throw new ForbiddenException("You do not have access to this meeting");
      }

      const now = new Date();
      const startTime = new Date(consultation.startTime);
      const accessFrom = new Date(startTime.getTime() - 10 * 60 * 1000);
      // const accessFrom = new Date(startTime.getTime() - 3 * 24 * 60 * 60 * 1000);

      if (now < accessFrom) {
        throw new ForbiddenException("Meeting access is available only 10 minutes before start time");
      }

      const role: "moderator" | "participant" = isExpert ? "moderator" : "participant";
      const appId = this.configService.get<string>("JITSI_APP_ID");

      const payload = {
        aud: "jitsi",
        iss: "chat",
        sub: appId,
        room: meeting.roomName,
        context: {
          user: {
            id: String(data.userId),
            name: data.userName,
            avatar: data.userAvatar,
            moderator: isExpert ? "true" : "false",
          },
          features: {
            recording: true,
            livestreaming: true,
          },
        },
        exp: Math.floor(Date.now() / 1000) + 7200,
      };

      const rawKeyId = this.configService.get<string>("JAAS_API_KEY_ID") ?? "";
      const kid = rawKeyId.includes("/") ? rawKeyId : `${appId}/${rawKeyId}`;

      const jwtToken = jwt.sign(payload, this.privateKey, {
        algorithm: "RS256",
        header: { alg: "RS256", kid },
      });

      if (isStudent) {
        void this.userJourneyLog.logEvent(data.userId, USER_JOURNEY_EVENT.MEETING_JOINED, {
          meetingId: id,
          roomName: meeting.roomName,
        });
      }

      return {
        roomName: meeting.roomName,
        jwt: jwtToken,
        role,
      };
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) {
        throw err;
      }

      this.logger.error(err);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id));
    }
  }
}
