import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { OBSERVATION_OPTIONS, type ObservationOptions } from "./document-observation.config";
import { DocumentObservationMetrics } from "./document-observation.metrics";
import { DocumentObservationRepository, type ObservationCursor } from "./document-observation.repository";
import { DocumentObservationService } from "./document-observation.service";
@Injectable()
export class DocumentObservationWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(DocumentObservationWorker.name);
  private cursor: ObservationCursor = { afterId: 0, throughId: null };
  private nextDue = 0;
  private stopping = false;
  private running: Promise<void> | undefined;
  constructor(
    @Inject(OBSERVATION_OPTIONS) private readonly options: ObservationOptions,
    private readonly observation: DocumentObservationService,
    private readonly metrics: DocumentObservationMetrics,
    private readonly repository: DocumentObservationRepository,
  ) {}
  @Cron("* * * * * *", { name: "document-storage-observation", waitForCompletion: true, unrefTimeout: true })
  async tick() {
    if (!this.options.enabled || this.stopping || this.running || Date.now() < this.nextDue) return;
    this.nextDue = Date.now() + this.options.intervalMs;
    this.running = this.cycle();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }
  private async cycle() {
    const endTimer = this.metrics.timed();
    try {
      const result = await this.observation.observe(this.cursor);
      this.cursor = result.nextCursor;
      this.metrics.success(result);
    } catch {
      this.metrics.failure();
      this.logger.warn("Document storage observation failed; no data was changed");
    } finally {
      endTimer();
    }
  }
  async onApplicationShutdown() {
    this.stopping = true;
    await this.running;
    await this.repository.close();
  }
}
