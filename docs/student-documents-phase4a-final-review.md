# Phase 4A — OpenAPI & CORS Remediation: Independent Final Code Review

Дата: 2026-10-10, Asia/Almaty. Baseline/current HEAD: `028188b9b1c4a372cb43833ba383288bd0e0eeb8`.
Ветка: `release/manual-contract-candidate`.

**Backend Commit Gate: PASS WITH NOTES. Production Deployment Gate: NOT READY.**

## 1. Executive Summary

F-4A-01–04 независимо **CLOSED** в согласованном OpenAPI/CORS scope. Новых подтверждённых P0/P1/P2/P3 в accumulated diff не найдено. Generated Document schema соответствует полным public responses; семь staff routes, student endpoints, business/auth contract и runtime request/response bodies сохранены. Единственное намеренное HTTP изменение — explicit разрешение читать существующий Content-Disposition через CORS для разрешённого origin.

Заново прошли **1399 уникальных repository tests**, все requested quality gates, **12 independent before/after probes** и отдельный client-model compile smoke. Последние 13 проверок не включены в repository total. Evidence предыдущего [implementation report](student-documents-phase4a-remediation-report.md) не использовалась вместо свежего execution.

Review read-only для application/tests/CI/Prisma/index. Создан только этот ignored документ; все 705 tracked files и 32 существующих docs сохранены относительно начала review. Source defects из [Phase 4A readiness audit](student-documents-phase4-backend-client-integration.md#L404) закрыты, его auth findings A-4A-01/02/03 остаются OPEN / вне remediation scope. Client/browser sign-off и Production readiness не следуют из этого backend gate.

## 2. Git Scope

Preflight и final verification: точный baseline HEAD, ожидаемая ветка, index пуст, untracked non-ignored files отсутствуют. Accumulated diff: **ровно 8 modified tracked files, 348 insertions / 28 deletions**; новых source/test paths нет.

| File | Проверенное изменение |
| --- | --- |
| [src/common/dto/page-query.dto.ts](../src/common/dto/page-query.dto.ts#L7) | Только explicit integer Swagger type для page/limit |
| [src/configs/cors-origin.ts](../src/configs/cors-origin.ts#L34) | Export прежних options + exposedHeaders; origin validator body неизменён |
| [src/main.ts](../src/main.ts#L29) | Bootstrap использует exported corsOptions вместо прежнего inline объекта |
| [src/modules/document/api/dto/document.entity.ts](../src/modules/document/api/dto/document.entity.ts#L6) | Required nullable scalar, integer и status enum metadata |
| [src/modules/document/api/dto/staff-document.dto.ts](../src/modules/document/api/dto/staff-document.dto.ts#L10) | Integer metadata snapshot/target; validators и transformation сохранены |
| [src/modules/document/api/staff-document.controller.ts](../src/modules/document/api/staff-document.controller.ts#L26) | Bounded integer Swagger ApiParam, без изменения handlers/guards/interceptors |
| [src/configs/cors-origin.spec.ts](../src/configs/cors-origin.spec.ts#L97) | Существующие 3 tests сохранены + 9 HTTP CORS/JWT cases |
| [test/openapi-contract.test.ts](../test/openapi-contract.test.ts#L49) | Существующие 11 tests сохранены + 7 schema/runtime cases |

Полный diff, index и tracked/untracked inventory проверены; неожиданных scope additions нет. **697 других tracked files совпадают с baseline.** DocumentService, private storage/file validator/stream responder, serialization, authorization, JWT/refresh/logout/cookies, observation worker/recovery, Prisma/schema/migrations, Contracts/Payments/Lead, package dependencies, CI и deployment не изменены. Изменение Contract/Finance Swagger pagination через shared DTO — согласованное metadata-only влияние, не изменение их runtime.

SHA-256 snapshot всех 705 tracked files и 32 existing docs: `/private/tmp/oxus-phase4a-final-review-start.json`. Эти файлы не менялись в ходе review. `/docs` ignored по `.gitignore:85`; implementation/readiness reports были ignored до review, этот final report также ignored. Документы не staged; существующие rejected-design/cleanup reports сохранены. После создания отчёта docs содержит 33 файла.

Requested generate/build обновили только ignored generated outputs. Git add/commit/amend/squash/rebase/push/reset/restore/clean, deploy и Production/Test connections не выполнялись.

## 3. OpenAPI Contract

Независимо получены **два свежих complete Swagger JSON**. Before: точный baseline через read-only `git archive` в собственный `/private/tmp/oxus-phase4a-final-review-baseline`, отдельный Nest build. After: свежий build рабочего дерева. В обеих генерациях загружены все **54 built production controllers**, использованы реальные DocumentBuilder/openApiConfig/global prefix и тот же path filter, что в main.ts. DI dependencies mocked; app не подключался к внешним сервисам. Ни сохранённый before из self-check, ни только decorators не заменяют это сравнение.

Before/after: **229 paths, 282 operations, 106 component schemas**. Сравнение complete JSON допускает только точные ожидаемые corrections ниже и перестановку staff parameters при неизменных name/in/payload. После применения этого ограниченного allowlist к baseline — **0 непредусмотренных изменений**. Routes, operation IDs, security schemes/requirements, request bodies, response bodies/headers/statuses, descriptions и прочие schemas совпадают.

| Contract | Actual before | Actual after |
| --- | --- | --- |
| feedback | optional object, без nullable | **required string, nullable:true** |
| targetProgramId response | optional object, без nullable | **required integer, nullable:true** |
| id/version/studentPortraitId | number | integer |
| status | string без enum | `DRAFT`, `REVIEW`, `NEEDS_REVISION`, `APPROVED`, ровно эти четыре |
| Snapshot/update expectedVersion | number, min1/max2147483647 | integer, прежние bounds и required |
| Staff portraitId/documentId | required number | required integer, min1/max2147483647, все 12 path parameters семи operations |
| Staff target query | optional number, min1/max2147483647 | optional integer, те же bounds, без nullable |
| Shared page | optional Object allOf ref, default1/min1 | optional scalar integer, default1/min1 |
| Shared limit | optional Object allOf ref, default20/min1/max100 | optional scalar integer, default20/min1/max100 |

DocumentEntity содержит **ровно 11 properties и те же 11 required fields**:

```json
["id","title","fileUrl","documentType","version","status","feedback","studentPortraitId","targetProgramId","createdAt","updatedAt"]
```

Title/fileUrl остаются string; documentType — прежние восемь enum values; createdAt/updatedAt — string/date-time. Private fields отсутствуют. Full actual serialization null/non-null соответствует этому schema. Response IDs не получили неподтверждённых дополнительных bounds для historical rows. Input targetProgramId не стал nullable: omitted allowed, null rejected400.

Shared page/limit проверены во всех трёх HTTP consumers: staff documents GET, Contracts GET `/api/v1/contracts`, Admin Finance GET `/api/v1/admin/finance/experts/{id}/earnings`. Все **6 query parameters** — scalar integer без Object refs; names/location/required/defaults/min/max сохранены. Actual validators, initializers и pageBounds неизменны. Дополнительный staff offset limit≤100000 остаётся прежним runtime constraint; independent finance pagination DTO не затронут.

Evidence: `/private/tmp/oxus-phase4a-final-review-openapi-{before,after}.json`, `oxus-phase4a-final-review-openapi-check.json`; генератор `oxus-phase4a-final-review-swagger.cjs` и strict comparison `oxus-phase4a-final-review-openapi-check.py`. Document models пригодны для codegen в исправленном scope; конкретный frontend generator/browser ещё не выбран и не проверен. TypeScript number сам по себе не обеспечивает integer/bounds validation на клиенте.

## 4. CORS Security

Exported options и wiring actual main.ts проверены source diff и отдельным execution **compiled main.js before/after**. В bootstrap probe заменены только внешние AppModule/NestFactory на disposable Nest fixture, dotenv I/O и validator DI container; реальные bootstrap statements, CookieParser, CORS middleware, JwtAuthGuard/JwtService и Nest/Express HTTP исполнялись. Listen принудительно loopback/ephemeral; это не полный Production AppModule startup и не реальный browser.

After bootstrap передаёт в enableCors **тот же exported corsOptions object**. Before inline options и after options совпадают, кроме `exposedHeaders: ["Content-Disposition"]`. Methods GET/POST/PATCH/PUT/DELETE/OPTIONS, allowedHeaders Content-Type/Authorization и credentials:true сохранены. Validator body совпадает с baseline; wildcard origins не введены.

Actual HTTP доказательства:

- Allowed synthetic origin: exact Access-Control-Allow-Origin, credentials=true; exposed **только Content-Disposition**, прежние attachment/MIME/Content-Length и exact bytes.
- OPTIONS Authorization preflight:204, прежние methods/request headers, no JWT/DB call; дополнительный unapproved request header не granted.
- Lookalike/denied origin и `Origin:null` preflight отклонены до auth, без CORS permission headers. HTTP500 для callback error — прежний middleware behavior, не новая ошибка remediation.
- Production без allowlist fails closed для browser Origin; запрос без Origin сохраняет Bearer support и не получает wildcard ACAO.
- Cookie account22 имеет приоритет над Bearer account11; expired cookie с valid Bearer даёт401 без fallback; disabled current DB role даёт403.

Permanent CORS/guard tests также прошли20/20. SameSite=Lax, Secure в production, HttpOnly, cookie maxAge1hour, cleanup options и весь auth source сохранены. Body responses/auth semantics не менялись. Node HTTP wire evidence не заменяет browser CORS filtering, actual origins/proxy acceptance, SameSite и account-switch sign-off.

## 5. Runtime Compatibility

Source scope/hash comparison и fresh real API tests подтверждают сохранение:

| Contract | Evidence / result |
| --- | --- |
| Seven staff CRUD routes и existing student routes | Same operations/request bodies/security in complete Swagger; real staff180 + student74 PASS |
| JWT private binary download | Exact bytes, PDF/JPEG/PNG, Content-Type/Disposition/Length, safe errors и private/no-store behavior; guard/stream responder неизменны |
| Bounded Buffer upload ≤10 MiB | Structural validator/Multer/storage unchanged; permanent file bounds tests и inclusive staff10MiB case PASS; upload не streaming |
| CAS/soft-delete | ExpectedVersion+canonical expectedUpdatedAt, monotonic same-ms timestamp, current-DB reauthorization, first-delete stale409, authorized repeat-delete200/no second audit, archived filters/bytes retention сохранены |
| Staff/student/expert concurrency | Permanent assignment/profile transfer, concurrent writes, CAS, IDOR и mandatory audit rollback cases PASS |
| PublicDocument/PublicAudit | Select/serializers unchanged; null/scalar full records и public audit allowlists/technical intent exclusion проверены before/after и real readers |
| Contracts/Admin Finance pagination | Shared runtime validators/defaults/bounds unchanged; complete schema comparison, full Jest/standard integration PASS |
| Synchronous compensation / observation | Source hashes unchanged, real foundation/private API и observation/security runners PASS; нового destructive recovery нет |

Примеры real coverage: [staff soft-delete:565](../test/document-staff-api.test.ts#L565), [staff concurrency:632](../test/document-staff-api.test.ts#L632), [assignment/profile races:740](../test/document-staff-api.test.ts#L740), [audit rollback:812](../test/document-staff-api.test.ts#L812), [public audit:916](../test/document-staff-api.test.ts#L916), [student concurrent versions:308](../test/document-private-api.test.ts#L308), [snapshot implementation:5](../src/modules/document/repository/document-snapshot.ts#L5).

Никаких runtime request/response body изменений не обнаружено. Swagger nullable metadata не изменяет serializers; ApiParam не меняет parsing/authorization; PageQuery annotations не меняют validation. Legacy public URL policy и authenticated private download не объединены. Participating-writer CAS не обещает protection от arbitrary external SQL; request-time auth не отменяет уже начатый download stream.

## 6. Independent Probes

**12 temporary probes PASS before/after**, каждый scenario выполнен на обоих freshly built states, без repository test edits:

1. Allowed binary GET через compiled bootstrap: exact bytes/headers, только ожидаемое exposure difference.
2. Authorization preflight, без auth/DB вызова.
3. Lookalike origin denial до authentication.
4. Denied `Origin:null` OPTIONS.
5. Unapproved requested header не включён в allowed headers.
6. Missing production allowlist fails closed.
7. No-Origin Bearer support без wildcard.
8. Cookie другого account имеет приоритет над Bearer.
9. Expired cookie исключает fallback на valid Bearer.
10. Current DB disabled-role403.
11. PublicDocument11-field и PublicAudit allowlisted serialization без private/password/technical intents, exact before/after equality.
12. Cookie issuance/cleanup HttpOnly/Secure/SameSite/maxAge before/after equality.

Дополнительно **1 client-model compile smoke PASS**: temporary TypeScript model получен из actual after Document schema. Strict compilation принимает full null/non-null records; expected compiler errors проверяют omitted feedback, invalid status enum, string target и object feedback. Это минимальный schema-to-type smoke, не проверка какого-либо production frontend codegen tool. Integer/bounds остаются runtime constraints.

Evidence: `/private/tmp/oxus-phase4a-final-review-probes.{cjs,json}`, `oxus-phase4a-final-review-client-model.{ts,txt}`. Initial temporary probe assertion столкнулась с различными Array prototypes из VM; сравнение нормализовано через Array.from только в probe. HTTP app закрыт finally; после исправления все probes PASS. Это harness diagnostic, не application defect.

Ни 12 probes, ни compile smoke не прибавлены к1399 repository tests.

## 7. Full Test Results

Все requested gates повторены заново на неизменном reviewed diff. Package-equivalent local binaries/runners, no autofix; clean child env с `DOTENV_CONFIG_PATH=/dev/null` и только synthetic disposable credentials. Build выполнен до Swagger/API checks, schema/migration source не изменялся.

| Gate | Fresh result | Unique repository total membership |
| --- | --- | ---: |
| Targeted CORS + JwtAuthGuard | PASS,20 | subset Jest |
| Targeted OpenAPI | PASS,18 | subset integration |
| Full Jest | PASS,53 suites /705 tests | 705 |
| Standard integration | PASS,24 TAP groups /407 tests + existing plain smoke | 407 |
| Real student/staff HTTP/PostgreSQL/MinIO | PASS,74+180=254 | 254 |
| MinIO foundation | PASS,20 | 20 |
| Storage runner security | PASS,13 | 13 |
| Observation runner | PASS,CLI26 + PostgreSQL25 | subset integration |
| Document HTTP security | PASS,80 | subset integration |
| Document schema/migration drift | PASS,4; runner migration diff checks PASS | subset integration |
| Prisma validate/generate | PASS/PASS; client7.8.0 | — |
| Nest build; separate baseline build | PASS/PASS | — |
| TypeScript noEmit | PASS | — |
| TS lint / MJS lint | PASS/PASS | — |
| Fresh complete Swagger comparison | PASS,0 unapproved changes | — |
| Independent probes / model compile | PASS,12 /1 | separate |
| git diff --check / scope / HEAD / index / hashes | PASS | — |

**705+407+254+20+13=1399 уникальных repository tests.** Targeted reruns, observation/security/OpenAPI/migration subsets, plain smoke и independent probes не double-counted. TAP fail/cancelled/skipped/todo=0, Jest705/705. Permanent additions составляют прежние согласованные +9 Jest/+7 OpenAPI: baseline1383→1399. Новые test cases входят в existing mandatory CI full Jest/standard integration; CI source не менялся и hosted CI не запускался.

Logs: `/private/tmp/oxus-phase4a-final-review-{targeted-cors,openapi,jest,integration,private-api,minio,runner,observation,document-http,validate,generate,build,typescript,lint,mjs-lint}.txt`; parsed totals `oxus-phase4a-final-review-counts.json`. В этом fresh review все repository/quality commands завершились exit0; previous remediation diagnostic runs не подменяют эти результаты.

Infrastructure до side effects: verified explicit **local Docker Desktop Unix socket** `unix:///Users/johnycarlson/.docker/run/docker.sock`, Linux/Desktop daemon, UUID labels. Owned PG17/Redis7 имели только loopback ports52648/52649, synthetic credentials, bootstrap `oxus_review_test`; integration suites создавали свои UUID migrated DB. Private/foundation MinIO — runner-owned tmpfs/loopback containers. Socket/HTTP execution использовал разрешённый доступ только для этих local checks.

После выполнения SQL подтвердил только bootstrap/postgres databases и **0 public tables**; suite MinIO containers отсутствуют. PG `e59bda50133e5e0ea6ce3b09a592a54f3c54584485051f104cae51a059b258aa` и Redis `23662cbb4dfb25d7456d675bc0eb06da0e8e48bbe0b4f37430a9d8564e83ff3b` удалены только по exact IDs после matching UUID ownership checks; manifest `oxus-phase4a-final-review-infra.json` cleaned=true. Global prune, removal чужих ресурсов, Production/Test не выполнялись.

## 8. Findings P0–P3

**New confirmed P0:0; P1:0; P2:0; P3:0** в рассматриваемом remediation diff.

| Finding | Severity / independent disposition | Evidence |
| --- | --- | --- |
| F-4A-01 | P2 CLOSED | Actual before optional object →after required string/integer nullable; full serializer JSON и strict schema equality |
| F-4A-02 | P2 CLOSED | Все6 shared page/limit parameters scalar integer; defaults/bounds/optionality unchanged |
| F-4A-03 | P3 CLOSED | Exact status enum, response integer fields, snapshot integer и все bounded staff path/target inputs |
| F-4A-04 | P3 CLOSED | Actual compiled bootstrap/HTTP exposes только Content-Disposition, preserved CORS policy |
| A-4A-01 | inherited P2 conditional OPEN | Protected logout может не очистить cookies при invalid/disabled auth; cookie priority сохранился; отдельный auth scope |
| A-4A-02 | inherited P2 conditional OPEN | Cookie-only refresh, Lax/cross-site topology и cookie1hour vs refreshJWT14days; отдельный policy/client gate |
| A-4A-03 | inherited security limitation OPEN | Stateless refresh/logout не обещают revocation; conditional P2 при требовании global revocation |
| F-2B1-03 / F-2B1-04 | inherited P2 OPEN | Hosted cold CI/resource/image/deadline и Docker daemon locality; этот local execution не закрывает runner findings |
| F-OBS-01 | inherited P2 OPEN | Aggregate/reference workload cost и sweep freshness; отдельный operational scope |
| F-2B2-R01 | inherited P3 OPEN | Unreachable TimeoutError branch unchanged; outside OpenAPI/CORS scope |

Существующие findings не исправлялись в read-only review. Их root causes/рекомендации остаются в [readiness auth findings](student-documents-phase4-backend-client-integration.md#L454) и [previous review risks](student-documents-phase3-remediation-final-review.md#L175). Denied-origin callback500 и development policy без configured allowlist присутствовали в baseline; remediation их не расширяет и не объявляет исправленными.

## 9. Remaining Risks

- Actual frontend/API origins, reverse proxy/header forwarding, real browser credentials/SameSite/CORS acceptance, selected codegen client и end-to-end download sign-off ещё не проверены. Frontend вне доступного scope; mobile приложения нет, их отсутствие не считается новым backend defect.
- До client sign-off нужны refresh/logout/account-switch concurrency/cache/resource isolation, role/assignment changes, private-vs-legacy download, multipart/errors/409 reload/retry, archived filters и idempotent delete. A-4A-01/02/03 требуют отдельных auth policy решений, особенно при cross-site cookies или global revocation requirements.
- **Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки.** Этот review externally verified local daemon до side effects; общий runner defect не исправлен. Hosted cold CI/resource/image/deadline/kill cleanup budgets остаются отдельными gates.
- Production buffered-upload aggregate memory/concurrency/admission/proxy/host budgets, observation capacity/freshness/alerts, legacy public files/Phase2C, retention old-version/uncertain objects, AV/deeper parsing и operational rollout не закрываются Swagger/CORS checks.
- **U1/U2/G1 OPEN / NOT APPROVED; automatic destructive recovery NOT APPROVED.** Single-producer authority, consumed reservation retention и paused/stale future send нерешены. Observation-only monitoring и прежняя synchronous compensation не являются approved destructive protocol; rejected design остаётся historical proposal.

## 10. Backend Commit Gate

**PASS WITH NOTES.** Accumulated Phase 4A remediation готова к отдельному backend commit с указанными inherited notes. Все F-4A-01–04 закрыты независимым fresh evidence, scope корректен, новых P0/P1 нет, regression1399 и quality gates PASS. В этом read-only task commit не создан, index остаётся пустым.

| Обязательный итоговый вопрос | Ответ |
| --- | --- |
| 1. F-4A-01–04 закрыты? | Да, CLOSED |
| 2. Есть новые P0/P1? | Подтверждённых не обнаружено |
| 3. OpenAPI корректен для Document client models? | Да:11 required fields, nullable scalars, exact enum/integer; concrete frontend generator sign-off pending |
| 4. CORS security policy сохранена? | Да; единственное добавление — Content-Disposition exposure |
| 5. Runtime business/auth contract изменился? | Нет; request/response bodies, JWT/cookie/refresh/logout/business unchanged |
| 6. Сколько тестов прошло? | 1399 unique repository tests +12 independent probes +1 model compile smoke отдельно |
| 7. Можно создавать отдельный commit? | Да, Backend PASS WITH NOTES; здесь Git index/commit не изменялись |
| 8. Какие Production blockers? | Client/browser/auth policy, infrastructure/operational budgets/rollout/legacy/retention gates; U1/U2/G1 и destructive recovery NOT APPROVED |

## 11. Production Deployment Gate

**NOT READY. U1/U2/G1 NOT APPROVED; destructive recovery NOT APPROVED.** OpenAPI/CORS remediation не даёт Production readiness или deployment approval. Нужны отдельные client/auth/operational/security release decisions из раздела9; [recovery runbook](student-documents-recovery-runbook.md#L126) и rejected-design gates сохранены.

Review не подключался к Production/Test и не выполнял push/deploy. Рабочие application/tests/CI/Prisma files, существующие документы и Git index сохранены; добавлен только этот ignored final-review report.
