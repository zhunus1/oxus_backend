import { Pool, type PoolClient } from "pg";
import { UUID_PATTERN, type ObservedIntent, type ReferenceFacts } from "./document-intent-classifier";
import type { ObservationOptions } from "./document-observation.config";
export interface ObservationCursor {
  afterId: number;
  throughId: number | null;
}
export interface ObservationSummary {
  pending: number;
  rolledBack: number;
  unresolved: number;
  oldestUnresolvedSeconds: number;
  malformed: number;
  referenced: number;
}
const technical = `action='DOCUMENT_STORAGE_PENDING' AND "entityType" IN ('DocumentStorageIntent','StudentPortrait')`;
// Typed JSON validation mirrors the pure classifier. CASE prevents casts of malformed strings.
const number = (field: string) => `(CASE WHEN jsonb_typeof(details->'${field}')='number' THEN (details->>'${field}')::numeric END)`;
const positive = (field: string) => `${number(field)} BETWEEN 1 AND 9007199254740991 AND trunc(${number(field)})=${number(field)}`;
const projectedId = (field: string) => `CASE WHEN (${positive(field)}) THEN to_jsonb(${number(field)}::bigint) ELSE 'null'::jsonb END`;
// Return only bounded diagnostic fields, never an unbounded or unrelated journal payload.
const projection = `CASE WHEN jsonb_typeof(details)='object' THEN jsonb_build_object(
  'operationId',CASE WHEN jsonb_typeof(details->'operationId')='string' AND length(details->>'operationId')=36 THEN details->'operationId' END,
  'fileKey',CASE WHEN jsonb_typeof(details->'fileKey')='string' AND length(details->>'fileKey')=46 THEN details->'fileKey' END,
  'studentPortraitId',${projectedId("studentPortraitId")},'ownerUserId',${projectedId("ownerUserId")},
  'documentId',CASE WHEN details->'documentId'='null'::jsonb THEN 'null'::jsonb
    WHEN (${positive("documentId")}) THEN to_jsonb(${number("documentId")}::bigint) ELSE '"invalid"'::jsonb END,
  'state',CASE WHEN details->>'state' IN ('PENDING','ROLLED_BACK','COMMITTED','CLEANED') THEN details->'state' END,
  'recovery',jsonb_build_object('deleteFenced',details #> '{recovery,deleteFenced}'='true'::jsonb,
    'manualReason',CASE WHEN jsonb_typeof(details #> '{recovery,manualReason}')='string' THEN 'present' END)
) ELSE 'null'::jsonb END`;
const valid = `COALESCE(id>0 AND isfinite("createdAt") AND jsonb_typeof(details)='object'
  AND jsonb_typeof(details->'operationId')='string' AND details->>'operationId' ~ '^${UUID_PATTERN}$'
  AND jsonb_typeof(details->'fileKey')='string' AND details->>'fileKey' ~ '^documents/${UUID_PATTERN}$'
  AND (${positive("studentPortraitId")}) AND ${number("studentPortraitId")}="entityId"
  AND (${positive("ownerUserId")})
  AND (details->'documentId'='null'::jsonb OR (${positive("documentId")}))
  AND jsonb_typeof(details->'state')='string' AND details->>'state' IN ('PENDING','ROLLED_BACK','COMMITTED','CLEANED'),false)`;
export const OBSERVATION_SUMMARY_SQL = `WITH refs AS (
  SELECT "fileKey", count(*) AS n,min("studentPortraitId") AS first,max("studentPortraitId") AS last
  FROM public."Document" WHERE "fileKey" IS NOT NULL GROUP BY "fileKey"
), intents AS (
  SELECT details, "createdAt", ${valid} AS valid, COALESCE(refs.n,0) AS refs,
    (refs.n>0 AND (${number("studentPortraitId")} IS DISTINCT FROM refs.first OR ${number("studentPortraitId")} IS DISTINCT FROM refs.last)) AS foreign_reference
  FROM public."AuditLog" LEFT JOIN refs ON refs."fileKey"=details->>'fileKey' WHERE ${technical}
), facts AS (
  SELECT *, NOT valid OR COALESCE(foreign_reference,false) OR details->>'state' IN ('PENDING','ROLLED_BACK')
    OR (details->>'state'='COMMITTED' AND refs=0) OR (details->>'state'='CLEANED' AND refs>0)
    OR (jsonb_typeof(details->'recovery')='object' AND
      (details #> '{recovery,deleteFenced}'='true'::jsonb OR jsonb_typeof(details #> '{recovery,manualReason}')='string')) AS unresolved
  FROM intents
)
SELECT count(*) FILTER (WHERE details->>'state'='PENDING') AS pending,
  count(*) FILTER (WHERE details->>'state'='ROLLED_BACK') AS "rolledBack",
  count(*) FILTER (WHERE unresolved) AS unresolved,
  COALESCE(GREATEST(0, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP-(min("createdAt") FILTER (WHERE unresolved AND isfinite("createdAt")) AT TIME ZONE 'UTC'))),0) AS "oldestUnresolvedSeconds",
  count(*) FILTER (WHERE NOT valid) AS malformed, count(*) FILTER (WHERE refs>0) AS referenced FROM facts`;
export class DocumentObservationRepository {
  private readonly pool: Pool;
  constructor(
    databaseUrl: string | undefined,
    private readonly options: ObservationOptions,
  ) {
    if (options.enabled && !databaseUrl) throw new Error("Document observation database target is required");
    // Pool is lazy: a disabled worker makes no connections. Never load application .env here.
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: options.concurrency,
      connectionTimeoutMillis: options.queryTimeoutMs,
      query_timeout: options.queryTimeoutMs + 500,
      application_name: "document-observation",
    });
    // Idle connection errors must not crash the process or print database/credential details.
    this.pool.on("error", () => {});
  }
  async readOnly<T>(read: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined;
    let failed = false;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true),set_config('TimeZone','UTC',true)", [
        `${this.options.queryTimeoutMs}ms`,
      ]);
      const result = await read(client);
      await client.query("COMMIT");
      return result;
    } catch {
      failed = true;
      throw new Error("Document observation database read failed");
    } finally {
      // Destroy a failed connection: no aborted transaction or timed-out query returns to the pool.
      client?.release(failed);
    }
  }
  async summary(): Promise<ObservationSummary> {
    return this.readOnly(async client => {
      const { rows } = await client.query(OBSERVATION_SUMMARY_SQL);
      const result = {} as ObservationSummary;
      for (const name of ["pending", "rolledBack", "unresolved", "oldestUnresolvedSeconds", "malformed", "referenced"] as const) {
        const value = Number(rows[0][name]);
        if (!Number.isFinite(value) || value < 0) throw new Error("Invalid observation aggregate");
        result[name] = value;
      }
      return result;
    });
  }
  async candidates(cursor: ObservationCursor, limit: number) {
    return this.readOnly(async client => {
      const { rows: clock } = await client.query('SELECT COALESCE(max(id),0) AS maximum, CURRENT_TIMESTAMP AS now FROM public."AuditLog"');
      const throughId = cursor.throughId ?? Number(clock[0].maximum);
      const { rows } = await client.query<ObservedIntent>(
        `SELECT id,action,"entityType","entityId",${projection} AS details,"createdAt" AT TIME ZONE 'UTC' AS "createdAt" FROM public."AuditLog" WHERE id>$1 AND id<=$2 AND ${technical} ORDER BY id ASC LIMIT $3`,
        [cursor.afterId, throughId, limit],
      );
      const nextCursor: ObservationCursor = rows.length < limit ? { afterId: 0, throughId: null } : { afterId: rows[rows.length - 1].id, throughId };
      return { rows, now: clock[0].now as Date, nextCursor };
    });
  }
  async references(keys: string[]): Promise<Map<string, ReferenceFacts>> {
    if (!keys.length) return new Map();
    return this.readOnly(async client => {
      const { rows } = await client.query(
        `SELECT "fileKey",count(*)::int AS count,count(*) FILTER (WHERE "deletedAt" IS NOT NULL)::int AS archived,
          min("studentPortraitId") AS "firstPortraitId",max("studentPortraitId") AS "lastPortraitId"
          FROM public."Document" WHERE "fileKey"=ANY($1::text[]) GROUP BY "fileKey"`,
        [keys],
      );
      return new Map(
        rows.map(row => [
          row.fileKey as string,
          { count: row.count as number, archived: row.archived as number, firstPortraitId: row.firstPortraitId as number, lastPortraitId: row.lastPortraitId as number },
        ]),
      );
    });
  }
  async close() {
    await this.pool.end();
  }
}
