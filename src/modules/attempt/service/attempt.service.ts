import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AttemptRepository } from "../repository/attempt.repository";
import { AttemptEntity } from "../api/dto/attempt.entity";
import { InternalServerErrorException } from "@nestjs/common";
import messages from "src/configs/messages";
import { CreateAttemptDto } from "../api/dto/create-attempt.dto";
import { UpdateAttemptDto } from "../api/dto/update-attempt.dto";
import { QuestionService } from "src/modules/question/service/question.service";
import { ResponseRepository } from "src/modules/response/repository/response.repository";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { EventService } from "src/modules/event/service/event.service";
import { StudentPortraitService } from "src/modules/studentportrait/service/studentportrait.service";

@Injectable()
export class AttemptService {
  private readonly entity = "Attempt";
  private readonly logger = new Logger(AttemptService.name);

  constructor(
    private readonly repo: AttemptRepository,
    private readonly questionService: QuestionService,
    private readonly responseRepo: ResponseRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly eventService: EventService,
    private readonly portraitService: StudentPortraitService,
  ) {}

  async create(testId: number, dto: CreateAttemptDto): Promise<AttemptEntity> {
    try {
      return await this.repo.create(testId, dto);
    } catch (err) {
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async findAll(testId: number): Promise<AttemptEntity[]> {
    try {
      return await this.repo.findAll(testId);
    } catch (err) {
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async findById(id: string): Promise<AttemptEntity> {
    try {
      const attempt = await this.repo.findById(id);
      if (!attempt) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      return attempt;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async updateById(id: string, dto: UpdateAttemptDto): Promise<AttemptEntity> {
    try {
      const attempt = await this.findById(id);

      if (dto.userId != null && attempt.userId != null) {
        throw new BadRequestException("userId is already assigned to this attempt");
      }

      return await this.repo.updateById(id, dto);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async submit(id: string): Promise<{ accessToken: string }> {
    try {
      const attempt = await this.findById(id);

      if (attempt.submittedAt || attempt.userId != null) {
        throw new BadRequestException("Attempt has already been submitted");
      }

      const questions = await this.questionService.findAll(attempt.testId);
      const requiredQuestions = questions.filter(q => q.required);

      const responses = await this.responseRepo.findAllByAttemptId(id);
      const answeredQuestionIds = new Set(responses.map(r => r.questionId));

      const unanswered = requiredQuestions.filter(q => !answeredQuestionIds.has(q.id));
      if (unanswered.length > 0) {
        const unansweredOrders = unanswered.map(q => q.order).join(", ");
        throw new BadRequestException(`Not all required questions have been answered. Missing questions: ${unansweredOrders}`);
      }

      const submitted = await this.repo.submit(id);

      const payload = {
        attemptId: submitted.id,
        testId: submitted.testId,
        submittedAt: submitted.submittedAt,
      };

      const accessToken = await this.jwtService.signAsync(payload, {
        secret: this.configService.get("JWT_SECRET"),
        expiresIn: "2h",
      });

      return { accessToken };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async assignUser(attemptAccessToken: string, userId: number): Promise<void> {
    try {
      const payload = this.jwtService.verify(attemptAccessToken, {
        secret: this.configService.get("JWT_SECRET"),
      });

      const attemptId: string = payload.attemptId;
      if (!attemptId) {
        throw new BadRequestException("Invalid attempt access token");
      }

      const attempt = await this.findById(attemptId);

      if (attempt.userId != null) {
        throw new BadRequestException("userId is already assigned to this attempt");
      }

      await this.repo.updateById(attemptId, { userId });

      await this.assignEventSource(attempt.testId, userId);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error("Error assigning user to attempt", err.stack);
      throw new BadRequestException("Invalid or expired attempt access token");
    }
  }

  private async assignEventSource(testId: number, userId: number): Promise<void> {
    try {
      const event = await this.eventService.findByTestId(testId);
      if (!event) return;

      const consultantProfileId = event.speaker?.consultantProfile?.id ?? null;
      await this.portraitService.assignEventSource(userId, event.id, consultantProfileId);
    } catch (err) {
      this.logger.error(`Error assigning event source for user ${userId}, testId ${testId}: ${err}`);
    }
  }
}
