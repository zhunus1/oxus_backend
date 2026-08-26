import { Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { EventRepository } from "../repository/event.repository";
import { QueryEventDto } from "../api/dto/query-event.dto";
import messages from "src/configs/messages";
import { CreateEventDto } from "../api/dto/create-event.dto";
import { UpdateEventDto } from "../api/dto/update-event.dto";
import { TestService } from "src/modules/test/service/test.service";
import { CreateTestDto } from "src/modules/test/api/dto/create-test.dto";
import { UpdateTestDto } from "src/modules/test/api/dto/update-test.dto";
import { QuestionService } from "src/modules/question/service/question.service";
import { CreateQuestionDto } from "src/modules/question/api/dto/create-question.dto";
import { UpdateQuestionDto } from "src/modules/question/api/dto/update-question.dto";
import { ConfigService } from "@nestjs/config";
import QRCode from "qrcode";
import { StudentPortraitService } from "src/modules/studentportrait/service/studentportrait.service";

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);
  private readonly entityName = "Event";

  constructor(
    private readonly eventRepository: EventRepository,
    private readonly testService: TestService,
    private readonly questionService: QuestionService,
    private readonly configService: ConfigService,
    private readonly studentPortraitService: StudentPortraitService,
  ) {}

  async findAll(queryEventDto: QueryEventDto) {
    try {
      const events = await this.eventRepository.findAll(queryEventDto);
      return Promise.all(
        events.map(async event => ({
          ...event,
          qrCode: await this.toQrCodeBase64(this.buildEventQrUrl(event.slug)),
        })),
      );
    } catch (error) {
      this.logger.error(`Error fetching events: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findById(id: number) {
    const event = await this.eventRepository.findById(id);
    if (!event) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
    }
    const eventUrl = this.buildEventQrUrl(event.slug);
    return {
      ...event,
      qrCode: await this.toQrCodeBase64(eventUrl),
    };
  }

  async findBySlug(slug: string) {
    const event = await this.eventRepository.findBySlug(slug);
    if (!event) {
      throw new NotFoundException(messages.NOT_FOUND_BY_FIELD(this.entityName, slug));
    }
    return event;
  }

  async findByTestId(testId: number) {
    return this.eventRepository.findByTestId(testId);
  }

  async create(createEventDto: CreateEventDto, expertUserId: number) {
    try {
      return await this.eventRepository.create(createEventDto, expertUserId);
    } catch (error) {
      this.logger.error(`Error creating event: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  async updateById(id: number, updateEventDto: UpdateEventDto) {
    try {
      const existEvent = await this.eventRepository.findById(id);
      if (!existEvent) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, id));
      }
      return await this.eventRepository.updateById(id, updateEventDto);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error updating event: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entityName, id));
    }
  }

  async createTest(id: number, createTestDto: CreateTestDto) {
    try {
      await this.findById(id);
      const test = await this.testService.create(createTestDto);
      await this.eventRepository.updateById(id, { testId: test.id });
      return test;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error creating test for event: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("Test"));
    }
  }

  async updateTest(id: number, updateTestDto: UpdateTestDto) {
    const event = await this.findById(id);
    if (!event.testId) {
      throw new NotFoundException(messages.NOT_FOUND_BY_FIELD("Test for event", `eventId=${id}`));
    }
    return this.testService.updateById(event.testId, updateTestDto);
  }

  async createQuestion(id: number, createQuestionDto: CreateQuestionDto) {
    const event = await this.findById(id);
    if (!event.testId) {
      throw new NotFoundException(messages.NOT_FOUND_BY_FIELD("Test for event", `eventId=${id}`));
    }
    return this.questionService.create(event.testId, createQuestionDto);
  }

  async updateQuestion(id: number, questionId: number, updateQuestionDto: UpdateQuestionDto) {
    const event = await this.findById(id);
    if (!event.testId) {
      throw new NotFoundException(messages.NOT_FOUND_BY_FIELD("Test for event", `eventId=${id}`));
    }
    return this.questionService.updateById(event.testId, questionId, updateQuestionDto);
  }

  async findLeads(eventId: number) {
    try {
      const event = await this.eventRepository.findLeadsByEventId(eventId);
      if (!event) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, eventId));
      }

      const registeredLeads = event.leadsGenerated.map(lead => ({
        portraitId: lead.id,
        userId: lead.user.id,
        registeredAt: lead.user.createdAt,
        firstname: lead.user.firstname,
        lastname: lead.user.lastname,
        email: lead.user.email,
        phoneNumber: lead.user.phoneNumber,
      }));

      const testLeads = (event.test?.attempts ?? []).map(attempt => {
        const byOrder = (order: number) => attempt.responses.find(r => r.question.order === order)?.valueText ?? null;

        const fullName = byOrder(1);
        const spaceIdx = fullName?.indexOf(" ") ?? -1;
        const firstname = spaceIdx > 0 ? fullName!.slice(0, spaceIdx) : fullName;
        const lastname = spaceIdx > 0 ? fullName!.slice(spaceIdx + 1) : null;

        return {
          attemptId: attempt.id,
          submittedAt: attempt.submittedAt,
          firstname,
          lastname,
          phoneNumber: byOrder(2),
          email: byOrder(3),
        };
      });

      return { registeredLeads, testLeads };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching leads for event ${eventId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findAllLeads(expertUserId: number) {
    try {
      const events = await this.eventRepository.findAllLeadsBySpeakerId(expertUserId);

      const registeredLeads = events.flatMap(event =>
        event.leadsGenerated.map(lead => ({
          eventId: event.id,
          eventTitle: event.title,
          portraitId: lead.id,
          userId: lead.user.id,
          registeredAt: lead.user.createdAt,
          firstname: lead.user.firstname,
          lastname: lead.user.lastname,
          email: lead.user.email,
          phoneNumber: lead.user.phoneNumber,
          contractStatus: lead.user.studentContracts?.[0]?.status ?? null,
        })),
      );

      const testLeads = events.flatMap(event =>
        (event.test?.attempts ?? []).map(attempt => {
          const byOrder = (order: number) => attempt.responses.find(r => r.question.order === order)?.valueText ?? null;

          const fullName = byOrder(1);
          const spaceIdx = fullName?.indexOf(" ") ?? -1;
          const firstname = spaceIdx > 0 ? fullName!.slice(0, spaceIdx) : fullName;
          const lastname = spaceIdx > 0 ? fullName!.slice(spaceIdx + 1) : null;

          return {
            eventId: event.id,
            eventTitle: event.title,
            attemptId: attempt.id,
            submittedAt: attempt.submittedAt,
            firstname,
            lastname,
            phoneNumber: byOrder(2),
            email: byOrder(3),
          };
        }),
      );

      const assignedPortraits = await this.studentPortraitService.findAssignedByExpertUserId(expertUserId);
      const assignedLeads = assignedPortraits.map(portrait => ({
        portraitId: portrait.id,
        userId: portrait.user.id,
        registeredAt: portrait.user.createdAt,
        firstname: portrait.user.firstname,
        lastname: portrait.user.lastname,
        email: portrait.user.email,
        phoneNumber: portrait.user.phoneNumber,
        contractStatus: portrait.user.studentContracts?.[0]?.status ?? null,
      }));

      // All student portraits not yet included in event/assigned leads
      const allPortraits = await this.studentPortraitService.findAllWithLatestContract();
      const includedUserIds = new Set([...registeredLeads.map(l => l.userId), ...assignedLeads.map(l => l.userId)]);
      const directStudents = allPortraits
        .filter(p => !includedUserIds.has(p.user.id))
        .map(p => ({
          portraitId: p.id,
          userId: p.user.id,
          registeredAt: p.user.createdAt,
          firstname: p.user.firstname,
          lastname: p.user.lastname,
          email: p.user.email,
          phoneNumber: p.user.phoneNumber,
          contractStatus: p.user.studentContracts?.[0]?.status ?? null,
        }));

      return { registeredLeads, testLeads, assignedLeads, directStudents };
    } catch (error) {
      this.logger.error(`Error fetching all leads for expert ${expertUserId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findLeadAnswers(eventId: number, userId: number) {
    try {
      const event = await this.eventRepository.findLeadAnswers(eventId, userId);
      if (!event) {
        throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entityName, eventId));
      }
      if (!event.test) {
        throw new NotFoundException(messages.NOT_FOUND_BY_FIELD("Test for event", `eventId=${eventId}`));
      }

      return {
        eventId,
        userId,
        testId: event.test.id,
        attempts: event.test.attempts.map(attempt => ({
          id: attempt.id,
          status: attempt.status,
          startedAt: attempt.startedAt,
          submittedAt: attempt.submittedAt,
          responses: attempt.responses.map(r => ({
            id: r.id,
            questionId: r.questionId,
            question: {
              id: r.question.id,
              order: r.question.order,
              text: r.question.text,
              type: r.question.type,
              required: r.question.required,
              options: r.question.options,
            },
            answer: {
              valueText: r.valueText,
              valueNum: r.valueNum,
              valueOptionId: r.valueOptionId,
              selectedOption: r.option,
            },
          })),
        })),
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching lead answers for event ${eventId}, user ${userId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  private buildEventQrUrl(slug: string): string {
    const appUrl = this.configService.get<string>("APP_URL")?.replace(/\/+$/, "");
    if (!appUrl) return `/event/${slug}`;
    return `${appUrl}/event/${slug}`;
  }

  private async toQrCodeBase64(value: string): Promise<string> {
    return QRCode.toDataURL(value, {
      type: "image/png",
      margin: 1,
      width: 320,
    });
  }
}
