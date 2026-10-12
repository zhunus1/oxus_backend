import { classifyIntent, NO_REFERENCES, observedPrivateKey, OBSERVATION_CATEGORIES, type ObservationCategory } from "./document-intent-classifier";
import type { ObservationOptions } from "./document-observation.config";
import { DocumentObservationRepository, type ObservationCursor } from "./document-observation.repository";
export class DocumentObservationService {
  constructor(
    private readonly repository: DocumentObservationRepository,
    private readonly options: ObservationOptions,
  ) {}
  async observe(cursor: ObservationCursor = { afterId: 0, throughId: null }, limit = this.options.batchSize) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(cursor.afterId) ||
      cursor.afterId < 0 ||
      (cursor.throughId !== null && (!Number.isSafeInteger(cursor.throughId) || cursor.throughId < cursor.afterId))
    )
      throw new Error("Invalid document observation bounds");
    const summary = await this.repository.summary();
    const page = await this.repository.candidates(cursor, limit);
    const categories = Object.fromEntries(OBSERVATION_CATEGORIES.map(category => [category, 0])) as Record<ObservationCategory, number>;
    const chunkSize = Math.max(1, Math.ceil(page.rows.length / this.options.concurrency));
    const chunks = Array.from({ length: Math.ceil(page.rows.length / chunkSize) }, (_, i) => page.rows.slice(i * chunkSize, (i + 1) * chunkSize));
    // All lanes settle before returning an error/shutdown; no detached database work.
    const results = await Promise.allSettled(
      chunks.map(async rows => {
        const keys = [...new Set(rows.flatMap(row => observedPrivateKey(row.details) ?? []))];
        const references = await this.repository.references(keys);
        return rows.map(row => {
          const key = observedPrivateKey(row.details);
          return classifyIntent(row, (key && references.get(key)) || NO_REFERENCES, page.now, this.options.staleAfterMs).category;
        });
      }),
    );
    if (results.some(result => result.status === "rejected")) throw new Error("Document observation batch failed");
    for (const result of results) if (result.status === "fulfilled") for (const category of result.value) categories[category]++;
    return { summary, categories, observed: page.rows.length, nextCursor: page.nextCursor };
  }
}
