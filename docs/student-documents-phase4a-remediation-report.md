# Phase 4A — OpenAPI & CORS Remediation Report

Дата: 2026-10-10, Asia/Almaty. Baseline/current HEAD: `028188b9b1c4a372cb43833ba383288bd0e0eeb8`.
Ветка: `release/manual-contract-candidate`.

**F-4A-01/02/03/04 CLOSED. Backend Commit Gate: PASS WITH NOTES. Production Deployment Gate: NOT READY.**

## 1. Executive Summary

Выполнена согласованная минимальная remediation: точные nullable/required scalar schemas DocumentEntity, integer/enum/input/path metadata, integer shared pagination и explicit Content-Disposition CORS exposure. Все существующие 11 public Document fields, семь staff routes, student contract, validation и business/auth behavior сохранены.

Прошли **1399 уникальных repository tests = baseline 1383 + 16 новых (9 Jest CORS + 7 OpenAPI)**. Full Jest, штатные integration/storage/API/observation/security runners, реальные PostgreSQL/MinIO, Prisma, build, TypeScript и TS/MJS lint выполнены заново. Targeted повторения и subsets не прибавлены к total.

Auth findings **A-4A-01/02/03 остаются OPEN / вне scope**. Cookie precedence, refresh/logout/session lifetime, SameSite/Secure и JWT revocation не исправлялись. Client sign-off и Production readiness не выводятся из green backend tests.

Этот отчёт фиксирует closure findings из [Phase 4A audit](student-documents-phase4-backend-client-integration.md#L404). Его before-state OpenAPI/CORS findings теперь исторические; runtime HTTP guide остаётся применимым, schemas/header exposure актуализированы ниже. Frontend/mobile не искались и не реализовывались: frontend вне доступного scope, mobile нет по уточнению пользователя.

## 2. Baseline/Git Scope

Preflight: правильные HEAD/branch, пустые index и tracked/untracked status. Сохранён SHA-256 inventory **705 tracked файлов и 31 existing docs** до изменений: `/private/tmp/oxus-phase4a-remediation-baseline.json`. Unexpected pre-existing diff отсутствовал.

Implementation scope — **8 modified tracked файлов: 6 source/config + 2 existing test files**, новые source/test paths не добавлены. Дополнительно создан только этот ignored report. Нет package/dependency/CI/Prisma/schema/migration/storage/recovery/DocumentService/serializer/authorization/Contract/Payment/Lead/deployment изменений. Git index оставлен пустым, HEAD сохранён. Git add/commit/push/reset/restore/clean/rebase, deploy и Production/Test connections не выполнялись.

Generated Prisma client/build outputs — штатные ignored результаты requested generate/build; credentials/env/build outputs не staged. Пользовательские файлы не удалялись и не перемещались; existing docs сохранены.

## 3. F-4A-01–04 Closure

| Finding | Status | Минимальная correction | Permanent evidence |
| --- | --- | --- | --- |
| F-4A-01 nullable/scalar | **CLOSED** | Required `feedback: string nullable`, `targetProgramId: integer nullable`; ровно 11 public fields | [Entity:13](../src/modules/document/api/dto/document.entity.ts#L13), [schemas:49](../test/openapi-contract.test.ts#L49), [actual JSON:69](../test/openapi-contract.test.ts#L69) |
| F-4A-02 pagination | **CLOSED** | Явный integer type для shared page/limit, без Object ref; defaults/bounds сохранены | [Page DTO:7](../src/common/dto/page-query.dto.ts#L7), [all consumers:133](../test/openapi-contract.test.ts#L133) |
| F-4A-03 enum/integer | **CLOSED** | Exact DocumentStatus enum; integer response IDs/version, staff snapshot/target/path parameters | [Entity:6](../src/modules/document/api/dto/document.entity.ts#L6), [DTO:10](../src/modules/document/api/dto/staff-document.dto.ts#L10), [path schema:26](../src/modules/document/api/staff-document.controller.ts#L26), [tests:105](../test/openapi-contract.test.ts#L105) |
| F-4A-04 CORS exposure | **CLOSED** | Explicit exposedHeaders Content-Disposition; остальные options/origin policy сохранены | [Options:34](../src/configs/cors-origin.ts#L34), [bootstrap:29](../src/main.ts#L29), [actual middleware:97](../src/configs/cors-origin.spec.ts#L97) |

Root causes: implicit Swagger reflection для nullable unions и initialised numeric fields; отсутствующий enum/integer metadata; отсутствие explicit CORS exposed header. Исправления относятся к documentation metadata и одному response-header permission, а не к storage/business/auth алгоритмам.

## 4. Exact OpenAPI Before/After

Сравнены complete Swagger documents из одинакового existing harness/built production controllers: `/private/tmp/oxus-phase4a-remediation-openapi-before.json` и `oxus-phase4a-remediation-openapi-after.json`. Before сохранён до source changes; after получен после build и permanent tests. Schema snapshots — локальная evidence без secrets.

| Location | Before | After |
| --- | --- | --- |
| DocumentEntity.feedback | `{type:"object"}`, optional, без nullable | `{type:"string",nullable:true}`, required |
| DocumentEntity.targetProgramId | `{type:"object"}`, optional, без nullable | `{type:"integer",nullable:true}`, required |
| DocumentEntity.id/version/studentPortraitId | `{type:"number"}` | `{type:"integer"}` |
| DocumentEntity.status | `{type:"string"}`, enum отсутствовал | `{type:"string",enum:["DRAFT","REVIEW","NEEDS_REVISION","APPROVED"]}` |
| StaffDocumentSnapshotDto / StaffUpdateDocumentDto.expectedVersion | `{type:"number",minimum:1,maximum:2147483647}` | `{type:"integer",minimum:1,maximum:2147483647}` |
| Staff portraitId/documentId path schemas | `{type:"number"}` | `{type:"integer",minimum:1,maximum:2147483647}`, required, in:path |
| Staff list targetProgramId | `{type:"number",minimum:1,maximum:2147483647}` | `{type:"integer",minimum:1,maximum:2147483647}`, optional, in:query, не nullable |
| Shared page query | `{minimum:1,default:1,allOf:[{$ref:"#/components/schemas/Object"}]}` | `{type:"integer",minimum:1,default:1}` |
| Shared limit query | `{minimum:1,maximum:100,default:20,allOf:[{$ref:"#/components/schemas/Object"}]}` | `{type:"integer",minimum:1,maximum:100,default:20}` |

After response schema required properties:

```json
["id","title","fileUrl","documentType","version","status","feedback","studentPortraitId","targetProgramId","createdAt","updatedAt"]
```

Сохраняются `title/fileUrl: string`, `documentType` с прежними восемью enum values, `createdAt/updatedAt: string/date-time`; private properties отсутствуют. Nullable response не превращён в nullable create/query input: multipart target optional integer без nullable, raw DTO null →400. [Input test:105](../test/openapi-contract.test.ts#L105).

Response integer fields не получили новые неподтверждённые positive bounds для произвольных historical DB rows. Positive 1..2147483647 bounds явно указаны там, где actual staff parser/DTO их требует: snapshot, IDs и target input. Numeric parser/validation decorators и CAS timestamp behavior не менялись.

Complete JSON comparison дал 20 changed schema/property/parameter locations (parameter arrays считаются одной location). После нормализации **только** согласованных properties, required list и affected parameters — **0 unrelated OpenAPI changes**. Set/name/location параметров сохранён; никакие routes/security/request bodies/binary schemas не исчезли. Results: `/private/tmp/oxus-phase4a-remediation-openapi-changes.json`, `oxus-phase4a-remediation-openapi-compatibility.json`.

## 5. Shared DTO Compatibility

До изменения найдены все source consumers PageQueryDto и наследника ContractsQueryDto; differing runtime bounds не обнаружены:

| HTTP consumer | DTO/service | Runtime bounds/defaults, unchanged |
| --- | --- | --- |
| GET /api/v1/expert/portraits/:portraitId/documents | StaffDocumentsQueryDto; DocumentService.staffList | page1/limit20, min1/limit≤100, safe page/skip и дополнительный offset≤100000 |
| GET /api/v1/contracts | ContractsQueryDto; ContractRepository.findAllByStatus | page1/limit20, min1/limit≤100, pageBounds |
| GET /api/v1/admin/finance/experts/:id/earnings | PageQueryDto; AdminFinanceService.getExpertEarnings | page1/limit20, min1/limit≤100, pageBounds |

Sources: [Staff:169](../src/modules/document/service/document.service.ts#L169), [Contracts DTO:6](../src/modules/contract/api/dto/contracts-query.dto.ts#L6), [Contracts controller:34](../src/modules/contract/api/expert-contract.controller.ts#L34), [repository:63](../src/modules/contract/repository/contract.repository.ts#L63), [Admin controller:185](../src/modules/admin/admin.controller.ts#L185), [finance service:210](../src/modules/admin/finance.service.ts#L210).

Общая correction безопасна: изменены только две ApiPropertyOptional annotations; initializers, IsOptional/IsInt/Min/Max/Type и pageBounds сохранены. Для всех трёх generated operations page/limit names и in:query, optionality, min/max/defaults совпали before/after; Object ref заменён scalar integer. Остальные independent pagination DTOs и их metadata не изменены. Contract/Finance source files не редактировались; изменение их shared Swagger query type намеренное и документированное.

Student `/documents` не использует PageQueryDto; прежние multipart fields/no staff snapshot requirement и JWT binary routes проверены [student contract test:194](../test/openapi-contract.test.ts#L194) и реальной student suite 74/74. GET `/documents/me` response остаётся array, staff list остаётся envelope; reader implementations не менялись.

## 6. CORS Security

Чтобы тестировать **тот же объект**, который использует Nest bootstrap, existing options перенесены из inline `main.ts` в export `corsOptions` существующего `cors-origin.ts`. Production вызывает `app.enableCors(corsOptions)`. Origin validator body сохранён; дополнительная фабрика, новый service или alternate CORS implementation не создавались.

```ts
export const corsOptions: CorsOptions = {
  origin: validateCorsOrigin,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Disposition"],
  credentials: true,
};
```

Actual Nest/Express middleware tests используют loopback HTTP fixture `127.0.0.1:<ephemeral>`, CookieParser, production JwtAuthGuard/JwtService и synthetic current-DB mock. Это реальный HTTP middleware, **не real browser** и не real DB auth sign-off. Controller fixture отдаёт synthetic binary только для проверки CORS/HTTP/guard behavior; реальные Document endpoints проверены отдельными PG/MinIO suites.

Permanent nine new cases проверяют:

- Allowed synthetic `https://crm.example.test`: exact ACAO, credentials=true, expose **только** Content-Disposition; attachment header, MIME/length и exact synthetic bytes.
- Authorization OPTIONS preflight: original methods и allowedHeaders, credentials, Vary:Origin; no wildcard/no unexpected permission headers, auth/DB не вызываются на preflight.
- Unlisted origin rejected before auth, без allow-origin/expose headers; существующий middleware error даёт HTTP500 в Node fixture, это не новый 403 contract. Browser воспринимает CORS denial отдельно.
- Origin-free Bearer остается allowed без wildcard ACAO; missing JWT →401; cookie-only JWT работает.
- Cookie другого account по-прежнему имеет приоритет над Bearer; expired access cookie не fallback'ит на valid Bearer; disabled current DB role →403.

Sources: [allowed download:97](../src/configs/cors-origin.spec.ts#L97), [preflight:112](../src/configs/cors-origin.spec.ts#L112), [denied:128](../src/configs/cors-origin.spec.ts#L128), [cookie priority:164](../src/configs/cors-origin.spec.ts#L164). Existing три origin-validator tests сохранены, включая production fail-closed без allowlist.

После correction server даёт `Access-Control-Expose-Headers: Content-Disposition` для разрешённого CORS response. Это устраняет Nest-boundary header visibility gap; реальный frontend origin/proxy/browser acceptance и SameSite restrictions требуют отдельного client sign-off. SameSite/Secure, cookies, JWT guards, origin allowlist, methods/request headers/credentials и любые auth findings не изменены.

## 7. Runtime API Unchanged

PublicDocument select/serializer и Prisma model не изменены. Independent permanent JSON tests проверяют полный record с null и non-null feedback/target, ISO timestamp и ровно 11 public fields; serializer и DocumentEntity constructor не пропускают fileKey/deletedAt/operationId. Required nullable metadata соответствует фактическому полному JSON, а не меняет response body. [Runtime tests:69](../test/openapi-contract.test.ts#L69), [unchanged serializer:3](../src/common/serialization/public-document.ts#L3).

Семь staff methods/routes, bearer auth, required path IDs, private binary MIME/length/headers, upload/replacement multipart fields и existing responses сохранены [seven-route test:158](../test/openapi-contract.test.ts#L158). Staff controller изменён только добавлением Swagger ApiParam metadata и schema constant. DTO decorators IsInt/Type/ValidateIf/Matches и raw numeric helper не менялись. `targetProgramId:null` по-прежнему reject400, omitted target allowed.

DocumentService, storage/file validation/shared streaming responder, current-DB authorization locks, ownership/CAS, mandatory audit/rollback, synchronous compensation, soft-delete/no physical removal и observation-only recovery исходники сохранены по hash inventory. Реальные student/staff tests повторно проверили exact file bytes, inclusive staff 10 MiB, IDOR, expert assignment/profile transfer races, concurrent student/staff writes, same-ms CAS, audit rollback, archived filters/repeat delete и legacy safety. Реальные Document HTTP security 80/80 прошли.

Нет изменения Student CRUD formats, business statuses/transitions, token TTL/priority/refresh/logout, Contracts/Payments/Leads. Единственное намеренное wire behavior изменение — разрешённому cross-origin browser можно читать уже существующий Content-Disposition header.

## 8. Test Results

Все gates выполнены на final application code; после форматирования новых tests повторены targeted CORS/full Jest, OpenAPI/TypeScript/lint. Runners запускались package-equivalent Node commands в clean child env (`DOTENV_CONFIG_PATH=/dev/null`, no inherited real secrets/preloads), с explicit verified local DOCKER_HOST.

| Gate | Result | Unique total membership |
| --- | --- | ---: |
| Targeted CORS + existing JwtAuthGuard Jest | **PASS: 20** = CORS12 (existing3+new9), guard8 | subset full Jest |
| Targeted OpenAPI / runtime JSON assertions | **PASS: 18** = existing11+new7 | subset standard integration |
| Full Jest | **PASS: 53 suites /705 tests** | 705 |
| Standard integration runner | **PASS: 24 TAP groups /407 tests** + existing plain smoke | 407 |
| Real student/staff HTTP/PostgreSQL/MinIO | **PASS: 74+180=254** | 254 |
| Real MinIO foundation | **PASS: 20** | 20 |
| Storage runner security | **PASS: 13** | 13 |
| Observation runner | **PASS: CLI26 + PG25** | subset integration |
| Document HTTP security runner | **PASS: 80** | subset integration |
| Document schema/migration drift | **PASS: 4** | subset integration |
| Prisma validate/generate | **PASS; generated client7.8.0** | — |
| Nest build | **PASS** | — |
| TypeScript noEmit | **PASS** | — |
| TS lint / MJS lint | **PASS/PASS** | — |
| Complete OpenAPI before/after compatibility | **PASS: 0 unrelated changes** | — |
| Git diff check/scope/index/HEAD | **PASS** | — |

**705+407+254+20+13=1399 уникальных repository tests. Baseline1383 +9 Jest +7 OpenAPI=1399.** Targeted/full repeats, observation/security/OpenAPI/migration subsets и plain smoke не добавлены второй раз. Final TAP fail/skipped/cancelled/todo=0; full Jest без failed/skipped cases. `.only`/`.skip` не добавлены. New permanent cases уже входят в обязательные existing Jest + standard integration CI gates, opt-in или CI configuration changes отсутствуют. Hosted CI не запускался.

First TypeScript check обнаружил два `never[]` в новых test accumulators; исправлены только annotations `string[]`. First lint обнаружил 16 formatting errors только в двух test files; выполнен formatter только для них и все required checks повторены. Initial diagnostics сохранены в `oxus-phase4a-remediation-typescript-initial.txt` и `oxus-phase4a-remediation-lint-initial.txt`. Первый sandbox CORS test run получил listen EPERM; fixture использует explicit loopback, approved local execution прошёл. До Docker side effects sandbox также блокировал socket access; повтор с разрешённым доступом сначала verified daemon, затем создал infrastructure. Эти environment/fixture diagnostics не представлены как application defects или скрытые successful first runs.

Evidence logs: `/private/tmp/oxus-phase4a-remediation-{targeted-cors,openapi,jest,integration,private-api,minio,runner,observation,document-http,validate,generate,build,typescript,lint,mjs-lint}.txt`; counts `oxus-phase4a-remediation-counts.json`. Чтение спецификации не требует сохранения этих temporary logs; source/tests и результаты описаны здесь.

Infrastructure: before side effects verified explicit local Docker Desktop Unix socket `unix:///Users/johnycarlson/.docker/run/docker.sock`, OS=Linux/Desktop. UUID ownership labels; PG17/Redis7 только `127.0.0.1:49836/49837`; each integration suite имеет fresh migrated UUID DB. Private/foundation MinIO runner-owned containers имеют tmpfs, loopback bindings, synthetic credentials. Docker build cached evidence не выдана за hosted cold CI guarantee.

После runners SQL подтвердил только bootstrap `oxus_review_test` и postgres DB, **0 public tables**, отсутствие suite DB/MinIO containers. Owned PG `08dfed93ae657587f99ab2ff58417c2c07c1cffd98741b0983fa4e7563d92f39` и Redis `538095ebefade7322160dccd369debe69d954e536ab54d4e40df9d807723a5cf` удалены exact IDs после UUID label checks; manifest `/private/tmp/oxus-phase4a-remediation-infra.json` cleaned=true. Не было global prune/чужих container removals/Production/Test.

## 9. Changed Files

| File | Change |
| --- | --- |
| [src/common/dto/page-query.dto.ts](../src/common/dto/page-query.dto.ts#L7) | Two explicit Swagger integer types |
| [src/configs/cors-origin.ts](../src/configs/cors-origin.ts#L34) | Export existing options + one exposed header; validator unchanged |
| [src/main.ts](../src/main.ts#L29) | Use the same exported CORS config |
| [src/modules/document/api/dto/document.entity.ts](../src/modules/document/api/dto/document.entity.ts#L6) | Required nullable scalar, integer, enum Swagger annotations |
| [src/modules/document/api/dto/staff-document.dto.ts](../src/modules/document/api/dto/staff-document.dto.ts#L10) | Explicit integer annotations for expectedVersion and target |
| [src/modules/document/api/staff-document.controller.ts](../src/modules/document/api/staff-document.controller.ts#L26) | Bounded integer Swagger path parameters |
| [src/configs/cors-origin.spec.ts](../src/configs/cors-origin.spec.ts#L97) | Existing3 preserved +9 new actual HTTP CORS/JWT regressions |
| [test/openapi-contract.test.ts](../test/openapi-contract.test.ts#L49) | Existing11 preserved +7 schema/runtime/shared/student regressions |
| docs/student-documents-phase4a-remediation-report.md | New ignored implementation/evidence report, unstaged |

Никаких других tracked/untracked implementation paths не изменено. Остальные **697 tracked files** и все **31 existing docs** совпадают с preflight SHA-256; empty index/unchanged HEAD подтверждены отдельно. Requested report ignored `/docs`, Git add -f не выполнялся.

## 10. Remaining Risks

- **A-4A-01/02/03 OPEN / вне scope:** authenticated logout cleanup при invalid credentials, cookie-only refresh/SameSite/cookie-vs-JWT lifetime, stateless JWT revocation/rotation. Cookie priority и эти ограничения сохраняются, они требуют отдельного auth design scope. [Audit auth findings](student-documents-phase4-backend-client-integration.md#L454).
- Реальный cross-origin browser/client sign-off не выполнен: нужны actual frontend/API origins/proxy, cookie acceptance/refresh/logout/account-switch races, resource cleanup/cache isolation и client memory/concurrency. Наличие header на actual middleware не заменяет browser e2e.
- Legacy public files/Phase2C и legacy URL UX/sign-off остаются открыты; public/presigned URLs не введены.
- Inherited F-2B1-03 cold CI/resource/deadline/image budgets, F-2B1-04 daemon locality, F-OBS-01 observation cost/freshness и F-2B2-R01 unreachable TimeoutError branch не исправлялись. **Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки.** Explicit local verification этого запуска не исправляет runner defect. [Prior risks](student-documents-phase3-remediation-final-review.md#L175).
- Production upload memory/concurrency/admission/proxy/host budgets, retention/old-version/uncertain objects, AV/deeper parsing, observation capacity/alerts и operational rollout остаются отдельными gates. Buffered upload не переименован в streaming и новый admission/writer не добавлен.

## 11. Backend Commit Gate

**PASS WITH NOTES.** F-4A-01/02/03/04 CLOSED; generated OpenAPI пригоден для точных Document nullable/scalar/enum/integer models и staff pagination/path contracts в исправленном scope. Content-Disposition доступен разрешённому cross-origin fetch по Nest CORS configuration; actual middleware/guard tests прошли. Нет изменения business/auth runtime; mandatory fresh regression1399 и quality gates PASS.

Notes — remaining auth/client/infrastructure/operational risks раздела 10. Diff подготовлен для независимого Final Code Review. Этот implementation/self-check gate не является external reviewer sign-off, commit или deploy разрешением. Git index пустой; commit здесь не создан.

## 12. Production Deployment Gate

**NOT READY. U1/U2/G1 OPEN / NOT APPROVED; automatic destructive recovery NOT APPROVED.** U1 single-producer upload authority, U2 consumed reservation retention, G1 paused/stale future network send остаются нерешёнными. Observation-only recovery и synchronous compensation не считаются approved destructive protocol. [Runbook:4](student-documents-recovery-runbook.md#L4), [prohibitions:126](student-documents-recovery-runbook.md#L126), [design gates:132](student-documents-recovery-runbook.md#L132).

OpenAPI/CORS remediation не закрывает browser client sign-off, auth scope decisions, legacy/hosted CI/locality/resources, production admission/memory/retention/observation/rollout и отдельное deployment approval. Frontend/mobile/Production/Test не тронуты. Index оставлен пустым, commit/push/deploy не выполнялись; пользовательские файлы и rejected recovery evidence сохранены.
