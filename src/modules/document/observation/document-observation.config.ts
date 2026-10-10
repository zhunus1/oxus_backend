export interface ObservationOptions {
  enabled: boolean;
  batchSize: number;
  concurrency: number;
  intervalMs: number;
  queryTimeoutMs: number;
  staleAfterMs: number;
}
export const OBSERVATION_OPTIONS = Symbol("DOCUMENT_OBSERVATION_OPTIONS");
export const OBSERVATION_CONFIG_KEYS = {
  enabled: "DOCUMENT_OBSERVATION_ENABLED",
  batchSize: "DOCUMENT_OBSERVATION_BATCH_SIZE",
  concurrency: "DOCUMENT_OBSERVATION_CONCURRENCY",
  intervalMs: "DOCUMENT_OBSERVATION_INTERVAL_MS",
  queryTimeoutMs: "DOCUMENT_OBSERVATION_QUERY_TIMEOUT_MS",
  staleAfterMs: "DOCUMENT_OBSERVATION_STALE_AFTER_MS",
} as const;
export function observationOptions(read: (key: string) => unknown): ObservationOptions {
  const flag = read(OBSERVATION_CONFIG_KEYS.enabled);
  if (flag !== undefined && flag !== "true" && flag !== "false" && typeof flag !== "boolean") throw new Error("Invalid document observation configuration");
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = read(key);
    if (raw === undefined) return fallback;
    if ((typeof raw !== "number" && (typeof raw !== "string" || !/^[0-9]+$/.test(raw))) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max)
      throw new Error("Invalid document observation configuration");
    return Number(raw);
  };
  return {
    enabled: flag === true || flag === "true",
    batchSize: integer(OBSERVATION_CONFIG_KEYS.batchSize, 10, 1, 100),
    concurrency: integer(OBSERVATION_CONFIG_KEYS.concurrency, 1, 1, 4),
    intervalMs: integer(OBSERVATION_CONFIG_KEYS.intervalMs, 60_000, 1_000, 3_600_000),
    queryTimeoutMs: integer(OBSERVATION_CONFIG_KEYS.queryTimeoutMs, 2_000, 100, 10_000),
    staleAfterMs: integer(OBSERVATION_CONFIG_KEYS.staleAfterMs, 300_000, 1_000, 86_400_000),
  };
}
