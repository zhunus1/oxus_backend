# Phase 2B-3B — Independent Final Code Review

Дата: 2026-10-10, Asia/Almaty. Baseline HEAD `d1ab3bed7f8d058e839d1036a59f83a5f74d402b`.
**Backend Commit Gate: PASS WITH NOTES. Production Deployment Gate: NOT READY.**

## 1. Executive Summary

Свежая read-only перепроверка всего accumulated implementation diff, включая untracked source/tests и ignored документацию. Прежний PASS не использован вместо новых доказательств: повторены все requested gates и отдельно созданы temporary independent PostgreSQL probes.

**1126/1126 уникальных repository tests PASS; отдельно 32/32 temporary probes PASS.** Никаких новых подтверждённых P0/P1. Новой destructive storage или Document/AuditLog mutation цепочки не обнаружено. Девять categories, оба namespaces, malformed/reference priority, UTC и keyset semantics корректны в проверенных scenarios. No demonstrated privacy leak или unbounded resource leak.

Вывод относится к observation-only stage. Он не утверждает automatic-delete protocol, не закрывает U1/U2/G1, client download sign-off, legacy files или infrastructure gates. Можно подготовить отдельный Phase 2B-3B commit; он здесь не выполнялся.

Основные документы: [implementation report](student-documents-phase2b3-observation-report.md), [actual runbook](student-documents-recovery-runbook.md), [fencing validation / NOT APPROVED](student-documents-phase2b3-fencing-validation-report.md), [Phase 2B-2 release](student-documents-phase2b2-release-review.md).

## 2. Git Scope Inventory

Branch `release/manual-contract-candidate`; HEAD соответствует baseline. Git index пуст; его SHA-256 сохранён. До audit snapshot зафиксированы **706 existing files**: 677 tracked, 13 untracked source/tests и 16 ignored docs/system files в docs. Все 706 совпадают после audit по SHA-256; HEAD и index также сохранены. Единственный новый repository файл этого review — данный ignored report. Build/generate меняют только обычные ignored artifacts.

### Tracked accumulated diff — пять файлов

| File | Изменение относительно baseline |
| --- | --- |
| src/app.module.ts | Import и registration ObservationModule |
| src/main.ts | `enableShutdownHooks()` для Nest graceful shutdown |
| package.json | Observation test/CLI/MJS lint scripts; no dependencies/lock changes |
| test/run-integration.mjs | Mandatory CLI tests и real PG observation suite |
| .github/workflows/ci.yml | Mandatory observation MJS lint; existing gates сохранены |

### Untracked accumulated implementation — 13 файлов

| File | Purpose |
| --- | --- |
| src/modules/document/observation/document-intent-classifier.ts | Pure typed classification |
| src/modules/document/observation/document-intent-classifier.spec.ts | Classifier regression tests |
| src/modules/document/observation/document-observation.config.ts | Explicit finite bounds/default disabled |
| src/modules/document/observation/document-observation.repository.ts | Read-only SQL, summary/page/refs |
| src/modules/document/observation/document-observation.service.ts | One bounded cycle, settled lanes |
| src/modules/document/observation/document-observation.worker.ts | Cron, due/overlap/cursor/shutdown |
| src/modules/document/observation/document-observation.metrics.ts | Existing registry aggregate metrics |
| src/modules/document/observation/document-observation.module.ts | Narrow DI |
| src/modules/document/observation/document-observation.spec.ts | Config/service/worker/metrics regressions |
| test/document-observation-cli.mjs | Diagnostic CLI |
| test/document-observation-cli.test.mjs | Offline CLI guards |
| test/document-observation.test.ts | Real PG regressions/benchmark |
| test/run-document-observation.mjs | Disposable DB owning runner |

### Ignored inventory

Before review docs содержали 24 files: 23 Markdown + .DS_Store; восемь tracked, остальные16 ignored. Все существующие docs сохранены. Phase implementation relevant ignored files: observation-report и updated recovery-runbook; architecture proposal, fencing-validation, initial recovery-report и docs-cleanup-review тоже реально присутствуют.

Остальные ignored docs: CI hardening report/remediation/final-review, CRUD design review, Phase1 security/final-review, Phase2B1 storage report, Phase2B2 implementation/final-review и docs/.DS_Store. Ни один не считался отсутствующим/ненужным и не редактировался.

Outside-docs ignored inventory: dependency/build/generated directories, Yarn/Python/Ruff caches, system .DS_Store и local environment/key files. Environment/key contents не читались и не использовались audit harness; dotenv disabled. Никаких docs cleanup/move/delete или application/test/CI edits в этом review.

Baseline comparison подтверждает отсутствие diff в Document API/upload/download, synchronous compensation, storage services, Prisma schema/45 SQL migrations, public AuditLog serialization, JWT/ownership, contracts/payments/Lead и deployment configuration. Bootstrap shutdown hook активирует существующие Prisma disconnect/Lead session cleanup/framework shutdown hooks; чтение callbacks не обнаружило новых domain/storage mutations. Source callbacks не изменены.

## 3. Read-only Boundary

Прослежена цепочка [worker:20](../src/modules/document/observation/document-observation.worker.ts#L20) → [service:19](../src/modules/document/observation/document-observation.service.ts#L19) → [repository:76](../src/modules/document/observation/document-observation.repository.ts#L76) → PG. Runtime SQL содержит только SELECT, BEGIN/COMMIT и transaction-local config. Нет INSERT/UPDATE/DELETE, grants, state transitions, technical journal rewrite/prune или compensation calls. JSON projection возвращает diagnostic markers, не записывает recovery metadata.

Каждая read group начинает `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; transaction_read_only=on/isolation/UTC/server timeout подтверждены real PG probe I01. Temporary I02–I06 попытались UPDATE Document, CLEANED/deleteFenced update, DELETE/INSERT AuditLog: PG отверг DML, full-row hashes неизменны. Fixture setup/teardown SQL в tests разрешён только внутри runner-owned disposable DB и не является observer runtime path.

Module/CLI dependency graphs не импортируют S3/MinIO/Recovery/AppModule. Worker не вызывает HEAD/Put/Copy/Delete и не создаёт buckets/policies. S01 перехватил SDK send и compensation, запустил real worker, затем CLI с import guard: **0 SDK/compensation calls**, DB hashes неизменны. CLI imports guard отвергает dotenv/config, AppModule, Prisma config, MinIO/SDK/recovery imports.

[Repository:88](../src/modules/document/observation/document-observation.repository.ts#L88) sanitizes database errors; worker warning/CLI error fixed. Existing full application имеет storage upload/compensation paths — они сохранены; «нет mutations» относится к новым observer/CLI. Существующий public MinIO lifecycle не запускается новой isolated diagnostic цепочкой; полный AppModule сохраняет baseline lifecycle side effects.

## 4. Classifier

[Classifier:43](../src/modules/document/observation/document-intent-classifier.ts#L43) проверяет typed envelope/details: exact action/namespaces, canonical lowercase v4 UUID/private key, safe positive numeric IDs, portrait equality, documentId null/positive integer, root state и finite Date. Arrays/scalars/null/missing/string IDs, unknown state и malformed identity идут в MALFORMED_INTENT. Unknown future JSON не становится proof.

[Priority:73](../src/modules/document/observation/document-intent-classifier.ts#L73): malformed → manual/fence/foreign/CLEANED-with-ref → refs → COMMITTED missing → CLEANED terminal → ROLLED_BACK unresolved → pending age. Existing manualReason string (включая empty string) и true fence классифицируются консервативно, но не изменяются.

| Condition | Category |
| --- | --- |
| Invalid envelope/details/root state | MALFORMED_INTENT |
| Foreign portrait refs / CLEANED with refs / existing manual/fence | MANUAL_REVIEW_REQUIRED |
| COMMITTED with own-portrait refs | COMMITTED_REFERENCED |
| PENDING/ROLLED_BACK with own-portrait refs | REFERENCED_OBJECT |
| COMMITTED without refs | COMMITTED_MISSING_REFERENCE |
| CLEANED without refs | CLEANED_TERMINAL |
| ROLLED_BACK without refs | ROLLED_BACK_UNRESOLVED |
| PENDING without refs, age < threshold | IN_FLIGHT_OR_UNKNOWN |
| PENDING without refs, age ≥ threshold | UNRESOLVED_PENDING |

Archived references включены: [repository:123](../src/modules/document/observation/document-observation.repository.ts#L123) не фильтрует deletedAt; min/max portrait выявляет foreign refs при нескольких rows. Legacy NULL fileKey не преобразуется из fileUrl. Both namespaces verified; malformed приоритет выше manual/foreign. C1–C11 проверили categories/priority/types/age, S03 — разные process timezones.

UTC фиксируется server transaction и `createdAt AT TIME ZONE 'UTC'`; PG timestamptz clock не зависит от Node timezone. Infinite timestamp помечается malformed и не создаёт Infinity age; permanent PG suite повторён. Предполагается current schema UTC timestamp convention; historical wrong-zone data нельзя восстановить одной timezone setting.

Выход `{category,state,referenced}` не имеет action/proof/grant. Category/root state различаются; CLEANED_TERMINAL не доказывает object absence, age/no-ref/HEAD404 не авторизуют Delete.

## 5. Pagination

[Repository:108](../src/modules/document/observation/document-observation.repository.ts#L108): stable `id ASC`, strict lower bound, fixed upper watermark, bounded LIMIT. Malformed rows включены и продвигают cursor; short/empty page reset, exact-full final page требует boundary empty tick. Cursor local и обновляется после complete cycle success.

P01 создал20 malformed rows и вставлял новые rows во время sweep: upper watermark не рос; второй full batch и empty page завершили старый sweep. Новые inserts не могут бесконечно продлить fixed finite диапазон. P02 отдельно держал transaction с ранее allocated smaller ID, затем committed после cursor: row обнаруживается на следующем sweep; higher new ID тоже deferred. P03 проверил deletion между pages и restart без journal mutation. Failure probe R06 сохранил cursor; permanent unit/PG tests подтверждают то же.

Memory bounded candidate count≤100 и projection expected-length strings/safe IDs/finite state/marker; S04 сохранил4MiB arbitrary private JSON только в fixture и получил page<1500 bytes без raw manual text. SQL всё равно читает/обрабатывает stored JSON на сервере, поэтому bounded returned memory не означает bounded scan CPU.

**No healthy-path infinite starvation:** fixed watermark и increasing cursor завершают finite sweep. Но нет wall-clock freshness guarantee: большой retained journal, recurring query failure/outage или repeated restarts могут откладывать new rows. При10/60s throughput≈600 classifications/hour;600 intents требуют около часа sweep,120000 technical intents — порядка200 часов. Global gauges обновляются каждый successful cycle независимо от достижения новых page IDs. Это operational F-OBS-01, не durable processing/proof.

## 6. PostgreSQL Resource Safety

[Pool:66](../src/modules/document/observation/document-observation.repository.ts#L66) lazy; max=config concurrency1..4. R01: disabled worker при nonempty DB имел0 connections/reads. R02: четыре real reference lanes за advisory-lock barrier дали четыре live pool connections/backends, все завершились. No per-row query; chunks bounded, [allSettled:25](../src/modules/document/observation/document-observation.service.ts#L25) не возвращает failure до settling остальных lanes (R05).

Failed connections уничтожаются `release(true)`; readonly aborted transaction не возвращается в pool. Server statement/lock timeout и client/connection timeout установлены. Idle connection error handler предотвращает process crash/raw details; outage probe проверил real closed loopback port и sanitized rejection. Не обнаружено unhandled rejection в final probes/regressions.

R03: server SELECT ожидал real advisory lock; shutdown запретил следующий tick и не закрыл pool до release barrier. После query completion pool ended, observer backends исчезли; hashes unchanged. [Worker:44](../src/modules/document/observation/document-observation.worker.ts#L44) drains current promise, [main:18](../src/main.ts#L18) включает реальные Nest shutdown hooks. Multiple instances/restarts не меняют state; глобальные locks для безопасности данных не требуются.

### Client timeout не равен немедленной server cancellation

Source [repository:70](../src/modules/document/observation/document-observation.repository.ts#L70), [destroy:93](../src/modules/document/observation/document-observation.repository.ts#L93); installed pg client `node_modules/pg/lib/client.js:654` implements read timeout без автоматического CancelRequest.

R04 сначала подтвердил actual `pg_sleep(10)` execution через pg_stat_activity, затем controlled timer вызвал client timeout. После rejection **pool connections=0, но один server query ещё active**. Independent server `statement_timeout=1s` остановил его: backend исчез, elapsed **1020.304ms**, без мутаций. Default runtime server timeout2s короче client2.5s; forced client deadline100ms использован только в temporary probe, не менял repository config/code.

Таким образом cleanup/cancellation bounded, но закрытие TCP client не гарантирует мгновенного прекращения SQL. Pool max ограничивает live client pool, а кратковременно оставшиеся server backends после timeout нужно учитывать в capacity/shutdown budget. No unbounded leak demonstrated. Общий batch/drain deadline не равен одному per-query timeout; maximum config server timeout10s. Это resource semantics/operational note, не новый destructive/security defect.

## 7. Metrics

[Metrics:19](../src/modules/document/observation/document-observation.metrics.ts#L19) registers PostgreSQL-derived pending/rolledBack/unresolved/oldest/malformed/referenced gauges в existing registry; [main prefix:22](../src/main.ts#L22) и existing Prometheus path сохраняются, новый endpoint не создан.

Global summary один repeatable-read snapshot/statement. Candidate/reference reads имеют последующие snapshots: consistency sufficient для observations, не atomic authorization. Unresolved включает все PENDING/ROLLED_BACK (young тоже), malformed, foreign refs/manual/fence, COMMITTED missing и CLEANED with refs. Referenced counts intents, не unique keys/objects; archived included.

Counters/errors/histogram process-local; repeated row observations не unique recoveries. Finite nine-value category labels, fixed histogram buckets и baseline app label, без keys/IDs/owner/error text. M01 проверил два instances и bounded labels. Не складывать backlog gauges разных replicas.

[Success:46](../src/modules/document/observation/document-observation.metrics.ts#L46) вызывается после всего batch; on failure retained latest snapshot/freshness, увеличивается только errors и duration. R06 изменил fixture backlog между success/failure и подтвердил отсутствие partial gauges/cursor/fresh-success publication.

До первого success/при disabled worker gauges=0, last_success=0: это unmeasured, не доказанный пустой backlog. R01 проверил nonempty DB с такими startup metrics. Freshness необходима в scrape/alerts; failure после первого success не обнуляет backlog. Existing production logger может скрывать warn уровни; metrics/error/freshness остаются основным observation signal.

## 8. CLI Security

[CLI:9](../test/document-observation-cli.mjs#L9) требует explicit environment-variable target; implicit DATABASE_URL не используется. [URL guard:19](../test/runner-utils.mjs#L19) разрешает только literal loopback PostgreSQL, `_test` DB, без query/fragment; omitted port fixed5432. Unknown/apply/duplicate/unsafe override flags rejected до built-module loading/connection.

S02 проверил remote host, production DB, host query overrides, encoded path/query, fragment, localhost-dot/IPv6/encoded slash и bad flags. Safe exit1/stderr, empty stdout; direct remote/production targets не использовались и отвергаются. Valid CLI exit0 checked S01/S03, offline26 tests повторены.

S01 с forbidden import guard и hostile inherited PGHOST/PGPORT/PGDATABASE/DOTENV_CONFIG/remote AWS endpoint всё равно использовал explicit owned local URL; без AppModule/MinIO/.env initialization. Output aggregate-only, no IDs/key/op/owner/cursor/credentials/raw JSON. CLI command не repair tool и не full-journal enumeration: bounded first page плюс global summary, read-only даже без dry-run; Docker не нужен.

Guard не является доказательством физической принадлежности loopback service: malicious/local tunnel к remote DB, переименованный remote target или untrusted process preloads вне этой модели. Поэтому абсолютное обещание «никакой Production/Test при любом окружении» невозможно; runbook верно требует ownership verification. В audit explicit local daemon/owned DB verified, реальные env не подгружались. Production management CLI этот этап не разрешает.

## 9. Performance

Fresh actual-schema benchmark в temporary B01; baseline45 migrations, catalog без custom recovery triggers/new indexes. `ANALYZE` выполнен на synthetic DB. Первый набор50 013 Document/120 689 AuditLog (600 technical/20 malformed); второй удвоен до100 026/241 378 (1200 technical/40 malformed). Archived rows и unrelated AuditLog присутствуют; fixture doubling сохраняет same-key duplicates.

| Measurement | 50k/120k | 100k/240k |
| --- | ---: | ---: |
| Cycle times, ms /5 cycles | 174.128 /150.605 /158.949 /160.808 /160.020 | 125.827 /98.852 /116.268 /138.785 /117.401 |
| Actual global summary EXPLAIN, ms | 152.240 | 110.651 |
| Initial candidate EXPLAIN, ms | 10.062 | 13.827 |
| Later candidate EXPLAIN, ms | 0.231 | 0.244 |
| Batch refs EXPLAIN, ms | 6.635 | 13.328 |
| Data SELECT /5 cycles | 18 | 18 |
| Live pool connections, concurrency1 | 1 | 1 |
| RSS before → after, bytes | 302694400 →302694400 | 302694400 →302694400 |
| Heap before → after, bytes | 61729424 →62568296 | 62762248 →63438864 |
| Summary temp read/written blocks | 380/381 | 162/300 |

Initial candidate — Seq Scan + bounded top-N ordering after ANALYZE; later candidate — existing AuditLog PK index range; references — full Document Seq Scan50k→100k. Global summary scans journal/groups Document keys; second plan использует parallel AuditLog scan/другую aggregate/join strategy, поэтому faster doubled summary **не означает sublinear guarantee**. Per-worker scan rows нужно умножать на actual loops. Cache/planner variation объясняет немонотонные timings; cold CI/production workload не измерены.

SQL captured from actual service calls, не simplified replacement queries. Instrumentation count excludes BEGIN/config/COMMIT. RSS whole probe process включает Prisma/S3/Nest dependencies и GC; не isolated-worker peak profiler. Negative raw-payload bound measured отдельно S04. Parallel lane connection cap measured R02, не extrapolated from concurrency1 benchmark.

F-OBS-01 подтверждён: returned batch bounded, server scan growth/full aggregates и sweep freshness остаются capacity risks. Tested scale укладывается в default2s; mandatory performance blocker для disabled-by-default backend commit не найден. Production enable требует workload/instance budget и separate approved index design при необходимости. Никаких index/schema изменений в review.

## 10. Independent Probes

**32 unique temporary cases,32 PASS,0 fail/skip/cancel/todo.** Вне repository: [probes](/private/tmp/oxus-phase2b3-final-review/probes.mjs), [owning runner](/private/tmp/oxus-phase2b3-final-review/probe-runner.mjs), [CLI import guard](/private/tmp/oxus-phase2b3-final-review/cli-import-guard.cjs). Они не добавлены в CI/repository test count.

| IDs /count | Independent evidence |
| --- | --- |
| I01–I06 /6 | Actual readonly/session settings; five DML denials; hashes |
| C1–C11 /11 | All categories/priority, namespaces, archived/foreign refs, malformed/types/newline, age boundary |
| P01–P03 /3 | Fixed finite sweep, newer inserts, earlier allocated late commit, deletion/restart |
| R01–R06 /6 | Lazy/disabled,4 real connections, shutdown barrier, client/server timeout, failed-lane drain, outage/freshness/cursor |
| S01–S04 /4 | Zero storage/compensation, forbidden imports, safe CLI targets/errors, two timezones,4MiB projection |
| M01 /1 | Multiple instances and finite labels |
| B01 /1 | Actual EXPLAIN/memory/connections/scan growth at two scales |

Race probes используют actual pg_stat_activity/advisory-lock barriers и explicit commit ordering, без random sleeps. SQL sleep только для timeout injection; controlled client timer armed/fired after server execution barrier. Hash assertions относятся ко всем Document/AuditLog rows после fixture setup; никаких observer-created rows/states/fences.

Initial full temporary runs имели31/32: timeout harness не достиг execution barrier; focused probe прошёл. Final instrumentation подтвердило real active query до forced deadline;32/32 прошли. Failed/diagnostic traces сохранены в temporary folder, assertions не ослаблены. Это coordination failures temporary harness, не проигнорированный repository failure. No real network partition simulated; forced timeout и actual server statements проверены.

## 11. Full Test Results

| Gate | Fresh independent result |
| --- | --- |
| Full Jest | 52 suites,619/619 PASS |
| Standard integration | 400/400 PASS,24 TAP groups, no failures/skips |
| Observation runner | CLI26 + real PG25 =51/51 PASS, repeated subsets |
| Real private API /PG/MinIO | 74/74 PASS |
| Real MinIO foundation | 20/20 PASS |
| Storage runner security | 13/13 PASS |
| Document HTTP security runner | 80/80 PASS, standard subset |
| OpenAPI /migrations | 11/11 +4/4 PASS inside standard |
| Prisma validate /generate | PASS, existing schema; client7.8.0 |
| Nest build /TypeScript | PASS /PASS |
| Full TS lint | PASS after generate completed |
| MJS lint | PASS, new CLI/test/runner + existing runner/utils/storage/config |
| git diff --check /untracked whitespace | PASS /PASS |
| Temporary independent probes | 32/32 PASS, отдельно |

Repository unique total **619+400+74+20+13=1126**. Existing implementation additions130 already included. Standalone51, HTTP80, OpenAPI11/migration4 и temporary32 не прибавляются повторно; historic996/98 design probes не заменяют этот repeat.

Первый TS lint был ошибочно запущен одновременно с Prisma generation и выдал3 unnecessary assertions в неизменённых seed/HTTP files; fresh lint после завершения generation PASS с теми же source hashes. Вероятная причина — промежуточные generated types; CI порядок sequential и не изменялся ради обхода ошибки. Initial lint log сохранён, final PASS — `lint-final.txt`. Никаких --fix/source changes.

Logs: `/private/tmp/oxus-phase2b3-final-review-{validate,generate,build,jest,integration,observation,private-api,minio,runner,document-http,probes,typescript,lint-final,mjs-lint,diff-check,cleanup}.txt`. Actual plans: [performance.json](/private/tmp/oxus-phase2b3-final-review/performance.json). Artifacts ephemeral/local, не hosted CI results.

New verified Docker Desktop local Unix socket `/Users/johnycarlson/.docker/run/docker.sock`, owner-labelled PG17/Redis7 bound loopback51473/51474, fresh runner-owned UUID `_test` DBs; storage suites создавали owned MinIO fixtures. Environment whitelist и dotenv/dev-null исключили реальные project env. После gates/probes SQL подтвердил только bootstrap/postgres DBs,0 public tables, отсутствие suite DB/MinIO containers. Exact-ID PG/Redis removal после owner checks; manifest cleaned=true. No global prune/чужие resources/Production/Test.

## 12. Findings P0–P3

**New confirmed P0:0. P1:0. Mandatory backend remediation не требуется по полученным evidence.** Open findings остаются notes/activation blockers, без скрытого исправления в audit.

| ID | Severity/status | Source file:line / evidence / next action |
| --- | --- | --- |
| F-OBS-01 | P2 OPEN, independently confirmed | [summary:39](../src/modules/document/observation/document-observation.repository.ts#L39), [refs:123](../src/modules/document/observation/document-observation.repository.ts#L123), [interval:32](../src/modules/document/observation/document-observation.config.ts#L32). B01 actual scan50k→100k refs6.635→13.328ms, full summaries/temp IO; P01/P02 eventual sweep. Separate production capacity/index/freshness gate; no new migration |
| F-2B1-03 | Inherited P2 OPEN | [mutable bases:3](../test/minio.Dockerfile#L3), [runtime:9](../test/minio.Dockerfile#L9), [child command:27](../test/run-student-document-storage.mjs#L27), [tmpfs:63](../test/run-student-document-storage.mjs#L63). No command/resource caps; warm local gate не cold hosted gate. Separate pinning/budgets/kill-cleanup review |
| F-2B1-04 | Inherited P2 OPEN | [Docker side effect:48](../test/run-student-document-storage.mjs#L48), [daemon-host bind:62](../test/run-student-document-storage.mjs#L62). No locality guard перед build/create. **Runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки.** Remote execution не performed; local socket verification здесь не исправляет runner |
| F-2B2-R01 | Inherited P3 OPEN | [deadline:115](../src/modules/document/api/document.controller.ts#L115), [TimeoutError:146](../src/modules/document/api/document.controller.ts#L146). Cleanup abort без reason; unreachable branch сохранена. Existing deadline tests safe; отдельный cleanup, не commit blocker |

Client timeout residual server execution подтверждён R04 и описан в resource section. Это bounded readonly cleanup semantics, не новый P0/P1 или infinite leak. Startup gauges требуют last-success interpretation; disabling observer не очищает backlog. Полнота absence-of-mutation вывода ограничена reviewed dependency graph и exercised flows, не arbitrary future code/DB role compromise.

Reproduction: после build на separately verified disposable loopback base установить DATABASE_URL без project .env и выполнить `node /private/tmp/oxus-phase2b3-final-review/probe-runner.mjs`; runner creates/migrates/drops only its UUID DB. B01/R04 evidence сохраняется в temporary outputs. Existing repository quality commands unchanged, mandatory CI integration проверена [runner:30](../test/run-integration.mjs#L30)/[37](../test/run-integration.mjs#L37), [CI lint:78](../.github/workflows/ci.yml#L78)/[integration:100](../.github/workflows/ci.yml#L100).

## 13. Remaining Risks

- **U1/U2/G1 OPEN / automatic destructive recovery NOT APPROVED**: [validation:62](student-documents-phase2b3-fencing-validation-report.md#L62), [80](student-documents-phase2b3-fencing-validation-report.md#L80), [94](student-documents-phase2b3-fencing-validation-report.md#L94). Single producer/durable wire outcome, consumed reservation retention и paused future send boundary не решены monitoring. Proposed triggers/grants/proof не installed/approved.
- **F-OBS-01**: actual production capacity, retained journal scan costs, per-instance DB budget, full-sweep freshness и possible separately approved indexes. Failed aggregate query блокирует cycle и делает gauges stale; alerts нужны.
- **F-2B1-03/F-2B1-04**: hosted cold CI/resource/cleanup/locality gate; repeated warm local successes их не закрывают.
- **B-2B2-CLIENT**: реальный frontend/mobile JWT binary download implementation/sign-off/e2e отсутствует; private locator не anonymous public URL.
- **Legacy public files /Phase2C**: NULL fileKey сохраняет прежний public locator; observer не мигрирует/не удаляет bytes и не обеспечивает их приватность.
- **B-2B2-RECOVERY**: observation/metrics/runbook реализованы как subset; orphan cleanup, terminal proof/fencing/retention/manual ownership и unknown outcomes остаются separate unfinished work.
- **Inherited P3 TimeoutError**, shallow validation/AV, concurrent upload memory/admission, object versions/retention, proxy/stream deadlines и in-flight access revocation limitations сохранены.
- Read-only replicas могут дублировать observations/load; counters не unique recoveries, cached gauges требуют freshness. No capacity/alerts/enable action на real servers выполнено.

## 14. Backend Commit Gate

**PASS WITH NOTES.** Свежий complete local regression gate,32 independent probes, scope/hash/index checks подтверждают минимальный observation-only change. Новых P0/P1 нет; mandatory remediation перед отдельным backend commit по этому review не требуется. Можно создать отдельный Phase 2B-3B commit, сохранив эту границу и все open notes.

Ignored implementation/report/runbook/final-review docs не попадут в обычный git add автоматически: пользователь должен осознанно выбрать documentation для будущего commit. Этот audit не меняет ignore/index и не выполняет commit/push. Hosted CI остаётся обязательным перед merge/release; recommendation не является production authorization.

## 15. Production Deployment Gate

**NOT READY.** Требуются hosted mandatory CI/cold resource/locality verification, production capacity/sweep/alert/instance strategy, actual operational approval и JWT client sign-off. Legacy privacy/migration и полный recovery protocol остаются отдельными gates; U1/U2/G1 не сняты зелёными backend tests.

| Итоговый вопрос | Ответ |
| --- | --- |
| 1. Новые P0/P1? | Нет подтверждённых |
| 2. Отсутствие mutations новым worker/CLI доказано? | В reviewed runtime graph и tested real flows — да: explicit readonly, DML denials, zero SDK/compensation и unchanged full-row hashes |
| 3. Классификация корректна? | Да в проверенных nine-category/type/reference/namespace/age/UTC cases; observation не authorization |
| 4. Есть персональные leaks? | Не найдены: aggregate CLI/metrics/generic errors; public allowlist/API unchanged |
| 5. Опасные resource leaks? | Не обнаружены; pool/lanes/shutdown bounded. Server read может кратко продолжаться после client close, ограничен statement_timeout |
| 6. Сколько tests? | 1126 unique repository PASS; отдельно32 temporary PASS, без subset double-counting |
| 7. Можно отдельный Phase2B-3B commit? | Да, PASS WITH NOTES; source/index preserved, commit не выполнен |
| 8. Что блокирует Production? | U1/U2/G1/full recovery, client sign-off, capacity/freshness/alerts, hosted cold CI/resources/locality/rollout; legacy files остаются Phase2C scope |
