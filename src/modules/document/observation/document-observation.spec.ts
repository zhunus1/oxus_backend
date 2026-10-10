import { Logger } from "@nestjs/common";
import { Registry } from "prom-client";
import { observationOptions } from "./document-observation.config";
import { DocumentObservationMetrics } from "./document-observation.metrics";
import { DocumentObservationWorker } from "./document-observation.worker";
import type { DocumentObservationRepository } from "./document-observation.repository";
import { DocumentObservationService } from "./document-observation.service";
import { OBSERVATION_CATEGORIES } from "./document-intent-classifier";
const options = () => observationOptions(() => undefined);
const result = () => ({
  summary: { pending: 3, rolledBack: 2, unresolved: 5, oldestUnresolvedSeconds: 100, malformed: 0, referenced: 1 },
  observed: 3,
  categories: Object.fromEntries(OBSERVATION_CATEGORIES.map(c => [c, c === "UNRESOLVED_PENDING" ? 3 : 0])),
  nextCursor: { afterId: 10, throughId: 50 },
});
const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
};
describe("observation configuration", () => {
  it("defaults disabled with bounded local-test values", () => {
    expect(options()).toMatchObject({ enabled: false, batchSize: 10, concurrency: 1, intervalMs: 60000 });
  });
  it("parses explicit true and bounded integers", () => {
    const env = { DOCUMENT_OBSERVATION_ENABLED: "true", DOCUMENT_OBSERVATION_BATCH_SIZE: "100", DOCUMENT_OBSERVATION_CONCURRENCY: "4", DOCUMENT_OBSERVATION_INTERVAL_MS: "1000" };
    expect(observationOptions(key => env[key])).toMatchObject({ enabled: true, batchSize: 100, concurrency: 4, intervalMs: 1000 });
  });
  it("literal false remains disabled", () => {
    expect(observationOptions(key => (key.endsWith("ENABLED") ? "false" : undefined)).enabled).toBe(false);
  });
  it.each([
    ["ENABLED", "1"],
    ["ENABLED", "yes"],
    ["BATCH_SIZE", "0"],
    ["BATCH_SIZE", "101"],
    ["CONCURRENCY", "0"],
    ["CONCURRENCY", "5"],
    ["INTERVAL_MS", "999"],
    ["QUERY_TIMEOUT_MS", "NaN"],
    ["QUERY_TIMEOUT_MS", "10001"],
    ["STALE_AFTER_MS", "0"],
    ["BATCH_SIZE", "1.5"],
    ["BATCH_SIZE", "-1"],
  ])("rejects unsafe %s=%s without reflecting values", (suffix, value) => {
    expect(() => observationOptions(key => (key === `DOCUMENT_OBSERVATION_${suffix}` ? value : undefined))).toThrow("Invalid document observation configuration");
  });
});
describe("process-local observation metrics", () => {
  it("only exposes finite category labels and aggregate gauges", async () => {
    const registry = new Registry();
    const metrics = new DocumentObservationMetrics(registry);
    metrics.success(result() as any);
    metrics.failure();
    metrics.timed()();
    const json = await registry.getMetricsAsJSON();
    for (const metric of json)
      for (const sample of metric.values) {
        expect(Object.keys(sample.labels).every(k => k === "category" || k === "le")).toBe(true);
        if (sample.labels.category) expect(OBSERVATION_CATEGORIES).toContain(sample.labels.category);
      }
    const text = await registry.metrics();
    expect(text).not.toMatch(/fileKey|operationId|userId|email|recovered|cleaned_total/);
    expect(text).toContain("document_storage_observation_pending_intents 3");
    expect(text).toContain('category="UNRESOLVED_PENDING"} 3');
  });
  it("duplicate cycles increment observations while backlog gauges stay database-derived", async () => {
    const registry = new Registry();
    const m = new DocumentObservationMetrics(registry);
    m.success(result() as any);
    m.success(result() as any);
    expect(await registry.metrics()).toContain("document_storage_observation_pending_intents 3");
    expect(await registry.metrics()).toContain('category="UNRESOLVED_PENDING"} 6');
  });
  it("failure does not erase last successful gauges", async () => {
    const registry = new Registry();
    const m = new DocumentObservationMetrics(registry);
    m.success(result() as any);
    m.failure();
    expect(await registry.metrics()).toContain("document_storage_observation_pending_intents 3");
    expect(await registry.metrics()).toContain("document_storage_observation_errors_total 1");
  });
});
describe("bounded observation worker lifecycle", () => {
  const fixture = (enabled = true) => {
    const service = { observe: jest.fn().mockResolvedValue(result()) };
    const repository = { close: jest.fn().mockResolvedValue(undefined) };
    const metrics = { timed: jest.fn().mockReturnValue(jest.fn()), success: jest.fn(), failure: jest.fn() };
    const worker = new DocumentObservationWorker({ ...options(), enabled }, service as any, metrics as any, repository as any);
    return { worker, service, repository, metrics };
  };
  it("disabled means no database reads", async () => {
    const f = fixture(false);
    await f.worker.tick();
    expect(f.service.observe).not.toHaveBeenCalled();
    await f.worker.onApplicationShutdown();
    expect(f.repository.close).toHaveBeenCalledTimes(1);
  });
  it("skips interval ticks and advances cursor only after success", async () => {
    jest.spyOn(Date, "now").mockReturnValue(100000);
    const f = fixture();
    await f.worker.tick();
    await f.worker.tick();
    expect(f.service.observe).toHaveBeenCalledTimes(1);
    jest.spyOn(Date, "now").mockReturnValue(160000);
    await f.worker.tick();
    expect(f.service.observe).toHaveBeenLastCalledWith(result().nextCursor);
    jest.restoreAllMocks();
  });
  it("concurrent calls cannot overlap a batch", async () => {
    const f = fixture();
    const d = defer();
    f.service.observe.mockImplementation(async () => {
      await d.promise;
      return result();
    });
    const run = f.worker.tick();
    await f.worker.tick();
    expect(f.service.observe).toHaveBeenCalledTimes(1);
    d.resolve();
    await run;
  });
  it("shutdown drains active batch and forbids new work", async () => {
    const f = fixture();
    const d = defer();
    f.service.observe.mockImplementation(async () => {
      await d.promise;
      return result();
    });
    const run = f.worker.tick();
    const shutdown = f.worker.onApplicationShutdown();
    await f.worker.tick();
    expect(f.repository.close).not.toHaveBeenCalled();
    d.resolve();
    await run;
    await shutdown;
    expect(f.repository.close).toHaveBeenCalledTimes(1);
    await f.worker.tick();
    expect(f.service.observe).toHaveBeenCalledTimes(1);
  });
  it("database failure preserves cursor and logs no raw error", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    const f = fixture();
    f.service.observe.mockRejectedValue(new Error("secret key owner postgres://credentials"));
    await f.worker.tick();
    expect(f.metrics.failure).toHaveBeenCalledTimes(1);
    expect(f.metrics.success).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/secret|postgres|credentials/);
    jest.restoreAllMocks();
  });
  it("fresh instance starts observation from the beginning without mutation state", async () => {
    const f = fixture();
    await f.worker.tick();
    expect(f.service.observe).toHaveBeenCalledWith({ afterId: 0, throughId: null });
  });
});
describe("bounded service lanes", () => {
  it("waits for every failed/successful lane before rejecting", async () => {
    const key = "documents/550e8400-e29b-41d4-a716-446655440000";
    const d = defer();
    let calls = 0;
    const repo = {
      summary: async () => result().summary,
      candidates: async () => ({ rows: [{ details: { fileKey: key } }, { details: { fileKey: key } }], now: new Date(), nextCursor: { afterId: 2, throughId: 2 } }),
      references: async () => {
        if (++calls === 1) throw new Error("raw details");
        await d.promise;
        return new Map();
      },
    };
    const service = new DocumentObservationService(repo as unknown as DocumentObservationRepository, { ...options(), concurrency: 2 });
    let ended = false;
    const run = service.observe().catch(() => {
      ended = true;
    });
    await new Promise(r => setImmediate(r));
    expect(ended).toBe(false);
    d.resolve();
    await run;
    expect(ended).toBe(true);
  });
  it("rejects invalid bounds before DB access", async () => {
    const repository = { summary: jest.fn() };
    const service = new DocumentObservationService(repository as any, options());
    await expect(service.observe(undefined, 101)).rejects.toThrow("bounds");
    expect(repository.summary).not.toHaveBeenCalled();
  });
});
