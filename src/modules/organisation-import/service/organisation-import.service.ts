import { Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ImportJobStatus } from "generated/prisma/enums";
import messages from "src/configs/messages";
import { CreateProgramSyncJobDto } from "../api/dto/create-program-sync-job.dto";
import { CreateProgramSuggestionDto } from "../api/dto/create-program-suggestion.dto";
import { QueryProgramSyncJobDto } from "../api/dto/query-program-sync-job.dto";
import { OrganisationImportRepository } from "../repository/organisation-import.repository";
import { ProgramCatalogAgentService } from "./program-catalog-agent.service";

@Injectable()
export class OrganisationImportService {
  private readonly logger = new Logger(OrganisationImportService.name);
  private readonly jobEntity = "OrganisationImportJob";

  constructor(
    private readonly repo: OrganisationImportRepository,
    private readonly programCatalogAgentService: ProgramCatalogAgentService,
    @InjectQueue("organisation-imports") private readonly organisationImportQueue: Queue,
  ) {}

  async createProgramSyncJob(organisationId: number, initiatedByUserId: number, dto: CreateProgramSyncJobDto) {
    const organisation = await this.repo.findOrganisationForSync(organisationId);
    if (!organisation) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID("Organisation", organisationId));
    }

    const searchQuery = dto.searchQuery?.trim() || `${organisation.nameEn ?? organisation.slug} official programs admissions`;

    try {
      const job = await this.repo.createJob({
        organisation: { connect: { id: organisationId } },
        initiatedByUser: { connect: { id: initiatedByUserId } },
        status: ImportJobStatus.QUEUED,
        searchQuery,
        sourceUrl: dto.sourceUrl?.trim() || null,
      });

      await this.organisationImportQueue.add(
        "run-program-sync",
        { importJobId: job.id },
        {
          jobId: `organisation-program-sync-${job.id}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      return this.findProgramSyncJobById(job.id);
    } catch (err: any) {
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.jobEntity), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.jobEntity));
    }
  }

  async listProgramSyncJobs(organisationId: number, query: QueryProgramSyncJobDto) {
    const organisation = await this.repo.findOrganisationForSync(organisationId);
    if (!organisation) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID("Organisation", organisationId));
    }

    return this.repo.findJobsByOrganisation(organisationId, {
      skip: query.skip,
      take: query.take,
      status: query.status,
    });
  }

  async findProgramSyncJobById(jobId: number) {
    const job = await this.repo.findJobById(jobId);
    if (!job) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.jobEntity, jobId));
    }
    return job;
  }

  async suggestProgramsForOrg(organisationId: number, dto: CreateProgramSuggestionDto) {
    const organisation = await this.repo.findOrganisationForSync(organisationId);
    if (!organisation) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID("Organisation", organisationId));
    }

    const searchQuery = dto.searchQuery?.trim() || `${organisation.nameEn ?? organisation.slug} official programs admissions`;

    const extraction = await this.programCatalogAgentService.extractProgramCatalog({
      organisationName: organisation.nameEn ?? organisation.slug,
      countryName: (organisation as any).country?.nameEn ?? (organisation as any).country?.isoCode ?? null,
      existingWebsiteUrl: organisation.websiteUrl,
      sourceUrl: dto.sourceUrl?.trim() || null,
      searchQuery,
    });

    const existingKeys = new Set(((organisation as any).programs ?? []).map((p: { name: string; degreeLevel: string }) => `${p.name.toLowerCase()}::${p.degreeLevel}`));

    return extraction.programs.map(p => ({
      ...p,
      alreadySaved: existingKeys.has(`${p.name.toLowerCase()}::${p.degreeLevel}`),
    }));
  }

  async processProgramSyncJob(importJobId: number) {
    const job = await this.repo.findJobById(importJobId);
    if (!job) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.jobEntity, importJobId));
    }

    const organisation = await this.repo.findOrganisationForSync(job.organisationId);
    if (!organisation) {
      await this.repo.updateJob(importJobId, {
        status: ImportJobStatus.FAILED,
        errorLog: `Organisation ${job.organisationId} was not found.`,
        finishedAt: new Date(),
      });
      return;
    }

    await this.repo.updateJob(importJobId, {
      status: ImportJobStatus.RUNNING,
      startedAt: new Date(),
      errorLog: null,
    });

    try {
      const extraction = await this.programCatalogAgentService.extractProgramCatalog({
        organisationName: organisation.nameEn ?? organisation.slug,
        countryName: organisation.country?.nameEn ?? organisation.country?.isoCode ?? null,
        existingWebsiteUrl: organisation.websiteUrl,
        sourceUrl: job.sourceUrl,
        searchQuery: job.searchQuery ?? `${organisation.nameEn ?? organisation.slug} official programs admissions`,
      });

      if (extraction.programs.length === 0) {
        throw new Error("No programs were extracted from official sources.");
      }

      const syncStats = await this.repo.syncPrograms(
        organisation.id,
        extraction.programs.map(program => ({
          name: program.name,
          degreeLevel: program.degreeLevel,
          tuitionFee: program.tuitionFee,
          minGPA: program.minGPA,
          minIELTS: program.minIELTS,
          baseAcceptanceRate: program.baseAcceptanceRate,
        })),
      );

      await this.repo.createSnapshot(importJobId, {
        sourceUrl: extraction.officialWebsiteUrl ?? job.sourceUrl ?? organisation.websiteUrl ?? "web-search",
        pageTitle: "AI program catalog extraction",
        rawText: null,
        extractedData: {
          consultedUrls: extraction.consultedUrls,
          programs: extraction.programs,
        },
      });

      await this.repo.updateJob(importJobId, {
        status: ImportJobStatus.COMPLETED,
        officialWebsiteUrl: extraction.officialWebsiteUrl,
        rawResult: {
          consultedUrls: extraction.consultedUrls,
          programs: extraction.programs,
        },
        importedProgramCount: syncStats.importedProgramCount,
        createdProgramCount: syncStats.createdProgramCount,
        updatedProgramCount: syncStats.updatedProgramCount,
        finishedAt: new Date(),
      });

      if (extraction.officialWebsiteUrl && extraction.officialWebsiteUrl !== organisation.websiteUrl) {
        await this.repo.updateOrganisationWebsite(organisation.id, extraction.officialWebsiteUrl);
      }
    } catch (err: any) {
      this.logger.error(`Failed to process organisation program sync job ${importJobId}`, err?.stack);
      await this.repo.updateJob(importJobId, {
        status: ImportJobStatus.FAILED,
        errorLog: err instanceof Error ? err.message : messages.UNKNOWN_ERROR(),
        finishedAt: new Date(),
      });
    }
  }
}
