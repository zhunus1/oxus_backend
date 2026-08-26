import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { RoadmapRepository } from "../repository/roadmap.repository";
import { AuditLogService } from "src/modules/audit-log/service/audit-log.service";
import { SubscriptionTier } from "generated/prisma/client";
import messages from "src/configs/messages";

const ALLOWED_TIERS: SubscriptionTier[] = [SubscriptionTier.AI_ROADMAP, SubscriptionTier.EXPERT_MENTORSHIP, SubscriptionTier.ENTERPRISE];

@Injectable()
export class RoadmapService {
  private readonly logger = new Logger(RoadmapService.name);

  constructor(
    private readonly repo: RoadmapRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async getPortrait(userId: number) {
    const portrait = await this.repo.findPortraitWithProfile(userId);
    if (!portrait) {
      throw new NotFoundException(messages.NOT_FOUND("StudentPortrait"));
    }
    return portrait;
  }

  async confirmFreeze(userId: number) {
    try {
      const portrait = await this.getPortrait(userId);

      if (!ALLOWED_TIERS.includes(portrait.subscription)) {
        throw new BadRequestException("Subscription AI_ROADMAP or higher is required");
      }

      if (portrait.isIdentityLocked) {
        throw new BadRequestException("Identity is already locked");
      }

      await this.repo.freezeIdentity(portrait.id);
      await this.auditLogService.log(userId, "DATA_FREEZE", "StudentPortrait", portrait.id, {
        subscription: portrait.subscription,
      });

      return { frozen: true };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error(`Error confirming freeze: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR("StudentPortrait", 0));
    }
  }

  async generate(userId: number) {
    try {
      const portrait = await this.getPortrait(userId);

      if (!ALLOWED_TIERS.includes(portrait.subscription)) {
        throw new BadRequestException("Subscription AI_ROADMAP or higher is required");
      }
      if (!portrait.isIdentityLocked) {
        throw new BadRequestException("Please confirm data freeze first");
      }
      if (portrait.aiRoadmap !== null) {
        throw new BadRequestException("Roadmap already generated. Use regenerate endpoint within 24 hours.");
      }

      const roadmap = await this.buildRoadmap(portrait);

      await this.repo.saveRoadmap(portrait.id, roadmap, 1);
      await this.auditLogService.log(userId, "ROADMAP_GENERATED", "StudentPortrait", portrait.id);

      return roadmap;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error(`Error generating roadmap: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR("Roadmap"));
    }
  }

  async regenerate(userId: number) {
    try {
      const portrait = await this.getPortrait(userId);

      if (!portrait.roadmapGeneratedAt) {
        throw new BadRequestException("No roadmap to regenerate");
      }

      const hoursSinceGeneration = (Date.now() - portrait.roadmapGeneratedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceGeneration > 24) {
        throw new BadRequestException(messages.EDIT_WINDOW_EXPIRED("Roadmap", 1440));
      }
      if (portrait.generationCount >= 2) {
        throw new BadRequestException("Free regeneration limit reached");
      }

      const roadmap = await this.buildRoadmap(portrait);

      await this.repo.saveRoadmap(portrait.id, roadmap, portrait.generationCount + 1);
      await this.auditLogService.log(userId, "ROADMAP_REGENERATED", "StudentPortrait", portrait.id);

      return roadmap;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error(`Error regenerating roadmap: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR("Roadmap", 0));
    }
  }

  async getMyRoadmap(userId: number) {
    try {
      const portrait = await this.getPortrait(userId);
      if (!portrait.aiRoadmap) {
        throw new NotFoundException("Roadmap not generated yet");
      }
      return {
        roadmap: portrait.aiRoadmap,
        generatedAt: portrait.roadmapGeneratedAt,
        generationCount: portrait.generationCount,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error fetching roadmap: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR("Roadmap"));
    }
  }

  private async buildRoadmap(portrait: any) {
    // Extract student profile data for filtering
    const countryIsoCodes = portrait.targetCountries?.map((tc: any) => tc.country.isoCode) ?? [];
    const ieltsTest = portrait.tests?.find((t: any) => t.testType === "IELTS");
    const ielts = ieltsTest?.totalScore;

    const programs = await this.repo.findMatchingPrograms({
      countryIsoCodes,
      gpa: portrait.gpa ?? undefined,
      gpaScale: portrait.gpaScale,
      maxTuitionFee: portrait.budgetLimit ?? undefined,
      ielts,
    });

    // Build structured roadmap from real program data
    const recommendedPrograms = programs.map(p => ({
      programId: p.id,
      programName: p.name,
      degreeLevel: p.degreeLevel,
      organisationName: p.organisation.nameEn ?? p.organisation.nameRu,
      country: p.organisation.country?.nameEn ?? p.organisation.country?.isoCode,
      tuitionFee: p.tuitionFee,
      applicationDeadline: p.applicationDeadline,
      minGPA: p.minGPA,
      minIELTS: p.minIELTS,
      acceptanceRate: p.baseAcceptanceRate,
    }));

    // Build month-by-month timeline
    const now = new Date();
    const timeline = this.buildTimeline(now);

    return {
      generatedAt: now.toISOString(),
      studentProfile: {
        gpa: portrait.gpa,
        gpaScale: portrait.gpaScale,
        educationLevel: portrait.educationLevel,
        budgetLimit: portrait.budgetLimit,
        budgetCurrency: portrait.budgetCurrency,
        targetCountries: countryIsoCodes,
        ielts: ielts ?? null,
      },
      recommendedPrograms,
      timeline,
      requiredDocuments: ["Transcript", "Motivation Letter (SOP)", "CV/Resume", "Language Certificate", "Passport Copy"],
    };
  }

  private buildTimeline(startDate: Date) {
    const steps: { month: string; tasks: string[] }[] = [];
    const month = startDate.getMonth();
    const year = startDate.getFullYear();

    steps.push({
      month: this.formatMonth(year, month),
      tasks: ["Review recommended programs", "Confirm target universities"],
    });
    steps.push({
      month: this.formatMonth(year, month + 1),
      tasks: ["Prepare language tests if needed", "Request transcripts from your institution"],
    });
    steps.push({
      month: this.formatMonth(year, month + 2),
      tasks: ["Draft motivation letters (SOP)", "Prepare CV/Resume"],
    });
    steps.push({
      month: this.formatMonth(year, month + 3),
      tasks: ["Finalize documents with expert review", "Submit applications to universities"],
    });
    steps.push({
      month: this.formatMonth(year, month + 4),
      tasks: ["Track application statuses", "Prepare for interviews if required"],
    });
    steps.push({
      month: this.formatMonth(year, month + 5),
      tasks: ["Receive decisions", "Begin visa preparation for accepted programs"],
    });

    return steps;
  }

  private formatMonth(year: number, month: number): string {
    const date = new Date(year, month, 1);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
  }
}
