import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import type { UserJourneyEventType } from "./user-journey.constants";

@Injectable()
export class UserJourneyLogService {
  private readonly logger = new Logger(UserJourneyLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Запись события пути. Ошибки логируются и не ломают основной сценарий.
   */
  async logEvent(userId: number, eventType: UserJourneyEventType | string, eventData?: Prisma.InputJsonValue): Promise<void> {
    try {
      await this.prisma.userJourneyEvent.create({
        data: {
          userId,
          eventType,
          ...(eventData !== undefined ? { eventData } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(`UserJourneyLog failed userId=${userId} type=${eventType}: ${err}`);
    }
  }
}
