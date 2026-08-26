import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { OrganisationImportService } from "./organisation-import.service";

@Processor("organisation-imports")
export class OrganisationImportProcessor extends WorkerHost {
  private readonly logger = new Logger(OrganisationImportProcessor.name);

  constructor(private readonly organisationImportService: OrganisationImportService) {
    super();
  }

  async process(job: Job<{ importJobId: number }, void, string>): Promise<void> {
    this.logger.log(`Processing organisation sync job ${job.data.importJobId}`);

    if (job.name === "run-program-sync") {
      await this.organisationImportService.processProgramSyncJob(job.data.importJobId);
      return;
    }

    this.logger.warn(`Unknown organisation import job name: ${job.name}`);
  }
}
