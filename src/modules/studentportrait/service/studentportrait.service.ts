import { BadRequestException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { StudentPortraitRepository } from "../repository/studentportrait.repository";
import { PortraitEntity } from "../api/dto/portrait.entity";
import messages from "src/configs/messages";
import { UpdatePortraitDto } from "../api/dto/update-portrait.dto";
import { Prisma, EducationLevel } from "generated/prisma/client";
import { SubscriptionTier } from "generated/prisma/enums";
import { AddPortraitLanguageDto } from "../api/dto/add-portrait-language.dto";
import { CreatePortraitTestDto } from "../api/dto/create-portrait-test.dto";
import { UpdatePortraitTestDto } from "../api/dto/update-portrait-test.dto";
import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

import { TIER_SLOTS } from "../domain/contract-benefits";

/** Manages student profiles and activates the benefits associated with signed contracts. */
@Injectable()
export class StudentPortraitService {
  private readonly logger = new Logger(StudentPortraitService.name);
  private readonly entityName = "StudentPortrait";
  constructor(
    private readonly studentPortraitRepository: StudentPortraitRepository,
    private readonly userJourneyLog: UserJourneyLogService,
  ) {}

  async findMe(userId: number): Promise<PortraitEntity> {
    try {
      const portrait = await this.studentPortraitRepository.findByUserId(userId);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }
      return portrait;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching portrait for user ${userId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async updateMe(userId: number, dto: UpdatePortraitDto): Promise<PortraitEntity> {
    try {
      const portrait = await this.studentPortraitRepository.findRawByUserId(userId);
      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }

      if (portrait.isIdentityLocked && dto.birthDate !== undefined) {
        throw new BadRequestException("birthDate can't be changed when identity is locked");
      }

      const nextGPA = dto.gpa ?? portrait.gpa ?? undefined;
      const nextGPAScale = dto.gpaScale ?? portrait.gpaScale;

      if (nextGPA !== undefined && nextGPA !== null && nextGPAScale !== undefined && nextGPA > nextGPAScale) {
        throw new BadRequestException("gpa can't be greater than gpaScale");
      }

      const data: Prisma.StudentPortraitUpdateInput = {};

      if (dto.hasVisa !== undefined) data.hasVisa = dto.hasVisa;
      if (dto.birthDate !== undefined) data.birthDate = new Date(dto.birthDate);
      if (dto.educationLevel !== undefined) data.educationLevel = dto.educationLevel;
      if (dto.major !== undefined) data.major = dto.major;
      if (dto.gpa !== undefined) data.gpa = dto.gpa;
      if (dto.gpaScale !== undefined) data.gpaScale = dto.gpaScale;
      if (dto.budgetLimit !== undefined) data.budgetLimit = dto.budgetLimit;
      if (dto.budgetCurrency !== undefined) data.budgetCurrency = dto.budgetCurrency;

      const nextEducation = dto.educationLevel ?? portrait.educationLevel;
      const filledProfile = portrait.educationLevel === EducationLevel.NONE && nextEducation !== EducationLevel.NONE && dto.educationLevel !== undefined;

      const updated = await this.studentPortraitRepository.updateByUserId(userId, data);

      if (filledProfile) {
        void this.userJourneyLog.logEvent(userId, USER_JOURNEY_EVENT.PROFILE_FILLED, {
          educationLevel: nextEducation,
        });
      }

      return updated;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error(`Error updating portrait for user ${userId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entityName));
    }
  }

  async assignEventSource(userId: number, sourceEventId: number, consultantProfileId: number | null): Promise<void> {
    try {
      await this.studentPortraitRepository.assignEventSource(userId, sourceEventId, consultantProfileId);
    } catch (error) {
      this.logger.error(`Error assigning event source for user ${userId}: ${error}`);
    }
  }

  async addLanguage(userId: number, dto: AddPortraitLanguageDto) {
    try {
      const portrait = await this.studentPortraitRepository.findRawByUserId(userId);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }

      return await this.studentPortraitRepository.addLanguage(portrait.id, dto);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error adding language to portrait for user ${userId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("UserLanguage"));
    }
  }

  async deleteLanguage(userId: number, languageId: number) {
    try {
      const portrait = await this.studentPortraitRepository.findRawByUserId(userId);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }

      return await this.studentPortraitRepository.deleteLanguage(portrait.id, languageId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error deleting language ${languageId} from portrait for user ${userId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR("UserLanguage", languageId));
    }
  }

  async addTest(userId: number, dto: CreatePortraitTestDto) {
    try {
      const portrait = await this.studentPortraitRepository.findRawByUserId(userId);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }

      return await this.studentPortraitRepository.addTest(portrait.id, dto);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error adding test to portrait for user ${userId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("LanguageTest"));
    }
  }

  async updateTest(userId: number, testId: number, dto: UpdatePortraitTestDto) {
    try {
      const portrait = await this.studentPortraitRepository.findRawByUserId(userId);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }

      return await this.studentPortraitRepository.updateTest(portrait.id, testId, dto);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error updating test ${testId} for user ${userId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR("LanguageTest", testId));
    }
  }

  async deleteTest(userId: number, testId: number) {
    try {
      const portrait = await this.studentPortraitRepository.findRawByUserId(userId);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }

      return await this.studentPortraitRepository.deleteTest(portrait.id, testId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error deleting test ${testId} for user ${userId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR("LanguageTest", testId));
    }
  }

  async findAssignedByExpertUserId(expertUserId: number) {
    try {
      return await this.studentPortraitRepository.findAssignedByExpertUserId(expertUserId);
    } catch (error) {
      this.logger.error(`Error fetching assigned students for expert ${expertUserId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findAllWithLatestContract() {
    try {
      return await this.studentPortraitRepository.findAllWithLatestContract();
    } catch (error) {
      this.logger.error(`Error fetching all portraits with contracts: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async addTargetCountry(userId: number, countryId: number) {
    try {
      const portrait = await this.studentPortraitRepository.findRawByUserId(userId);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }

      return await this.studentPortraitRepository.addTargetCountry(portrait.id, countryId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error adding target country ${countryId} for user ${userId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("StudentPortraitTargets"));
    }
  }

  async deleteTargetCountry(userId: number, countryId: number) {
    try {
      const portrait = await this.studentPortraitRepository.findRawByUserId(userId);

      if (!portrait) {
        throw new NotFoundException(messages.NOT_FOUND(this.entityName));
      }

      return await this.studentPortraitRepository.deleteTargetCountry(portrait.id, countryId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error deleting target country ${countryId} for user ${userId}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR("StudentPortraitTargets", countryId));
    }
  }

  async activateContractBenefits(studentUserId: number, subscription: SubscriptionTier, consultantProfileId: number | null): Promise<void> {
    try {
      await this.studentPortraitRepository.updateSubscriptionAndConsultant(studentUserId, subscription, consultantProfileId);

      const totalSlots = TIER_SLOTS[subscription];
      if (consultantProfileId !== null && totalSlots) {
        await this.studentPortraitRepository.upsertStudentPackage(studentUserId, consultantProfileId, totalSlots);
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Error activating contract benefits for student ${studentUserId}`, err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entityName));
    }
  }
}
