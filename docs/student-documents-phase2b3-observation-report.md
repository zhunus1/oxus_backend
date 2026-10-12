# Phase 2B-3B — Observation-only Document Storage Recovery & Monitoring

Дата: 2026-10-10. Implementation baseline: `d1ab3bed7f8d058e839d1036a59f83a5f74d402b`.
**Backend Commit Gate: PASS WITH NOTES. Production Deployment Gate: NOT READY.**

## 1. Executive Summary

Реализованы DB-only observer, pure classifier, bounded Nest worker, агрегированные Prometheus metrics и безопасный diagnostic CLI. Runtime observer/CLI не изменяют Document/AuditLog и не обращаются к MinIO. Existing synchronous compensation и upload lifecycle сохранены. Automatic destructive recovery остаётся **NOT APPROVED**; U1/U2/G1 не закрыты этим этапом.

Повторно прошли **1126 уникальных repository tests**, включая **130 новых**: 79 Jest, 26 CLI и 25 real PostgreSQL. Это текущий повтор gates, а не перенос исторического результата 996 tests. Full Jest 619/619; standard integration 400/400; private API 74/74; MinIO foundation 20/20; storage runner security 13/13. Новых подтверждённых P0/P1 нет. Отдельно повторены existing Document HTTP 80/80, targeted suites и остальные quality gates, без повторного сложения subsets.

Worker disabled by default. Local benchmark на actual schema без новых indexes подтверждает работоспособность минимального workflow, но не production SLO. Global aggregates остаются full scans с query timeout; production enable требует отдельного capacity/interval/scrape решения. Независимый code review можно начинать.

## 2. Baseline / Scope

Branch `release/manual-contract-candidate`; HEAD совпадает с указанным baseline; index пуст до и после работы. Изучены current DocumentService, synchronous DocumentStorageRecoveryService, private storage, AuditLog readers/allowlist, Prisma schema, scheduler/Prometheus, CI/runners и пять указанных phase reports/runbook.

Prior [proposal](student-documents-phase2b3-recovery-design-proposal.md), [98 design probes / validation](student-documents-phase2b3-fencing-validation-report.md), [initial recovery report](student-documents-phase2b3-recovery-report.md), [2B-2 release gate](student-documents-phase2b2-release-review.md) сохраняются. SQL functions/triggers из proposal отсутствуют в repository migrations и real migrated schema. Approved направление не равно approval полного automatic-delete protocol.

Before-work SHA-256 snapshot содержит 692 существовавших файла, включая tracked source и user docs. Финальная сверка обнаружила только шесть разрешённых изменений существующих файлов: app/module bootstrap, package scripts, CI lint, integration runner и runbook. Остальные 686 совпадают; отсутствующих файлов нет. Новые observer/tests/report перечислены ниже. Previous `docs/docs-cleanup-review.md` сохранён; docs cleanup/moves/deletes не выполнялись.

Не изменялись Prisma schema/45 SQL migrations, Document API/DTO/controller/service, JWT/access policy, public AuditLog allowlist, existing compensation/DeleteObject path, public Upload/Minio/ContractScan, staff CRUD, contracts/payments/Lead, lockfile или deployment files. No Production/Test connections, deploy, commit, push, git add/reset/restore/clean.

## 3. Observation Architecture

[Observation module](../src/modules/document/observation/document-observation.module.ts) подключён в AppModule. Он использует existing ScheduleModule и existing Prometheus registry; новых controllers/endpoints нет. Отдельный небольшой `pg.Pool` выбран для explicit read-only transactions, server timeout и bounded projected reads без SDK/Prisma/application lifecycle side effects. Pool lazy: disabled worker не открывает connections; max=concurrency.

Cycle: global DB summary → bounded intent page → до concurrency пакетных reference queries → pure classification → publish metrics и local cursor. Summary/page выполняются последовательно. Reference lanes завершаются через `Promise.allSettled`; failed lane не оставляет detached work. Partial result не публикуется.

HEAD не требуется: задача минимального workflow — наблюдение journal/reference facts. Отказ от MinIO dependencies исключает ensureBucket/policy side effects, arbitrary fileUrl, SDK error disclosure и ложный вывод о завершении Put по HEAD404. Наличие object bytes observer не доказывает.

## 4. Classification Contract

[Pure classifier](../src/modules/document/observation/document-intent-classifier.ts) принимает envelope/details, aggregated reference facts, PG clock и stale threshold. Выход содержит только `{ category, state, referenced }`; action/proof/grant/identity отсутствуют. Root states остаются PENDING/ROLLED_BACK/COMMITTED/CLEANED; неизвестное значение отображается как UNKNOWN и MALFORMED_INTENT. Вход не мутируется.

Validation: positive safe numeric IDs, exact canonical lowercase UUID v4 operation/key, `documents/<uuid>`, studentPortraitId=entityId, ownerUserId, documentId null либо positive safe integer, known state, finite Date, exact technical action и один из двух namespaces. String/fractional/negative/missing IDs, arrays/null/scalars, noncanonical key/state отвергаются. JSON integer representation `3.0` допустима.

| Facts, в порядке приоритета | Category |
| --- | --- |
| Invalid intent / UNKNOWN | MALFORMED_INTENT |
| Foreign portrait refs; CLEANED с refs; existing recovery fence/manualReason | MANUAL_REVIEW_REQUIRED |
| COMMITTED с refs своего portrait | COMMITTED_REFERENCED |
| PENDING/ROLLED_BACK с refs своего portrait | REFERENCED_OBJECT |
| COMMITTED без refs | COMMITTED_MISSING_REFERENCE |
| CLEANED без refs | CLEANED_TERMINAL |
| ROLLED_BACK без refs | ROLLED_BACK_UNRESOLVED |
| PENDING без refs, возраст меньше threshold | IN_FLIGHT_OR_UNKNOWN |
| PENDING без refs, возраст на/после threshold | UNRESOLVED_PENDING |

Reference reads включают active и archived, несколько rows и разные portraits; нет `deletedAt IS NULL`. Legacy NULL fileKey не конвертируется из fileUrl. Даже CLEANED_TERMINAL — только journal diagnosis. Возраст/нет refs/HEAD404 не дают delete authorization.

## 5. Candidate Selection / Pagination

Stable ordering `AuditLog.id ASC`, `id > afterId AND id <= throughId`, `LIMIT 1..100`; initial high-watermark — current max AuditLog ID. Фильтр technical action + DocumentStorageIntent/historical StudentPortrait, без exclusion COMMITTED/CLEANED. Malformed rows тоже продвигают cursor, поэтому первые десять invalid rows не блокируют очередь.

Cursor локальный, обновляется только после полного success. Короткая/пустая page начинает следующий sweep; exact full final page требует ещё одного tick. ID выше high-watermark deferred до следующего sweep. Allocated earlier ID, committed после пройденного диапазона, тоже может ждать следующего sweep; это eventual diagnostics, не exactly-once processing. Restart начинает сначала. Row deletion между pages не ломает keyset.

Batch memory ограничена number of candidates и bounded JSON projection: IDs нормализуются; key/op strings ограничены ожидаемой длиной; root state finite; manualReason возвращается только как marker. Huge unknown payloads/raw manual context не возвращаются в Node. Invalid fields сохраняют invalid diagnosis; missing documentId не превращается в разрешённый null.

## 6. DB / MinIO Read-only Guarantees

[Repository](../src/modules/document/observation/document-observation.repository.ts) каждую read group выполняет в `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. Только SELECT и transaction-local statement/lock timeout/UTC configuration, затем COMMIT. PgPoolClient release с destroy при ошибке; aborted/timed-out connection не возвращается в pool. Error превращается в generic message, без raw SDK/pg/Prisma details.

Server statement/lock timeout default 2 s, client query timeout 2.5 s, connection timeout 2 s. Это per-operation limits; не обещается общий batch deadline 2 s. UTC фиксируется внутри transaction; timestamp-without-time-zone createdAt читается/сравнивается как UTC, согласно current Prisma writes. Real timezone regression проверена для UTC и Pacific/Auckland. Infinite timestamps считаются malformed и исключаются из oldest finite age.

Summary — один consistent statement/snapshot для всех global gauges. Page и reference chunks используют следующие snapshots; concurrent writes между ними допустимы. Classification представляет facts чтения и не может стать atomic destructive authorization.

Новый subtree не импортирует S3/storage/recovery services и не имеет state writes/row deletes. Real tests перехватывают S3 `send` и compensation: **0 calls**, и сравнивают MD5 ordered full-row Document/AuditLog contents до/после cycles/CLI. Attempts UPDATE/DELETE/CLEANED/deleteFenced в readonly transaction отвергаются PG; hashes остаются прежними. Existing app по-прежнему имеет свой synchronous storage lifecycle; гарантия «нет storage mutations» относится к новым observer/CLI, не ко всему backend.

## 7. Multiple Instances

Read-only duplicate observations безопасны для данных; global destructive lease/Redis lock/leader election не нужны. Каждый instance имеет свой cursor, pool, counters и latest successful gauge snapshot. Process overlap запрещён running promise guard и scheduler `waitForCompletion`; один due tick не запускает drain loop.

Multiple enabled instances увеличивают DB load и duplicate observations/warnings. `observed_total` не unique recovered count; backlog gauges нельзя суммировать. Минимальная стратегия после отдельного operational approval — один enabled observer instance, остальные disabled; если несколько, учитывать freshness каждого и общий capacity. Restart только сбрасывает cursor/counters; states/bytes не меняются.

Bootstrap включает Nest shutdown hooks. Shutdown запрещает ticks, ждёт активный batch и все lanes, закрывает pool. Existing Nest lifecycle hooks теперь выполняются при process signals; никаких новых storage actions в observation shutdown нет. Unit lifecycle tests проверяют overlap/interval/drain; real PG tests — multiple instances/restart/actual Nest scheduler DI.

## 8. Monitoring / Metrics

Используется существующий Prometheus default registry: configured `/metrics`, actual main global prefix `/api/v1`. Новый public recovery API не создаётся. Existing `app` default label сохранён.

| Metric (prefix `document_storage_observation_`) | Kind / source |
| --- | --- |
| pending_intents | Gauge, global raw PENDING count |
| rolled_back_intents | Gauge, global raw ROLLED_BACK count |
| unresolved_intents | Gauge, global operational attention backlog |
| oldest_unresolved_seconds | Gauge, oldest finite unresolved age по PG clock |
| malformed_intents | Gauge, invalid/unknown intents |
| referenced_intents | Gauge, intents с any Document refs |
| observed_total{category} | Counter, repeated process-local batch classifications |
| errors_total | Counter, failed complete cycles |
| batch_seconds | Histogram полного cycle, fixed buckets |
| last_success_timestamp_seconds | Gauge, timestamp complete success, 0 initially |

Unresolved включает PENDING/ROLLED_BACK, malformed, foreign refs, COMMITTED missing ref, CLEANED with ref и existing fence/manualReason. Young pending тоже входит; это не список eligible deletes. Pending/rolledBack counts включают malformed rows, если raw state совпадает; referenced считает intents, не unique keys.

Category label finite allowlist из девяти categories; histogram `le` fixed. Нет IDs/keys/owner/error-text labels. Gauges process-local cached **DB snapshot**, counters process-local repeated observations. Before first success/disabled gauges не измерены; после failure retained latest success, поэтому freshness обязательна. No partial metrics/cursor publication.

## 9. Diagnostic CLI

[CLI](../test/document-observation-cli.mjs): `yarn documents:observe --database-env OBSERVATION_DATABASE_URL --limit 10 --dry-run` после build; target variable устанавливается владельцем disposable DB. Flags: required `--database-env NAME`, optional limit 1..100 (default10), dry-run, help. Без dry-run также read-only. Unknown/duplicate/missing flags и `--apply` rejected до loading built modules/connection.

Explicit target guard допускает только loopback PostgreSQL, `[A-Za-z0-9_]+_test` DB, без query/hash; omitted port становится 5432. Не читает .env/Prisma config и не импортирует AppModule/MinIO. Docker не нужен. Локальный proxy/tunnel всё равно требует ownership verification. CLI намеренно ограничен disposable local diagnostics; production management target этим этапом не разрешён.

Output только aggregate summary + bounded-page category counts/observed/limit/readOnly/mode. Нет raw JSON, IDs/cursor/key/op/owner/credentials. Каждый запуск начинает первую page, global summary включает весь backlog. Success exit0, bad arguments/missing build/DB errors exit1 с generic error. Limits timeout взяты из safe default config; arbitrary timeout/target override flags отсутствуют.

## 10. Privacy / Security

Public Document responses и technical AuditLog hiding не менялись. Existing allowlist, JWT/current-DB ownership и 11-field serialization повторно проходят unit/real API/HTTP suites. Никакого raw journal endpoint не добавлено.

Worker выводит только fixed warning при failed cycle; repository/CLI не отражают raw errors/SQL params/credentials. Malformed journal row классифицируется и продвигает page; malformed key не отправляется ни в MinIO, ни в reference query как valid key. Bounded projection исключает произвольный большой/персональный payload из batch. Global summary использует untrusted fields внутри readonly SQL, guarded CASE для numeric casts и finite Date handling.

Test identities/data исключительно synthetic. Observation negative tests, real readonly failures и full-row hashes подтверждают отсутствие forbidden operations в exercised paths; source/import review подтверждает отсутствие такого runtime dependency. Это не замена независимого review.

## 11. Performance

Real PG17 disposable fixture, Node v22.15.1, current schema без proposed indexes/triggers. 50 013 Document rows (включая archived), 120 689 AuditLog: 120 089 unrelated events + 600 technical intents, из них первые20 malformed, далее580 PENDING. Permanent test проходит same schema catalog assertions и before/after hashes.

Final **standard runner** benchmark, batch10/concurrency1, пять cycles:

| Measurement | Result |
| --- | --- |
| Cycle latency, ms | 105.061 / 73.829 / 85.716 / 84.779 / 84.092 |
| Data SELECT count /5 cycles | 18: 3 base SELECT/cycle + reference query в последних3 cycles |
| Actual summary EXPLAIN ANALYZE | 79.275 ms |
| Actual initial candidate query | 12.604 ms, current AuditLog PK bitmap range scan/filter/top-N sort |
| Later candidate query | 0.516 ms, current PK range 560 rows |
| Reference query, ≤10 keys | 6.761 ms, Document sequential scan 50 013 rows |
| Process RSS before → after / sampled peak | 324 616 192 → 325 304 320 / 325 304 320 bytes |
| Process heap before → after | 75 024 384 → 75 723 448 bytes |
| Summary temp blocks / group memory | 42 read /111 written; hash aggregate 8257 KiB, disk656 KiB; join hash5152 KiB |

EXPLAIN захватывает actual runtime SQL/params, включая bounded projection; транзакционные BEGIN/config/COMMIT не входят в data SELECT count. Normal populated batch имеет 4 data SELECT при concurrency1, до7 при concurrency4; нет per-row reference query. Full SQL round trips больше: summary transaction4, candidate transaction5, reference transaction4/lane. Five measured cycles имеют57 transaction/query commands; это derived count, data-query instrumentation не измеряет BEGIN/config/COMMIT.

RSS/heap относятся к test process с Prisma/S3/Nest fixture dependencies, не isolated observer; sampled values не непрерывный peak profiler. Warm local timings/EXPLAIN после fixture writes не обещают cold/production SLO. Отдельный targeted run тоже прошёл (73.201–113.213 ms/cycle); в gate table используется final standard run.

Batches ограничивают returned candidates/JSON и concurrency, **не total DB scanned rows**. Global summary scans AuditLog и group Document keys каждый cycle; initial sparse candidate search тоже scan/filter большого PK range. Query timeout ограничивает workload отдельного statement; на больших объёмах возможны failed cycles/stale gauges. Without indexes tested size работает в default2s; evidence не требует остановки implementation на обязательном index gate.

F-OBS-01 (P2 operational note): capacity на actual workload/instances ещё не измерена. Возможное минимальное отдельное schema proposal: nonunique partial Document(fileKey) для non-null refs; partial technical AuditLog(id) для обеих namespaces. Только отдельный review/approval/measurement; migrations не добавлены. Summary hash aggregate/spill и growing retained journal требуют отдельной оценки, один index не устраняет все scan costs.

Default10/60s даёт примерно600 classifications/hour/instance; для600 intents — около часа полного sweep, плюс boundary tick. Новые/late commits могут ждать следующего sweep. Default10/1/disabled сохранены как local starting values; production defaults не выбраны по этому benchmark. Уменьшение interval/increase concurrency требует capacity test, а не автоматического tuning.

## 12. New Tests

**130 новых permanent unique tests:**

- 79 Jest cases в classifier + observation spec: все root states/UNKNOWN, typed malformed envelope/JSON/key, namespaces, active/archived/foreign refs, boundary staleness, pure/no dangerous outputs, finite metric labels, duplicate counters/gauge freshness, config bounds, disabled/overlap/interval/shutdown/outage/restart, failed lane drain и invalid batch bounds.
- 26 offline CLI cases: explicit target/limit/dry-run/help, remote DB/override/hash/invalid flags/apply/missing input rejected; no implicit env/secret reflection; failures safe/nonzero.
- 25 real PostgreSQL cases: bounded selection и pagination past malformed, high-watermark/concurrent new rows/deleted rows, namespaces/action filtering, active/archived/foreign/legacyNULL refs, states/global malformed parity/infinite dates/manual fences, readonly DML denial, server timeout/failed connection recovery, real unavailable loopback port, multiple instances/restart, bounded concurrency, S3/compensation negative traps + state hashes, real CLI privacy, real Nest scheduler DI, absence unapproved SQL indexes/triggers, actual-scale benchmark, two process timezones, UTC transaction/young pending, huge JSON projection.

Все новые tests mandatory: Jest picks `.spec.ts`; standard integration always runs CLI tests и observation PG suite; CI TS lint и new MJS lint обязателен. Standalone `yarn test:documents-observation` повторяет CLI/PG на своей newly migrated UUID test DB. New tests не skip/optional.

Разработка выявила timezone skew в первоначальном age query и fixture timestamp cast; исправлено explicit UTC чтением/clock arithmetic и regressions. Initial PG run 21/22, subsequent final25/25. Сохранён initial failure log. Также исправлены new-test TypeScript empty-array inference и unbound-method lint; assertions не ослаблены. Это промежуточные failures разработки нового observer, не скрытые baseline gate failures.

## 13. Full Regression Results

| Gate | Fresh result |
| --- | --- |
| Targeted observation Jest | 79/79 PASS, subset full Jest |
| Standalone observation runner | CLI26 + realPG25 =51/51 PASS |
| Full Jest | 52 suites, 619/619 PASS |
| Standard integration runner | 400/400 PASS; all24 TAP groups, no failures/skips |
| Real private Document API + PG + MinIO | 74/74 PASS |
| Real MinIO foundation | 20/20 PASS |
| Storage runner security | 13/13 PASS |
| Existing Document HTTP runner | 80/80 PASS, also mandatory standard subset |
| OpenAPI contract / migration | 11/11 +4/4 PASS inside standard runner |
| Prisma validate / generate | PASS, existing schema valid; client7.8.0 regenerated |
| Nest build | PASS |
| TypeScript noEmit | PASS |
| Full TS lint | PASS, no errors |
| MJS lint | PASS: CLI/test/observation runner, standard runner/utils, storage runner/test/config |
| git diff --check / new-file whitespace | PASS |

Unique repository total: **619 +400 +74 +20 +13 =1126**. New unique count79+26+25=130; historical996+130=1126 agrees with fresh result. Targeted79, standalone51, repeated HTTP80, OpenAPI11/migration4 и previous98 design probes не прибавляются второй раз. Existing standard runner guard47 и storage runner13 — разные files/cases, оба учтены.

Evidence logs локальные, ephemeral, не substitute hosted CI artifacts: `/private/tmp/oxus-phase2b3-observation-{targeted-jest,observation,jest,integration,private-api,minio,runner,document-http,validate,generate,build,typescript,lint,mjs-lint}.txt`; final plans/timing data — `/private/tmp/oxus-phase2b3-observation-benchmark-final.json`; initial failure — `...-observation-initial-failure.txt`.

Tests выполнялись только на newly owned local Docker Desktop fixtures: explicit Unix socket verified as local, PG17/Redis7 loopback65220/65221, separate runner-owned UUID `_test` DBs; MinIO owned labelled tmpfs/loopback containers. Реальные .env не читались; dotenv disabled и target environment whitelist. SQL cleanup подтвердил только bootstrap/postgres databases, **0 public tables**, отсутствие suite DB/MinIO containers. PG/Redis удалены по exact IDs после owner UUID checks. Global prune/чужие containers не трогались. Cleanup evidence: `/private/tmp/oxus-phase2b3-observation-cleanup.txt`.

## 14. Changed Files

| File/group | Purpose |
| --- | --- |
| src/modules/document/observation/document-intent-classifier.ts | Pure validation/classification |
| src/modules/document/observation/document-observation.config.ts | Bounds/defaults/finite config |
| src/modules/document/observation/document-observation.repository.ts | Readonly SQL/pagination/summary/reference/UTC/bounded projection |
| src/modules/document/observation/document-observation.service.ts | One bounded cycle / settled reference lanes |
| src/modules/document/observation/document-observation.metrics.ts | Existing registry aggregate metrics |
| src/modules/document/observation/document-observation.worker.ts | Scheduler/interval/overlap/drain |
| src/modules/document/observation/document-observation.module.ts | Narrow DI without SDK/App initialization |
| src/modules/document/observation/document-intent-classifier.spec.ts | Classifier permanent cases |
| src/modules/document/observation/document-observation.spec.ts | Config/metrics/service/worker permanent cases |
| src/app.module.ts / src/main.ts | Import observer / enable Nest shutdown hooks |
| test/document-observation-cli.mjs / .test.mjs | Safe diagnostics /26 offline tests |
| test/document-observation.test.ts | 25 real PG tests + synthetic performance |
| test/run-document-observation.mjs | Own disposable DB targeted runner |
| test/run-integration.mjs | Mandatory CLI/PG suite integration |
| package.json | Three scripts; no dependency/lock changes |
| .github/workflows/ci.yml | Required MJS lint; existing standard gate includes observer |
| docs/student-documents-recovery-runbook.md | Actual commands/config/metrics/manual vs proposed boundary |
| docs/student-documents-phase2b3-observation-report.md | Current implementation/results/gates |

13 new source/test files, five tracked modified files, updated ignored runbook and new ignored report. Existing `/docs` ignore rule сохранён; report/runbook не попадут в обычный `git diff` автоматически. Index пуст, документация доступна в workspace; её включение в будущий commit требует явного выбора пользователем. Старые reports/design/security evidence не редактировались.

## 15. Findings P0–P3

**New confirmed P0:0; P1:0.** No demonstrated unsafe mutation path в новом observation functionality. Intermediate UTC bug закрыт regressions до gate.

| Finding | Priority / status | Scope / remaining action |
| --- | --- | --- |
| F-OBS-01: scan cost / sweep freshness / production capacity | P2 note OPEN | Warm actual-schema evidence выше; separate capacity/index gate перед enable |
| F-2B1-03: cold CI/resources/unpinned images/deadlines | Inherited P2 OPEN | Hosted cold gate, reproducible images and resource/command/cleanup budgets отдельно |
| F-2B1-04: remote Docker context locality | Inherited P2 OPEN | Existing runner не безопасен для arbitrary remote daemon без дополнительной проверки; explicit local socket здесь не исправляет runner |
| F-2B2-R01: unreachable download TimeoutError branch | Inherited P3 OPEN | Controller unchanged; отдельная узкая remediation |

Full auto recovery architecture blockers не понижаются до harmless release notes: они остаются blocking для destructive protocol. Existing limitations: client JWT-download signoff, total concurrent upload memory/admission, proxy/stream deadlines, shallow file validation/AV, private object versions/retention/unknown remote outcomes — не закрыты observer. Hosted CI и production capacity здесь не выполнялись.

## 16. Remaining Architectural Blockers U1 / U2 / G1

- **U1:** maxAttempts=1/fresh key/flags не доказывают единственного producer или отсутствия другого Put. Нужны approved per-key ownership/permit и durable dispatch/wire outcome semantics.
- **U2:** consumed PENDING reservation нельзя удалить/переписать и затем переиспользовать key/journal. Unique index сам по себе не сохраняет reservation history; approved retention/tombstone policy не реализована.
- **G1:** SQL authorization/fence не отзывает future external send paused/stale process после read. Нужны approved dispatch boundary/semantics и handling неизвестных outcomes.

Read-only monitoring не требует grants и не обходит эти blockers. Нет новой mutation, SQL fence trigger, migration, delete grant, CLEANED transition, PENDING→ROLLED_BACK, AuditLog prune или recovery proof. Original **Final Architecture Gate NOT APPROVED** сохранён; новый observation stage не утверждает отвергнутый protocol.

## 17. Backend Commit Gate

**PASS WITH NOTES.** Минимальная observation implementation работает на current schema; mandatory local tests/quality gates пройдены; privacy, readonly transactions, pagination, timeout/outage/drain и mutation-negative assertions покрыты. Scope/index/user docs сохранены. Можно перейти к независимому code review и затем отдельному commit после review, включая явное решение по ignored docs.

Notes: production capacity/sweep freshness, hosted cold CI/resource/local Docker runner gates и inherited P3 остаются открытыми. Реальные серверы не использовались. Commit/push/deploy не выполнены; это implementation self-review, не independent approval.

## 18. Production Deployment Gate

**NOT READY.** Observation feature disabled by default и ещё требует independent review/hosted mandatory CI, actual DB capacity/query plans, enabled-instance strategy, metrics freshness/alerts, operator access и rollout approval. Existing product/client/infrastructure gates остаются. Отдельный complete automatic recovery не разрешён, U1/U2/G1 не решены; monitoring не обеспечивает orphan cleanup или durable terminal proof.

### Ответы на итоговые вопросы

1. Реализованы readonly classifier/repository/service/worker, monitoring, CLI, mandatory tests и runbook.
2. Все четыре root states плюс UNKNOWN/malformed; девять diagnostic categories, оба namespaces.
3. В observer/CLI storage mutation path отсутствует; SDK/storage/compensation dependencies отсутствуют. Existing synchronous app path сохранён.
4. Runtime observer/CLI не изменяют Document/AuditLog; actual PG readonly и full-row hashes это проверили.
5. PostgreSQL global snapshot gauges, finite-label local counters, batch histogram и last-success freshness в existing Prometheus endpoint.
6. CLI показывает aggregate backlog и bounded first-page classification; не показывает journal/identity и не repair tool.
7. Один batch/tick, stable keyset/high-watermark, limit≤100, lanes/pool≤4, no overlap/drain loop, per-query/connection timeout; full aggregates требуют capacity review.
8. Новые130 и общий1126 unique tests PASS; repeated subsets не суммируются.
9. Новых подтверждённых P0/P1 нет; P2 infrastructure/performance notes и U1/U2/G1 явно сохранены.
10. Да, independent code review можно начинать. Production Deployment Gate остаётся NOT READY.
