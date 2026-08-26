import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { QsImportService } from "./qs-import.service";

type QsImportJobPayload = {
  importJobId: number;
  fileName: string;
  fileBufferBase64: string;
  limit: number | null;
};

@Processor("organisation-imports")
export class QsImportProcessor extends WorkerHost {
  private readonly logger = new Logger(QsImportProcessor.name);

  constructor(private readonly qsImportService: QsImportService) {
    super();
  }

  async process(job: Job<QsImportJobPayload, void, string>): Promise<void> {
    if (job.name !== "run-qs-organisation-import") {
      return;
    }

    this.logger.log(`Processing QS organisation import job ${job.data.importJobId}`);
    await this.qsImportService.processImportJob(job.data.importJobId, job.data.fileName, job.data.fileBufferBase64, job.data.limit);
  }
}
