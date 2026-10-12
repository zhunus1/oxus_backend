import { Counter, Gauge, Histogram, Registry, register } from "prom-client";
import { OBSERVATION_CATEGORIES } from "./document-intent-classifier";
import type { DocumentObservationService } from "./document-observation.service";
export class DocumentObservationMetrics {
  private readonly backlog: Record<"pending" | "rolledBack" | "unresolved" | "oldestUnresolvedSeconds" | "malformed" | "referenced", Gauge>;
  private readonly observed: Counter;
  private readonly errors: Counter;
  private readonly duration: Histogram;
  private readonly successful: Gauge;
  constructor(registry: Registry = register) {
    const names = {
      pending: "pending_intents",
      rolledBack: "rolled_back_intents",
      unresolved: "unresolved_intents",
      oldestUnresolvedSeconds: "oldest_unresolved_seconds",
      malformed: "malformed_intents",
      referenced: "referenced_intents",
    };
    this.backlog = Object.fromEntries(
      Object.entries(names).map(([field, suffix]) => [
        field,
        new Gauge({ name: `document_storage_observation_${suffix}`, help: `Database snapshot: ${suffix}`, registers: [registry] }),
      ]),
    ) as typeof this.backlog;
    this.observed = new Counter({
      name: "document_storage_observation_observed_total",
      help: "Process-local repeated observations, not unique recoveries",
      labelNames: ["category"],
      registers: [registry],
    });
    for (const category of OBSERVATION_CATEGORIES) this.observed.labels(category).inc(0);
    this.errors = new Counter({ name: "document_storage_observation_errors_total", help: "Failed observation cycles, without error details", registers: [registry] });
    this.duration = new Histogram({
      name: "document_storage_observation_batch_seconds",
      help: "Observation cycle duration including summary and reference reads",
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30],
      registers: [registry],
    });
    this.successful = new Gauge({
      name: "document_storage_observation_last_success_timestamp_seconds",
      help: "Time of last complete successful observation cycle; zero before success",
      registers: [registry],
    });
    this.successful.set(0);
  }
  success(result: Awaited<ReturnType<DocumentObservationService["observe"]>>) {
    for (const name of Object.keys(this.backlog) as (keyof typeof this.backlog)[]) this.backlog[name].set(result.summary[name]);
    for (const category of OBSERVATION_CATEGORIES) this.observed.labels(category).inc(result.categories[category]);
    this.successful.set(Date.now() / 1000);
  }
  failure() {
    this.errors.inc();
  }
  timed() {
    return this.duration.startTimer();
  }
}
