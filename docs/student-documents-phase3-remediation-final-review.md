# Phase 3 — Final Independent Remediation Re-Review

Дата: 2026-10-10, Asia/Almaty. Проверенный baseline HEAD: `2296e351442064b9d18fed9dca6af4cb5bd42bb6`.

**F-3-R01: CLOSED. Backend Commit Gate: PASS WITH NOTES. Production Deployment Gate: NOT READY.**

## 1. Executive Summary

Read-only проверка staff-only numeric remediation и accumulated Phase 3 diff. Повторены все запрошенные локальные gates: **1383 уникальных repository tests PASS**. Отдельно выполнены **34/34 temporary independent probes PASS**, включая **201 HTTP rejection с 400**. Для каждого rejection сравнены все Document rows, все AuditLog rows, technical intent rows и SDK counters; изменений нет. Repeated subsets и temporary probes не добавлены к repository total.

Новых подтверждённых P0/P1, обхода raw numeric validation, IDOR, нарушения CAS или неожиданного SDK write не обнаружено. Boolean JSON version и owned hexadecimal query/upload воспроизведения теперь отклоняются до pipes/service mutation. Canonical query/multipart значения доходят до service как numbers; действующие staff requests сохраняются.

Этот review независимо перепроверяет фактическое состояние кода и новые запуски, а не переносит PASS из [remediation report](student-documents-phase3-remediation-report.md). Сохранены [implementation report](student-documents-phase3-staff-crud-report.md) и [предыдущий Final Review](student-documents-phase3-final-review.md). Статус OPEN в предыдущем review описывает historical pre-remediation finding; этот документ фиксирует его closure.

Единственный новый repository файл данного review — этот отчёт. Source/tests/CI/Prisma/существующие отчёты не изменены. HEAD/branch/index сохранены; Git add/commit/push/deploy не выполнялись. Production/Test не использовались.

## 2. Git Scope

Ветка `release/manual-contract-candidate`, HEAD совпал с baseline, index пуст. До запуска проверены staged/unstaged/untracked inventories; обнаружены ровно ожидаемые **9 modified tracked +8 new source/test files**.

| Status | File | Проверенный scope |
| --- | --- | --- |
| Modified | `.github/workflows/ci.yml` | Имя существующего mandatory combined student/staff API gate |
| Modified | `src/common/authorization/student-document-access.service.ts` | staff-mutate policy/profile lock, default self policy preserved |
| Modified | `src/common/serialization/public-audit.ts` | Два business action allowlists |
| Modified | `src/common/serialization/public-audit.spec.ts` | Два privacy regression cases |
| Modified | `src/modules/document/api/document.controller.ts` | Делегирование прежнего download lifecycle shared responder |
| Modified | `src/modules/document/document.module.ts` | Staff controller/guard registration |
| Modified | `src/modules/document/repository/document.repository.ts` | Scoped reads/list, conditional writes, monotonic timestamp |
| Modified | `src/modules/document/service/document.service.ts` | Seven staff operations/shared persist, review authorization/token |
| Modified | `test/run-student-document-storage.mjs` | Обязательные student/staff suites в отдельных disposable DBs |
| New | `src/modules/document/api/document-stream-response.ts` | Общий private download responder |
| New | `src/modules/document/api/dto/staff-document.dto.ts` | Raw primitive/transport/bounds validation до transformation |
| New | `src/modules/document/api/staff-document-input.interceptor.ts` | Проверки до pipes, повторная body validation после Multer |
| New | `src/modules/document/api/staff-document-mutation.guard.ts` | Authorization/IDs до Multer |
| New | `src/modules/document/api/staff-document.controller.ts` | Seven scoped routes/OpenAPI |
| New | `src/modules/document/repository/document-snapshot.ts` | Snapshot comparison и monotonic token |
| New | `src/modules/document/repository/document-snapshot.spec.ts` | 75 unit cases, включая remediation35 |
| New | `test/document-staff-api.test.ts` | 180 real cases, включая remediation40 |

Fresh preflight SHA-256 snapshot **679 существующих файлов** в source/test/docs/CI/Prisma paths; после gates все679 сохранены побайтно, включая три исходных Phase 3 reports. Git inventory после review совпадает с preflight; новый отчёт ignored существующим docs rule, не staged. Build/generate обновляют только штатные ignored outputs и не добавляют их в Git scope.

Нет schema/migration, package/lock/dependency, Contracts/Payments/Lead, frontend/mobile, public UploadService/ContractScanService, production deployment/bucket, observation/recovery/rejected-design изменений. Нет нового MinIO writer, destructive cleanup или случайных credentials/env/build/user-data artifacts в diff. В test fixtures используются synthetic accounts/secrets; actual MinIO credentials генерируются owned runner.

## 3. F-3-R01 Root Cause & Closure

Первоначальный raw interceptor вызывал `validateStaffDto`, который начинал с `plainToInstance`. `@Type(() => Number)` преобразовывал primitive до `IsInt`: `true` становился1, hex string — decimal target. Поэтому сам факт проверки до global pipe не обеспечивал raw type contract.

В [staffPositiveInteger:76](../src/modules/document/api/dto/staff-document.dto.ts#L76) original `typeof` и canonical string grammar проверяются **до** `Number` на79. Boolean/array/object не попадают в conversion. После conversion проверяются safe integer, positivity и field maximum. [validateStaffDto:85](../src/modules/document/api/dto/staff-document.dto.ts#L85) перебирает raw numeric fields на87–89 **до** `plainToInstance` на91; null/root-array также rejected. Existing DTO whitelist/forbidNonWhitelisted выполняется после raw primitive check, до framework pipes.

[staffDocumentId:96](../src/modules/document/api/dto/staff-document.dto.ts#L96) использует тот же helper; отдельного permissive parser нет. [Interceptor:20](../src/modules/document/api/staff-document-input.interceptor.ts#L20) включает decimal mode только для query/multipart. Default direct service mode требует настоящие numbers; service entrypoints повторяют validation.

Exact matching version-one metadata/DELETE probes возвращают400, owned hex target query/upload400, matching noncanonical replacement400. Отказы возникают из raw checks, без stale409, foreign403 или invalid fixture. **F-3-R01 CLOSED независимой проверкой.**

## 4. Raw Numeric Validation

| Контекст | Разрешено | Отклоняется |
| --- | --- | --- |
| JSON expectedVersion / direct DTO/service input | Typed integer number в пределах bounds | true/false, numeric string включая `"1"`, null, array/object, fraction, zero/negative, overflow; NaN/Infinity direct values |
| HTTP query/multipart | Canonical positive ASCII decimal string `^[1-9]\d*$`, затем bounded number | hex/exponent, leading zeros, whitespace, signs, fraction включая `"1.0"`, true/false strings, empty/non-scalar/overflow |
| Raw portrait/document route IDs | Canonical positive decimal string в Prisma Int range | exponent/hex/leading-zero/whitespace/sign/fraction/overflow |
| Already typed direct IDs/decimal helper inputs | Positive bounded safe integer number | Wrong primitive или range |

Decimal helper допускает already typed numbers для внутреннего validated использования. HTTP query и multipart дают strings/arrays/objects; это не разрешение JSON numeric strings: JSON interceptor/default service используют number mode. Direct service decimal strings не допускаются в numeric DTO fields; direct ID helper принимает canonical identity string и typed integer по существующему контракту.

| Field | Bound |
| --- | --- |
| expectedVersion / targetProgramId / portraitId / documentId | 1..2147483647 |
| page | Positive safe integer ≤Number.MAX_SAFE_INTEGER; safe skip и existing offset≤100000 проверяются service |
| limit | 1..100 |

Defaults page1/limit20 сохранены. Page больше Prisma Int не автоматически invalid identity: page — pagination field со своим bound; excessive offset возвращает400 из existing service check. JSON parser уже определяет typed number: требование относится к primitive, а не восстановлению исходной lexical spelling JSON number. Exponent **strings** query/multipart rejected.

Проверены `"1"`, `"10"`, верхние границы, numeric service arguments; whitespace дополнительно включает CR/LF/CRLF/U+2028/U+2029, Unicode digit representations rejected. DTO decorators сами по себе сохраняют `@Type(Number)`; supported safety boundary — `validateStaffDto` и raw HTTP interceptor до transformation. Reachable staff route/service, обходящий эту границу, не найден. Преобразование входа внешним caller **до** передачи в service не позволяет service восстановить утраченный raw тип и не заявляется частью гарантии.

## 5. HTTP Pipeline Order

Порядок установлен по local installed Nest implementation и dynamic traces; названия классов не использованы как доказательство. В `node_modules/@nestjs/core/router/router-execution-context.js` guards awaited до interceptors, `fnApplyPipes` вызывается только внутри handler. `helpers/context-creator.js` объединяет global→class→method contexts, `interceptors-consumer.js` последовательно оборачивает next. FileInterceptor awaits callback Multer до next.handle.

| Route type | Request path до service |
| --- | --- |
| List / metadata / DELETE | HTTP parsing → actual JwtAuthGuard/current DB → RolesGuard → class raw IDs + raw query/JSON DTO → global ValidationPipe → staff controller pipe/ID pipe → controller → service revalidation |
| Detail / file | HTTP parsing → JWT/current DB → RolesGuard → class raw IDs → pipes/ID pipe → scoped authorized service |
| Upload / new-version | HTTP parsing → JWT/current DB → RolesGuard → StaffDocumentMutationGuard (raw IDs/current authorization) → class raw IDs/body deferral → FileInterceptor/Multer → method raw body interceptor → global/local pipes → controller → service validation/current DB policy → shared storage → transactional policy/CAS/audit |

Source anchors: [controller:35](../src/modules/document/api/staff-document.controller.ts#L35), [early guard:12](../src/modules/document/api/staff-document-mutation.guard.ts#L12), [raw interceptor:13](../src/modules/document/api/staff-document-input.interceptor.ts#L13), [production global pipe:64](../src/main.ts#L64).

Independent harness wraps actual guard/interceptor/pipe/service methods и делегирует original behavior. Valid upload trace: `jwt → roles → early-staff → raw → raw → pipe → service:staffUpload`; второй raw проходит после Multer. Valid list trace: `jwt → roles → raw → pipe → service:staffList`. Для negative requests pipe и mutation/list service entrypoints не достигнуты. Early replacement guard может выполнять разрешённый read staffDetail до body validation; это не mutation.

Unknown/protected fields rejected raw до слабого production global whitelist, который иначе мог бы удалить их. Bare global ValidationPipe не используется как primitive security boundary. Multipart values проверяются после bounded Buffer parsing; early numeric body validation до чтения multipart не обещается. Staff authorization остаётся до Multer.

## 6. Independent PostgreSQL/MinIO Probes

Temporary suite/harness создан только в `/private/tmp/oxus-phase3-rereview/`. Реальный Nest HTTP/JWT/RBAC, actual Prisma/PostgreSQL и private MinIO. Guard registration overrides предоставляют реальные JwtAuthGuard/RolesGuard с настоящими JwtService/DB; permissive mocks отсутствуют. SDK counter wrapper вызывает original send; успешные Put/download выполняются на actual MinIO.

| Probe | Cases | Evidence |
| --- | ---: | --- |
| R01/R02 | 2 | JSON metadata и DELETE expectedVersion:true, actual private version1 и matching timestamp,400 |
| R03/R04 | 2 | Actual owned target hex query/multipart upload,400; ownership row заранее проверена |
| R05 | 1 | Matching replacement version `0x1`/`1e0`/padded/leading-zero/sign/fraction,400 |
| R06 | 10 | false/string/null/array/object/zero/negative/fraction/overflow JSON metadata+DELETE |
| R07 | 12 | Query page/limit/target и multipart target noncanonical variants/bounds |
| R08/R08b/R08c | 3 | Duplicate/query bracket/multipart array/object, within-budget duplicates, Unicode/newline variants |
| R09 | 1 | 8 malformed portrait IDs ×7 routes и document IDs ×5 scoped routes |
| R10 | 1 | Direct staff services/DTO primitives, nonfinite/Int/limit/page/offset bounds, conversion hook untouched |
| R11 | 1 | Protected/unknown metadata rejected до global stripping |
| R12 | 1 | Canonical list/upload/JSON metadata/replacement/download, number arguments, stale409/archive repeat/audit |
| **Total** | **34** | **34 PASS;201 HTTP400 assertions; direct assertions counted внутри cases** |

Перед **каждым** invalid HTTP request snapshot включает все Document rows, все AuditLog rows, отдельно `DOCUMENT_STORAGE_PENDING` technical intent rows, SDK calls и DeleteObject counter. После400 весь snapshot совпадает. Это проверяет row/count/business audit/intent state, а не только отсутствие Put. Direct service negatives сравнивают тот же полный snapshot. Read-only authorization SELECTs допустимы.

Rejection причины различены: primitive failures дают raw numeric error; null/unknown fields — raw input error. При production Express simple query parser bracket keys не становятся nested DTO objects, а rejected как non-whitelisted raw fields. Полные duplicated multipart requests могут раньше получить Multer400 `Too many fields`; дополнительные within-field-budget duplicated values подтверждают именно raw array rejection. Expected exact numeric error не позволяет приписать closure missing-required-field/CAS/ownership failures.

First temporary run31/32 получил failure только из ошибочного ожидания текста bracket query error. Second31/32 — из ожидаемого numeric error вместо actual bounded Multer error. Application не менялась. Исправлены только temporary expectations, добавлены separate within-budget duplicates/Unicode probes; **final34/34 process exit0**, fail/cancelled/skipped/todo0. Initial logs сохранены `oxus-phase3-rereview-probes-initial.txt` и `oxus-phase3-rereview-probes-parser-initial.txt`; отказы harness не скрыты и не представлены как confirmed product defects.

Infrastructure проверена до side effects: explicit local Docker Desktop Unix socket `unix:///Users/johnycarlson/.docker/run/docker.sock`, OS/type; owned UUID-labelled PG17/Redis7 на loopback62621/62622. PG exactID `1ba1502d211133fc4edceb9a96d3e90a4c9db332a2ae4d342590f225284ecb0e`, Redis `d0f9f9ce5d7f6bb90cb8a9da9add675f8cf5f07fe2a2b5f01e4fbfb06e1a4f53`. Each API/probe suite использует отдельно migrated UUID DB и owner-labelled MinIO tmpfs/synthetic credentials. Explicit child env/DOTENV_CONFIG_PATH=/dev/null; project env/Production/Test credentials не использованы.

Cleanup подтвердил только bootstrap/postgres DBs,0 public tables, отсутствие suite MinIO containers. PG/Redis удалены **только по exact IDs после matching owner label checks**; manifest cleaned=true. Global prune/чужие resources/user files не затронуты.

## 7. Compatibility & Security

Коротко повторно прочитан весь accumulated diff, source authorization/repository/service/controller/responder paths и CI inclusion. Regression impact проверен fresh permanent suites и независимыми numeric/pipeline probes:

| Guarantee | Result |
| --- | --- |
| ADMIN / assigned active EXPERT; foreign EXPERT denial | PASS; current-DB role/profile/assignment policy, scoped portrait/document/target |
| EXPERT/profile/assignment/user/role transfer races | PASS; early check и transactional policy/locks after Put сохранены |
| Staff/student concurrent writes | PASS; version+timestamp conditional WHERE, participating writers advance updatedAt |
| Same-ms/ABA CAS | PASS; monotonic `max(now,previous+1ms)`, stale snapshots409 |
| Staff upload/new-version | PASS; approved bounded Buffer≤10MiB, existing shared persist/storage/recovery, no new writer |
| Title-only metadata / transactional audit rollback | PASS; protected fields400, business audit same transaction |
| Soft-delete / repeat / archived filters | PASS; first CAS, authorized scoped repeat200/audit once; row/key/version/status/feedback/bytes retained |
| Student API / private download | PASS; existing shapes/private headers/binary behavior, legacy no arbitrary fetch |
| PublicDocument/PublicAudit | PASS; safe projection/private key/technical intent excluded |
| File bounds/format/storage metadata/cleanup | PASS; inclusive staff10MiB, invalid input pre-SDK, foundation/Jest streaming regressions |
| Synchronous compensation / observation | PASS; unchanged recovery/observer paths; no new destructive worker/purge/restore |

CAS защищает participating runtime writers; arbitrary concurrent raw SQL/seed не входит в эту гарантию. Request-time download authorization не обещает revoke уже начатого stream. Structural file validation не является AV/full parser. Failure hooks в permanent suites проверяют concrete controlled interleavings/ack-loss paths, не все networks/hosts.

Fresh existing benchmark: list50/100/500 имеет constant9 SELECTs и2 Document SELECTs. Four concurrent exact10MiB uploads прошли за487.665ms; post-Put transaction durations21.744/22.955/14.942/18.211ms. Это warm disposable synthetic benchmark. Client+Nest+Prisma+SDK находятся в одном процессе; sampled aggregate memory не isolated server peak/capacity guarantee. Raw evidence `/private/tmp/oxus-phase3-rereview-benchmarks.json`; новый admission limiter не добавлялся.

Permanent remediation35 unit +40 HTTP cases автоматически включены в mandatory [CI:84](../.github/workflows/ci.yml#L84) full Jest и [CI:97](../.github/workflows/ci.yml#L97) private API gate; [runner:111](../test/run-student-document-storage.mjs#L111) запускает обе suites без opt-in/skip. Hosted CI не запускался; его availability/branch protection не подтверждаются локальным execution.

## 8. Full Regression Results

Все gates повторены заново; generated client/build выполнены до actual HTTP tests. Package-equivalent local binaries/runners, isolated env, no lint auto-fix.

| Gate | Fresh result | Unique repository membership |
| --- | --- | ---: |
| Targeted DTO/snapshot Jest | PASS,75 | subset full Jest |
| Full Jest | PASS,53 suites/696 | 696 |
| Standard integration | PASS,24 TAP groups/400 | 400 |
| Real student+staff HTTP/PostgreSQL/MinIO | PASS,74+180 | 254 |
| Real MinIO foundation | PASS,20 | 20 |
| Storage runner security | PASS,13 | 13 |
| Observation runner | PASS,CLI26+PG25 | subset integration |
| Document HTTP security | PASS,80 | subset integration |
| Existing OpenAPI/migrations/schema drift | PASS,11/4 | subset integration |
| Prisma validate/generate | PASS; client7.8.0 | — |
| Nest build / TypeScript noEmit | PASS/PASS | — |
| TS lint / storage+observation MJS lint | PASS/PASS | — |
| Git diff check / cached check / scope / hashes / HEAD/index | PASS | — |
| Independent temporary probes | PASS,34;201 HTTP400 assertions | separate |

**696+400+254+20+13=1383 уникальных repository tests.** Baseline1308 +35 new Jest +40 new HTTP =1383. Targeted/observation/HTTP/OpenAPI/migration repeats и independent34 не прибавлены. Final TAP fail/skipped/cancelled/todo0; full Jest без failed cases. Все quality gate commands exit0; предыдущие remediation logs не заменяют fresh runs.

Evidence: `/private/tmp/oxus-phase3-rereview-{staff-jest,jest,integration,private-api,minio,runner,observation,document-http,validate,generate,build,typescript,lint,mjs-lint,probes}.txt`; inventory hashes `oxus-phase3-rereview-baseline.json`, counts `oxus-phase3-rereview-counts.json`, final state `oxus-phase3-rereview-final-check.json`. Temporary evidence находится вне repository и не считается permanent CI coverage.

## 9. Findings P0–P3

**New confirmed P0:0. P1:0. P2:0. P3:0.** Read-only audit не меняет код даже для inherited notes.

| Finding | Severity/status | Evidence/remaining work |
| --- | --- | --- |
| F-3-R01 | P2 CLOSED | Raw pre-transform helper + exact real matching/owned reproductions + no mutation snapshots |
| F-2B1-03 | inherited P2 OPEN | Cold CI, mutable base images/resource/deadline budgets: `test/minio.Dockerfile:3`, `test/run-student-document-storage.mjs:27,48`, `.github/workflows/ci.yml:27`; отдельная infrastructure remediation |
| F-2B1-04 | inherited P2 OPEN | Docker daemon locality before side effects не guaranteed общим runner: `test/run-student-document-storage.mjs:29,48,62`; этот запуск использовал externally verified local socket |
| F-OBS-01 | inherited P2 OPEN | Global aggregate/reference cost и sweep freshness: `src/modules/document/observation/document-observation.repository.ts:39,123`; workloads/budgets отдельно |
| F-2B2-R01 | inherited P3 OPEN | Unreachable TimeoutError branch: `src/modules/document/api/document-stream-response.ts:19,34,65`; extracted baseline behavior preserved |

Новый confirmed raw-validation bypass отсутствует в рассмотренных HTTP/direct entrypoints. Это bounded independent evidence, не универсальное доказательство отсутствия любого будущего дефекта.

## 10. Remaining Risks

**U1/U2/G1 OPEN / NOT APPROVED; automatic destructive recovery NOT APPROVED.** Phase 3 не решает exclusive producer authority, consumed reservation retention и paused future send. Observation-only architecture и conservative synchronous compensation не становятся разрешением для destructive recovery. Existing [recovery runbook](student-documents-recovery-runbook.md) и rejected-design evidence сохранены.

**Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки.** Explicit local socket verification в этом audit не исправляет inherited runner defect. Hosted cold mandatory CI, image/resource/command/deadline/kill cleanup budgets остаются отдельными gates.

Остаются production memory/concurrency/admission/proxy/host budgets для buffered uploads; observation capacity/freshness/alerts; JWT-aware client/frontend/mobile sign-off/rollout; legacy public files/Phase2C; AV/deeper parsing; old-version/uncertain-object retention; in-flight download и external SQL/seed boundaries. Локальные green tests/benchmark не снимают operational rollout и deployment authorization requirements.

## 11. Backend Commit Gate

**PASS WITH NOTES.** F-3-R01 независимо CLOSED; новых P0/P1 и критичного raw-validation bypass нет. Required fresh regression gates1383 и separate34 probes прошли. Accumulated Phase 3 готов к **одному отдельному backend commit** с сохранением inherited notes и security/release evidence.

Данный read-only task commit не разрешает/не выполняет. HEAD/branch unchanged, index пуст; application/tests/CI/Prisma/существующие reports сохранены. Temporary artifacts, rejected-design/cleanup reports и пользовательские файлы не добавлялись в index.

| Обязательный итоговый вопрос | Ответ |
| --- | --- |
| 1. F-3-R01 закрыт независимой проверкой? | Да, CLOSED; точные matching/owned reproductions400 |
| 2. Новые P0/P1? | Не обнаружены подтверждённые |
| 3. Numeric coercion обходит raw validation? | В reachable staff HTTP/direct-service entrypoints не выявлено; raw check предшествует conversion/pipes |
| 4. Invalid inputs400 без DB/SDK mutations? | Да,201 HTTP assertions + direct negatives; all row/audit/intent/SDK snapshots unchanged |
| 5. Valid staff requests сохранены? | Да; canonical strings становятся numbers; upload/list/metadata/version/download/archive и CAS работают |
| 6. Repository tests / independent probes? | 1383 unique repository; отдельно34/34 probes, без repeated subset duplication |
| 7. Можно единый Phase 3 commit? | Да, Backend PASS WITH NOTES; отдельное Git действие после разрешения пользователя |
| 8. Что блокирует Production? | Inherited infrastructure/recovery/client/privacy/capacity/rollout gates из раздела10 |

## 12. Production Deployment Gate

**NOT READY.** Backend closure не утверждает U1/U2/G1 или automatic destructive recovery, не доказывает hosted cold CI/production capacity и не закрывает client/legacy/operational rollout blockers. Production/Test не тронуты; Git add/commit/push/deploy/reset/restore/clean не выполнялись. Owned disposable infrastructure очищена после ownership checks; пользовательские файлы сохранены.
