# Phase 3 — F-3-R01 Numeric DTO Remediation

Дата: 2026-10-10, Asia/Almaty. Baseline и сохранённый HEAD: `2296e351442064b9d18fed9dca6af4cb5bd42bb6`.

**F-3-R01: CLOSED. Backend Commit Gate: PASS WITH NOTES. Production Deployment Gate: NOT READY.**

Scope: минимальная staff-only remediation permissive numeric coercion. Все обязательные локальные gates повторены: **1383 unique repository tests = baseline1308 +35 new Jest +40 new real HTTP cases**. Index пустой; commit/push/deploy не выполнялись.

Этот отчёт дополняет сохранённые [Final Review](student-documents-phase3-final-review.md) и [implementation report](student-documents-phase3-staff-crud-report.md). Historical finding OPEN в предыдущем review не переписан: closure относится к данному remediation diff и новым evidence.

## 1. Root Cause

`@Type(() => Number)` приводил raw primitive до `IsInt`. Existing raw interceptor вызывал `validateStaffDto` → `plainToInstance`, поэтому тоже преобразовывал boolean/string/array до проверки constraints. Independent review подтвердил JSON `expectedVersion:true` →1 →successful title mutation при version1, а owned hexadecimal targetProgramId →decimal →successful filter.

Исправлена именно граница **до** class-transformer. Общий private helper [staffPositiveInteger:76](../src/modules/document/api/dto/staff-document.dto.ts#L76) сначала проверяет original primitive и canonical string grammar, затем допустимое explicit string→number conversion и positive safe integer/range. `Number(boolean/array/object)` больше не вызывается; unit conversion-hook spy подтверждает это.

[validateStaffDto:85](../src/modules/document/api/dto/staff-document.dto.ts#L85) проверяет все raw numeric DTO fields перед `plainToInstance`; existing DTO decorators/constraints продолжают работать после этой границы. [Interceptor:20](../src/modules/document/api/staff-document-input.interceptor.ts#L20) выбирает decimal mode только для query/multipart; JSON/default direct-service mode требует numbers. [staffDocumentId:96](../src/modules/document/api/dto/staff-document.dto.ts#L96) использует тот же helper, устраняя отдельную implementation numeric parser.

Не менялись global/student ValidationPipe, routes/request/response fields, service/repository CAS, authorization, timestamp helper, private MinIO/recovery или schema. Нового writer, file copy и destructive cleanup path нет.

## 2. Changed Files

Изменения **относительно remediation preflight**, а не все accumulated Phase3 изменения относительно HEAD:

| File | Изменение |
| --- | --- |
| `src/modules/document/api/dto/staff-document.dto.ts` | Shared raw numeric helper/bounds, pre-transform DTO checks, reused route ID parser |
| `src/modules/document/api/staff-document-input.interceptor.ts` | Explicit JSON vs query/multipart input mode |
| `src/modules/document/repository/document-snapshot.spec.ts` | +35 targeted raw primitive/transport/bounds cases; original40 preserved |
| `test/document-staff-api.test.ts` | +40 permanent real HTTP/PG/MinIO cases; original140 preserved |
| `docs/student-documents-phase3-remediation-report.md` | New report, ignored existing docs rule |

Preflight совпал с baseline HEAD/branch `release/manual-contract-candidate`; index пуст. Fresh hash snapshot717 existing files; ровно четыре source/test файла изменены, остальные713 preserved, включая оба existing Phase3 reports. Accumulated Git inventory сохраняет9 modified tracked и8 new source/test files; данного remediation новые application file paths не добавлены. CI/package/dependencies/Prisma/migrations/Contract/Payment/Lead/deployment/observation и private storage/recovery не менялись.

Report не staged. Нет git add/commit/push/reset/restore/clean; пользовательские файлы не удалялись/не перемещались. Local upstream ahead1/behind0 — только local refs, без fetch/remote CI claims.

## 3. Raw Numeric Validation Contract

| Контекст | Разрешено | Reject400 |
| --- | --- | --- |
| JSON body / direct service DTO input | Настоящий typed number, positive safe integer within bound | Boolean, numeric string включая `"1"`, null, arrays/objects, fraction, zero/negative, overflow, nonfinite direct values |
| HTTP query/multipart | Canonical decimal string `^[1-9]\d*$`, within bound | Hex/exponent, leading/trailing whitespace, leading zeros, +/- signs, decimal fraction, `true/false`, empty, nonscalar/overflow |
| Raw route IDs | Canonical positive decimal string within Prisma Int bound | Hex/exponent/whitespace/sign/fraction/leading-zero/overflow/nonscalar |
| Already typed direct IDs / decimal DTO contexts | Positive safe integer number within bound | Wrong primitive/range |

Actual query/multipart numeric fields arrive as strings. Decimal mode also accepts already typed safe integers for validated/direct DTO use; it never converts boolean/array/object. Conversion of a string происходит только после raw typeof+canonical regex check. JSON numeric source notation is parsed by JSON before validation: правило относится к настоящему JSON number, а не восстановлению исходной lexical spelling. Exponent **strings** в query/multipart запрещены.

| Field | Existing bound preserved |
| --- | --- |
| portraitId/documentId/targetProgramId/expectedVersion | 1..2147483647 |
| page | Positive safe integer ≤Number.MAX_SAFE_INTEGER; existing service offset≤100000 |
| limit | 1..100 |

Default page1/limit20 сохраняются. expectedUpdatedAt остаётся strict canonical UTC with exactly3 milliseconds, existing ISO/round-trip/snapshot checks не изменены. Unknown/protected fields, null rejection и title trim/length policy сохранены.

HTTP coverage: common class interceptor проверяет raw IDs на всех семи routes; upload/version mutation guard проверяет ID/authorization перед Multer; multipart DTO проверяется тем же interceptor после FileInterceptor. Existing service methods по-прежнему вызывают validateStaffDto/default-number и staffDocumentId, поэтому HTTP interceptor не единственная граница. Direct service callers передают typed numbers; validated multipart/query strings преобразуются framework pipes после raw check.

## 4. Negative Tests

Permanent [Jest:50](../src/modules/document/repository/document-snapshot.spec.ts#L50): **35 новых cases**, original snapshot/security40 сохранены, targeted total75.

- JSON version true/false/`"1"`/null/arrays/objects/fraction/zero/negative/overflow; NaN/Infinity дополнительно проверены direct DTO, поскольку это не valid JSON number representations.
- Все encoded numeric DTO fields — expectedVersion, creation target, query page/limit/target — проверены против12 noncanonical forms и6 invalid primitive shapes.
- Route parser использует те же negatives; object numeric conversion hook не вызывается.
- Typed JSON integer, canonical multipart/query decimal и существующие upper bounds принимаются; overflows версия/program/page/limit отвергаются.

Permanent [real HTTP:405](../test/document-staff-api.test.ts#L405): **40 новых cases**, original140 сохранены, staff total180. Они включают **179 HTTP400 rejection assertions** внутри parameterized cases; число requests не прибавлено к unique test count.

| New HTTP cases | Количество |
| --- | ---: |
| JSON expectedVersion11 invalid shapes на metadata и DELETE | 11 |
| Query12 noncanonical forms, каждый page/limit/target field | 12 |
| Multipart12 forms, upload target и new-version version | 12 |
| Exact owned-hex/exponent and matching version reproduction | 1 |
| Query arrays/objects | 1 |
| Invalid portrait IDs на всех7 routes и document IDs на5 scoped routes | 1 |
| Direct service invalid numeric entrypoints | 1 |
| Valid query/multipart/JSON mutation + stale CAS/archive repeat | 1 |
| **Total** | **40** |

[rejectNumericRequest:406](../test/document-staff-api.test.ts#L406) перед каждым invalid request сохраняет полную Document row, total Document count, AuditLog count и SDK calls; после400 всё совпадает. Таким образом проверено отсутствие Document/business audit/intent mutation и **всех SDK calls**, что строже отсутствия одного PutObject. Direct services также проверяют counts/state и400. Authorization SELECTs/guards при запросе остаются допустимыми; «без DB mutation» не означает отсутствие любых DB reads.

## 5. Real HTTP Evidence

Повторено ровно independent finding:

1. Создан actual private document version1 с matching UTC token. Metadata и DELETE с JSON `expectedVersion:true` →**400**, row unchanged, audit count unchanged, SDK calls0. false/`"1"`/other invalid shapes проверены отдельно. Это не409 из-за специально stale версии.
2. Query `targetProgramId=0x<actual-own-target-in-hex>` →**400**; та же invalid owned ID на multipart upload →400 до SDK. `actualTargete0` также rejected400. Target существует и принадлежит portrait, поэтому результат не403 от отсутствующего/foreign target.
3. Multipart new-version с matching version1 в формах `0x1`, `1e0`, padded ` 1 ` →400 до Put; valid canonical version/timestamp successful200.
4. Valid staff upload own target201, query with decimal strings200, JSON metadata200, multipart replacement200/version increment; stale previous metadata409, archive/repeat200 и exactly1 delete audit.

Реальный Nest/JWT/Roles/production-like global whitelist, PostgreSQL и private MinIO; mocks не заменяют successful storage/SQL. Existing suites снова проверили current-DB authorization, foreign EXPERT/profile/assignment/role/block races, staff/student version CAS, audit rollback/unknown outcomes, private download, archived filters, public Document11-field/PublicAudit projection и no destructive archive delete. Не выявлено нового IDOR, CAS bypass, private/audit leak или confirmed P0/P1.

Mandatory CI уже включает full Jest и combined student/staff API runner; новые permanent cases автоматически обязательны, opt-in/skip/CI edits не добавлены. Hosted CI не запускался/не проверялся.

## 6. Full Regression Results

Все gates выполнены заново на verified local disposable infrastructure, explicit isolated env/DOTENV_CONFIG_PATH=/dev/null. Не использовались project .env/real credentials, Production/Test. Local command wrappers исполняли package-equivalent node binaries/runners, без lint auto-fix.

| Gate | Result | Unique membership |
| --- | --- | ---: |
| Targeted DTO/snapshot Jest | PASS,75 cases =40+35 | subset full Jest |
| Full Jest | PASS,53 suites/696 cases | 696 |
| Standard integration | PASS,24 TAP groups/400 | 400 |
| Real student+staff API/PG/MinIO | PASS,74 student +180 staff | 254 |
| Real MinIO foundation | PASS,20 | 20 |
| Storage runner security | PASS,13 | 13 |
| Observation runner | PASS,CLI26+PG25 | subset integration |
| Document HTTP security | PASS,80 | subset integration |
| Existing OpenAPI / migrations | PASS,11 /4 | subset integration |
| Prisma validate/generate | PASS; client7.8.0 | — |
| Nest build / TypeScript noEmit | PASS/PASS | — |
| TS/MJS lint | PASS/PASS | — |
| Git diff check / scope / index / HEAD | PASS | — |

**696+400+254+20+13=1383 unique repository cases. Baseline1308 +35 new Jest +40 new HTTP =1383.** Repeated targeted/full runs и observation/HTTP/OpenAPI/migration subsets не суммируются; temporary probes в этом remediation не добавлялись.

Initial TypeScript gate обнаружил только новый unit fixture `{page:MAX_SAFE_INTEGER}` без compile-time required limit. Runtime DTO default был20; fixture исправлена на explicit `limit:20`, затем повторены targeted75/full696/TypeScript/TS+MJS lint, всё PASS. Initial diagnostic сохранён `/private/tmp/oxus-phase3-remediation-typescript-initial.txt`. Application behavior/HTTP assertions при этой correction не менялись. Final TAP fail/skipped/cancelled/todo0; `.only`/`.skip` не добавлены.

Warm benchmarks повторены existing real suite: list50/100/500 имел constant9 SELECTs,2 Document queries, HTTP10.964/11.738/14.269ms;4×exact10MiB Buffer uploads536.994ms, post-Put transactions23.274/21.627/23.340/15.876ms. Memory samples остаются combined client+Nest+Prisma+SDK, **не isolated production memory usage или capacity guarantee**. Full fresh data `/private/tmp/oxus-phase3-remediation-benchmarks.json`.

Evidence logs `/private/tmp/oxus-phase3-remediation-{staff-jest,jest,integration,private-api,observation,document-http,minio,runner,validate,generate,build,typescript,lint,mjs-lint}.txt`; preflight hashes `oxus-phase3-remediation-baseline.json`, final verification `oxus-phase3-remediation-final-check.json`.

Infrastructure: explicit local Docker Desktop Unix socket `unix:///Users/johnycarlson/.docker/run/docker.sock` проверен до side effects, PG17/Redis7 owner UUID/loopback60041/60042; API/storage runners — собственные migrated UUID DBs и owner-labelled MinIO tmpfs с synthetic credentials. После всех suites SQL подтвердил только bootstrap/postgres DBs,0 public tables, отсутствие suite MinIO containers. Owned PG/Redis удалены exact IDs после label checks; manifest cleaned=true. Global prune/чужие resources/data не использовались.

## 7. Remaining Risks

**F-3-R01 CLOSED.** Новых confirmed P0/P1 не выявлено. Previous Final Review остаётся historical evidence исходного дефекта; данный отчёт фиксирует remediation/closure, не выдаёт ещё не проведённый independent follow-up за новый external approval.

Не закрыты inherited F-2B1-03 P2 cold CI/resource/deadline budgets, F-2B1-04 P2 Docker locality, F-OBS-01 P2 observation capacity/freshness и F-2B2-R01 P3 unreachable TimeoutError branch. **Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки.** Explicit socket check этого запуска не исправляет общий runner defect.

**U1/U2/G1 OPEN / NOT APPROVED; automatic destructive recovery NOT APPROVED.** Existing synchronous compensation/observation не решают producer authority, reservation retention и paused future send. Schema/grants/fences/workers/destructive protocol не менялись.

Production admission/memory/concurrency/proxy budget, client JWT sign-off/frontend/mobile, legacy public files/Phase2C, old-version/uncertain-object retention, AV/deeper parsing, hosted cold mandatory CI и operational rollout остаются отдельными gates. Новый aggregate admission limiter не добавлялся; upload сохраняет approved bounded Buffer OptionA. Runtime monotonic CAS/seed/directSQL/in-flight download границы из Final Review сохранены.

## 8. Backend Commit Gate

**PASS WITH NOTES. F-3-R01 CLOSED.** Strict raw numeric contract реализован staff-only, exact finding reproductions rejected400 до mutations/SDK, valid requests и previous guarantees сохранены, все required fresh gates прошли. Notes относятся к inherited infrastructure/operational limitations; текущая remediation подготовлена для независимой проверки перед отдельным Phase3 commit.

Index пуст, HEAD/branch unchanged. Remediation scope — два source, два test и новый report; existing reports и прочие files preserved. Git add/commit/push/deploy не выполнялись. Этот gate не заменяет отдельное разрешение пользователя на Git commit/deployment.

## 9. Production Deployment Gate

**NOT READY.** Raw DTO remediation не снимает U1/U2/G1/destructive architecture NOT APPROVED, hosted cold CI/locality/resources, workload/admission/observation capacity, JWT clients/legacy privacy или operational rollout blockers. Production/Test не тронуты; commit/push/deploy не выполнялись. Пользовательские файлы сохранены.
