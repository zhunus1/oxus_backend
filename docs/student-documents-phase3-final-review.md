# Phase 3 — Independent Final Security & Concurrency Code Review

Дата: 2026-10-10, Asia/Almaty. Baseline и проверенный HEAD: `2296e351442064b9d18fed9dca6af4cb5bd42bb6`.

**Backend Commit Gate: PASS WITH NOTES. Production Deployment Gate: NOT READY.**

## 1. Executive Summary

Read-only аудит accumulated Phase 3 diff, actual SQL и повторных обязательных gates. Старый implementation self-check не использован вместо новых запусков: **1308/1308 уникальных repository cases PASS; отдельно 28/28 temporary independent probes PASS**. Diagnostic probe I18 подтверждает открытый finding, поэтому pass самого probe не означает closure дефекта.

**Новых подтверждённых P0/P1 нет. Один новый P2: F-3-R01, permissive numeric DTO coercion.** Boolean `expectedVersion:true` принимается как integer 1; hexadecimal targetProgramId query принимается как owned integer. Это отклонение от строгого input contract, без продемонстрированного bypass authorization, ownership или stale timestamp CAS. Требуется узкая remediation raw numeric validation + permanent negative tests; application code этим review не исправлялся.

На проверенных путях: current-DB staff authorization, scoped lookup, actual conditional writes, same-ms/clock-rollback CAS, transactional business audit и archive/reference safety подтверждены. Staff DELETE не вызывает MinIO SDK/DeleteObject и не удаляет bytes. Нового writer/destructive recovery path нет. Independent Final Review допускает отдельный backend commit с явным неблокирующим P2 note; рекомендуется устранить F-3-R01 перед его фиксацией. Это не production approval.

Основные документы прочитаны и сохранены: [implementation](student-documents-phase3-staff-crud-report.md), [Phase 2B-2 release](student-documents-phase2b2-release-review.md), [Phase 2B-3B final review](student-documents-phase2b3-final-review.md), [recovery runbook](student-documents-recovery-runbook.md). Automatic destructive recovery и U1/U2/G1 остаются NOT APPROVED.

## 2. Git Scope

Branch `release/manual-contract-candidate`; HEAD равен baseline. Index пуст. Preflight tracked/untracked diff совпал с implementation inventory. Fresh SHA-256 snapshot **716 existing files** охватывает tracked files, 8 new source/test и existing ignored docs; все сохраняются после audit. Единственное новое repository изменение этого review — данный ignored Markdown report. Build/generate обновляли только штатные ignored outputs; generated/env/credential artifacts не включены в Git diff.

| Modified tracked — 9 | Проверенный scope |
| --- | --- |
| `.github/workflows/ci.yml` | Name existing mandatory student+staff API quality step |
| `src/common/authorization/student-document-access.service.ts` | staff-mutate operation/profile row lock; default self сохранён |
| `src/common/serialization/public-audit.ts` | Два explicit business action allowlists |
| `src/common/serialization/public-audit.spec.ts` | Два privacy cases |
| `src/modules/document/api/document.controller.ts` | Extraction binary response helper |
| `src/modules/document/document.module.ts` | Staff controller/guard registration |
| `src/modules/document/repository/document.repository.ts` | Scoped reads/list, strict metadata/archive CAS, monotonic timestamp |
| `src/modules/document/service/document.service.ts` | Seven staff methods/shared persist + existing review lock/token |
| `test/run-student-document-storage.mjs` | Обязательная staff suite в отдельной owned DB |

| New source/test — 8 | Проверенный scope |
| --- | --- |
| `src/modules/document/api/document-stream-response.ts` | Shared binary responder |
| `src/modules/document/api/dto/staff-document.dto.ts` | DTO/direct-service validation/IDs |
| `src/modules/document/api/staff-document-input.interceptor.ts` | Raw input до global whitelist/transform |
| `src/modules/document/api/staff-document-mutation.guard.ts` | Staff authorization до Multer |
| `src/modules/document/api/staff-document.controller.ts` | Seven routes/OpenAPI |
| `src/modules/document/repository/document-snapshot.ts` | Snapshot/CAS timestamp helper |
| `src/modules/document/repository/document-snapshot.spec.ts` | 40 unit cases |
| `test/document-staff-api.test.ts` | 140 real HTTP/PG/MinIO cases/benchmarks |

Existing ignored implementation report сохранён без изменения. Нет Prisma/schema/migrations/package/lock/dependency changes, Contracts/Payments/Lead, public UploadService/ContractScanService, production deployment, bucket configuration, observation worker/recovery service или rejected design changes. User files не удалялись/не перемещались. Temporary probes/harness/logs находятся только в `/private/tmp/oxus-phase3-final*`.

Local upstream `origin/release/manual-contract-candidate`: ahead 1 / behind 0; fetch/remote CI не выполнялись. В audit нет git add/commit/push/reset/restore/clean/rebase и Git index mutations. Production/Test не использовались.

## 3. Staff Authorization

Все семь routes применяют JwtAuthGuard → RolesGuard (`ADMIN`,`EXPERT`), centralized service policy; upload/version дополнительно staff mutation guard до FileInterceptor. [Controller:35](../src/modules/document/api/staff-document.controller.ts#L35), [early guard:12](../src/modules/document/api/staff-document-mutation.guard.ts#L12), [DB policy:11](../src/common/authorization/student-document-access.service.ts#L11).

| Actor/current DB | Результат |
| --- | --- |
| Active ADMIN, enabled role | Любой existing portrait, без student JWT/собственного portrait |
| Active assigned EXPERT, enabled User/Role, active own profile | Только current assignment |
| Foreign/unassigned EXPERT, inactive/transferred profile/assignment | Deny |
| Blocked User/deleted Role/role change | Deny; same JWT не сохраняет старые права |
| STUDENT/SCHOOLBOY/SALES_MANAGER/SUPPORT | Staff deny |
| Forged JWT ADMIN roleCode | Актуальный DB role заменяет claim; deny чужому role |
| Missing JWT | 401 |

ADMIN и EXPERT uploads подтверждены real HTTP suite; I01 независимо проверяет все семь forbidden routes и distinct ID domains. Portrait lookup использует StudentPortrait.id, owner — portrait.userId, assignment — ConsultantProfile.id и profile.userId. Student JWT не подставляется, actor audit остаётся staff.

Service authorizes выбранный portrait до поиска Document по id+studentPortraitId; missing/foreign document →одинаковый404 даже ADMIN. Missing/inaccessible portrait и missing/foreign target дают безопасный403. List filter и creation target проверяют own target; no free object key/URL input. I02 подтвердил foreign portrait/document/program IDOR negatives; repository list/detail/download paths прочитаны. New mutation transaction повторяет policy под locks после Put; I03-* удерживает **уже завершённый actual Put**, затем revokes actual DB grants и получает403 без Document change.

## 4. Lock Ordering

Actual PostgreSQL `FOR SHARE`: **User → Role → StudentPortrait → own ConsultantProfile → TargetProgram**. Profile добавлен для staff/review; self сохраняет baseline порядок без profile; target lock условный. [Lock protocol:42](../src/common/authorization/student-document-access.service.ts#L42). I04 перехватил actual pg adapter SQL и проверил ровно пять statements в этом порядке; отдельные real transactions с `FOR NO KEY UPDATE NOWAIT` получили55P03 на каждой строке, пока upload held перед transactional audit completion.

Locks не берутся во время buffering/Put. Mutation повторяет DB policy после acquisition, затем relevant pre-I/O owner/assignment/actor-role snapshot comparison. Current authorized write linearizes под locks: revoke/transfer завершившийся раньше запрещает запись, пришедший позже ждёт commit/rollback. No automatic retry. Metadata/archive не берут target lock: они не меняют target relation; проверяется ownership документа выбранному portrait.

Existing review теперь берёт тот же authorization order в existing Serializable transaction; его предварительный SELECT Document — обычный read, не обратный row UPDATE lock. Document conditional update идёт после authorization locks. I06/I07/I08/I09 и permanent races не показали deadlock/lost update между проверенными staff/student mutation flows.

Related runtime writers прочитаны: [admin user→profile:668](../src/modules/admin/admin.service.ts#L668) обновляет User до ConsultantProfile upsert; [contract assignment:175](../src/modules/contract/repository/contract.repository.ts#L175) обновляет portrait и не делает обратный Document→staff actor/profile lock chain; [portrait updates:59](../src/modules/admin/portrait/repository/portrait.repository.ts#L59) — обычные row UPDATE. Не найден reachable обратный порядок тех же пяти locks в этих paths. Это не доказательство отсутствия всех DB deadlocks: direct SQL/future multi-row writers обязаны соблюдать order, FK locks/Serializable могут давать conflicts.

P2025/P2034 явно преобразуются в409. Не заявляется, что любой raw SQL deadlock/lock-timeout станет409: handlers не включают P2010 SQLSTATE mapping, unknown DB errors идут в safe500. Reverse-order operator transaction этим review не одобряется; current locks подтверждают safety, а не универсальную liveness guarantee. Runtime transactions ограничены maxWait/timeout5s для staff/persist; synthetic contention probe wall duration69.692ms не является production latency bound.

## 5. CAS / Monotonic Timestamp

[Helper:5](../src/modules/document/repository/document-snapshot.ts#L5): `max(Date.now(),previous+1ms)`. [Assertion:14](../src/modules/document/repository/document-snapshot.ts#L14) проверяет valid version и exact canonical UTC timestamp. Источником защиты является **SQL conditional WHERE**, а не одно сравнение TypeScript.

| Runtime writer | SQL/CAS source |
| --- | --- |
| Staff metadata/archive | [repository:88](../src/modules/document/repository/document.repository.ts#L88), id/portrait/version/updatedAt/deletedAt/status/fileKey/fileUrl |
| Staff/student private version | [repository:21](../src/modules/document/repository/document.repository.ts#L21), дополнительно target relation и version increment |
| Legacy version method | [repository:62](../src/modules/document/repository/document.repository.ts#L62), deletedAt/version/time/status/fileUrl; runtime method сохранён |
| Student submit | [repository:70](../src/modules/document/repository/document.repository.ts#L70), conditional status update с monotonic token |
| Review | [service:379](../src/modules/document/service/document.service.ts#L379), active row/version/time/REVIEW/fileUrl + current portrait relation |

Поиск всех runtime `document.update/updateMany/upsert` выявил только эти writers и initial-create locator update до публикации первого snapshot. Seed [expert.seed.ts:165](../src/prisma/seed/expert.seed.ts#L165) — отдельный offline DB writer, не runtime API; нельзя запускать его concurrent с live mutations и считать защищённым этим API CAS. New schema/trigger не создавался.

I05 независимо установил future2098 timestamp и Date.now на1000ms назад; metadata A→B→A, submit, review, replacement дали exactly +1/+2/+3/+4/+5ms. Actual captured пять UPDATE statements содержали в WHERE id/version/updatedAt/status/deletedAt/fileUrl. Stale original ABA snapshot и wrong expectedVersion rejected409. Repository WHERE также независимо прочитан на source level — fileKey/portrait и target restrictions не потеряны.

I06 два transaction snapshots одинаковой строки: ровно один200, второй409 и один audit; I07 review winning before metadata WHERE →metadata409; I08 metadata winning after review read →Serializable review409 без audit/approval; I09 student/staff version после двух actual Puts →один winner, одна increment; I10 archive after actual Put →replacement409, old key retained. Permanent suite проверяет оба порядка metadata/delete/version/review и feedback/status preservation. Resurrection deletedAt excluded; blind last-write-wins в найденных API writers нет.

Boundaries: monotonic timestamp может кратко оказаться впереди wall clock; guarantee относится к participating writers, не произвольному external SQL/seed. Student submit сохраняет baseline отсутствие нового business audit action; transactional audit обязателен для всех четырёх новых staff mutation kinds и existing version/review flows. F-3-R01 принимает неправильный raw тип version, но не отключает equality WHERE/expectedUpdatedAt.

## 6. Soft Delete

[Service:247](../src/modules/document/service/document.service.ts#L247): current staff authorization/locks →scoped lookup →для active row strict snapshot →conditional archive →mandatory same-transaction AuditLog. Stale first DELETE409. Archived repeat после актуальной authorization и scoped ownership200 `{"deleted":true}` без mutation/audit и token equality; malformed DTO по-прежнему400. Revoked actor не получает bypass.

I06-delete: два concurrent requests, оба прочитали active snapshot →200/409; repeat после successful archive200, row unchanged, audit exactly1. Сохранены Document row/fileKey/fileUrl/version/status/feedback; archive не вызывает MinIO SDK. I10/I11 проверяют racing replacement, archived object existence, revoked repeat и ADMIN repeat. No restore/purge/physical deletion route.

Archived excluded в source student/staff list/detail/download/mutation и nested reads: [portrait:98](../src/modules/admin/portrait/repository/portrait.repository.ts#L98), [target:14](../src/modules/target-program/repository/target-program.repository.ts#L14), [admin:236](../src/modules/admin/admin.service.ts#L236), [expert dashboard:50](../src/modules/expert-dashboard/repository/expert-dashboard.repository.ts#L50). I11 проверяет HTTP staff/student/detail/file и real nested portrait/target repository. [Compensation reference count:62](../src/modules/document/service/document-storage-recovery.service.ts#L62) включает archived; synthetic PENDING intent с archived key не меняется/не удаляет bytes даже при rollbackProven=true.

## 7. Storage Safety

Все staff file mutations reuse [shared persist:66](../src/modules/document/service/document.service.ts#L66). Existing [storage:119](../src/common/utils/minio/student-document-storage.service.ts#L119) awaits durable intent before conditional Put; Document/business audit/intent COMMITTED atomic в короткой post-Put transaction. Staff не вызывает public UploadService или новый private writer.

Early staff policy before Multer, repeat policy after actual Put подтверждены. File limit inclusive10MiB выполнен staff-only MAX+1 sentinel: Busboy equality event для MAX+1 даёт413 до storage; MAX валиден. I14 independently проверил MAX, MAX+1, MAX+2 и exact download bytes. Fields/parts sentinels ограничены, duplicate title rejected400 до SDK. Existing PDF high-bit mutations5/5 rejected, valid PDF/JPEG/PNG accepted; validators остаются shallow structural, не AV/full decoder.

Staff flow не делает дополнительную полную Buffer copy; existing Multer Buffer и storage-owned copy остаются согласно APPROVED Option A. Upload buffered, download streaming. Aggregate admission limits не добавлены — отдельный production risk.

I12 бросает audit error **после реального INSERT внутри transaction** для upload/version/metadata/delete: Document и business event rollback, old bytes сохранены. Existing compensation может удалить только fresh unreferenced key при proven rejected callback, не old document bytes. I13 actual Put lost ack / actual successful COMMIT lost ack / transaction unavailable before callback: соответственно PENDING/COMMITTED/PENDING и bytes retained, SDK delete counter unchanged. Permanent real suite producer child exit77 after actual Put повторён; crash retains durable PENDING без Document. Failure injection поверх real operations — это controlled loss-ack simulation, не network packet-loss test.

Automatic destructive recovery, worker mutation, fencing/grants/pruning не добавлены. No-ref/old age/HEAD404 не превращены в delete authorization. Old versions и uncertain objects не обещают eventual cleanup.

## 8. DTO / API Contract

`B=/api/v1/expert/portraits/:portraitId/documents`:

| Method | Route | Contract |
| --- | --- | --- |
| GET | B | `{data,total,page,totalPages}`, active filters |
| GET | B/:documentId | PublicDocument |
| POST | B | multipart file/title/documentType/[own targetProgramId],201 |
| GET | B/:documentId/file | Authorized binary attachment |
| PATCH | B/:documentId/new-version | file + expectedVersion/expectedUpdatedAt,200 |
| PATCH | B/:documentId | title only + snapshot,200 |
| DELETE | B/:documentId | snapshot,200 `{deleted:true}` |

[Raw interceptor:16](../src/modules/document/api/staff-document-input.interceptor.ts#L16) выполняется до production global transform/whitelist; multipart body дополнительно проверяется после FileInterceptor. Raw route IDs strict decimalpositive ≤Int max; `1e2`,`0x10`, negative/fractional/overflow rejected400. Unknown/protected metadata fields, null, malformed multipart/title trim/length checked; direct service validates также. **Частичное исключение — numeric DTO coercion F-3-R01 ниже: raw check сам делает plainToInstance до IsInt.** Нельзя утверждать, что все raw primitive types отвергаются.

Pagination default1/20, limit≤100, offset≤100000; stable updatedAt DESC,id DESC. RepeatableRead count/page единый snapshot, target ownership checked, foreign filters403; no unbounded includeDeleted. Snapshot между разными page requests при concurrent writes не обещается.

PublicDocument unchanged11 fields; private fileUrl relative JWT locator, internal key/operationId/deletedAt/recovery absent. Public AuditLog actions используют positive explicit allowlist; technical intent rows скрыты existing readers. Existing student routes, DTO/request/response fields не изменены; extracted responder одинаков. Более строгий monotonic updatedAt на existing update writers — намеренный необходимый concurrency token, не новый field/schema.

Permanent staff Swagger checks exact7 routes, bearer, title-only required DTO, multipart snapshot, response/binary MIME; existing OpenAPI11 и migrations4 passed. Legacy fileKey=NULL returns existing fileUrl на JSON, file404 без arbitrary URL fetch/redirect. I02/I15 confirm scoped negatives/privacy/parity.

## 9. Download Lifecycle

[Shared helper](../src/modules/document/api/document-stream-response.ts#L8) сопоставлен с baseline extracted body: headers, pipe/backpressure, cleanup/error/deadline поведение сохранено; отличие — injected authorized read callback. Staff read DB authorization + scoped document, student existing policy unchanged.

I15 actual byte/header parity student/staff: Content-Disposition `attachment; filename="document-ID.pdf"`, Content-Type/Length, private no-store/nosniff. Real MinIO anonymous deny и valid PDF/JPEG/PNG проходят repository suite. I16 real HTTP client abort при искусственно delayed handoff actual MinIO stream →AbortSignal и late stream destroyed. I17 вызывает captured actual response-deadline callback controlled образом, получает safe503 и cleanup; это callback execution test, не ожидание30s или production proxy latency test.

Review hook, удерживающий owned stream до возврата responder, сам обрабатывает `error` во время искусственной задержки; initial hook этого не делал и породил asynchronous uncaught error после28 assertions. Это нарушение ownership во временном harness, сохранено как initial failed run, а не скрытое passing result. Исправлен только hook; final probes process exit0/fail0. Existing production call chain не содержит такого искусственного удержания. Обобщённая гарантия на произвольного caller, удерживающего stream без error handling, не заявляется.

Existing student74/MinIO20/Jest streaming cases повторили pre/post-headers error sanitization, client cancellation/pending metadata abort, valid/invalid Content-Length cleanup, backpressure и premature-close. Нового demonstrated response race/stream leak в unchanged responder pipeline не обнаружено. Request-time read authorization не отзывает уже начатый stream при later transfer/archive. Existing unreachable TimeoutError branch — inherited P3 ниже.

## 10. Performance

Независимо повторены permanent measured HTTP/PG/MinIO benchmarks; предыдущие числа не перенесены. Synthetic50/100/500, page limit100, timestamps equal, no production-sized statistics:

| Rows | HTTP ms | SELECT incl JWT/auth | Document SELECTs | EXPLAIN execution ms |
| --- | ---: | ---: | ---: | ---: |
| 50 | 11.866 | 9 | 2 | 0.119 |
| 100 | 10.923 | 9 | 2 | 0.166 |
| 500 | 12.306 | 9 | 2 | 0.471 |

Constant9 reads, count+bounded Document page2, no N+1. Actual plans existing `Document_studentPortraitId_deletedAt_updatedAt_idx` + Sort(updatedAt DESC,id DESC), 500 uses top-N heapsort. Equal-time stable pagination verified unique IDs; extra index не требуется на этом measured fixture, production capacity этим не доказана.

4 concurrent exact10MiB Buffer uploads: **505.991ms**, post-Put transaction durations **43.001 /30.369 /24.711 /20.490ms**. I04 независимый authorization-lock/NOWAIT probe69.692ms; no production lock-latency guarantee. No DB transaction during Buffer/Put.

| Memory bytes | Baseline | Four-Put barrier | Peak sampled |
| --- | ---: | ---: | ---: |
| RSS | 512688128 | 572653568 | 573063168 |
| heapUsed | 143934408 | 89881768 | 145717472 |
| external | 72775005 | 155142266 | 155142266 |
| arrayBuffers | 43641192 | 94518848 | 125991113 |

RSS baseline488.94MiB →sampled peak546.52MiB, delta57.58MiB; 10ms sampling46samples. **Client+Nest+Prisma+SDK в одном процессе**, after earlier fixtures/GC; не isolated production server RSS, continuous peak или capacity bound. external включает arrayBuffers, не суммировать. Per-request10MiB не ограничивает aggregate concurrency; admission/memory/proxy/host budget остаётся production decision. Full raw measured plans: `/private/tmp/oxus-phase3-final-benchmarks.json`.

## 11. Independent Probes

Temporary `/private/tmp/oxus-phase3-final/probes.test.ts`: application/fixture bootstrap переиспользован из permanent suite; **security assertions написаны отдельно**. Real controllers/guards/services/repositories/PG/SDK/MinIO, synthetic distinct IDs и controlled barriers; successful SQL/object operations не заменены unit mocks. Hook failure scenarios явно обозначены выше.

| Probe IDs | Cases | Evidence |
| --- | ---: | --- |
| I01 | 1 | All7 HTTP forbidden guards/current role, distinct identities, ADMIN allowed |
| I02 | 1 | Foreign scoped IDs/program, raw route/protected DTO/duplicate multipart |
| I03-profile/assignment/user/role/profile-user | 5 | Revoke после completed real Put, transaction denies/preserves old key |
| I04 | 1 | Actual SQL lock order + five NOWAIT transactions |
| I05 | 1 | Actual WHERE, future timestamp/backward clock/ABA,5 monotonic writes |
| I06-metadata/delete | 2 | Both snapshots observed, conditional winner, double DELETE repeat/audit |
| I07/I08 | 2 | Both orders metadata/review, no stale approval/audit |
| I09/I10 | 2 | Student/staff versions after real Puts; archive wins/no resurrection |
| I11 | 1 | Archived reference retained, current authorization on repeat, nested filters |
| I12-upload/version/metadata/delete | 4 | Real audit INSERT then thrown failure, atomic rollback |
| I13-lost Put/lost COMMIT/unknown transaction | 3 | Actual bytes/journal retained, no guessed Delete |
| I14 | 1 | MAX/MAX+1/MAX+2,5 high-bit headers, valid formats |
| I15 | 1 | Actual download parity/headers/legacy no-fetch |
| I16/I17 | 2 | Real HTTP disconnect/deadline callback/late stream cleanup |
| I18 | 1 | Diagnostic reproduces open numeric DTO finding, stale CAS stays409 |
| **Total** | **28** | **PASS, fail/cancelled/skipped/todo0; not repository membership** |

Initial temporary mapping KeyError before runner launch исправлен; log `oxus-phase3-final-probes-orchestration-initial.txt`. First actual combined run: student74/staff140 passed,28 probe assertions passed, process failed on held-stream ownership error; full log `oxus-phase3-final-probes-ownership-initial.txt`. После исправления только temporary hook повторены probes в новой owned DB/MinIO, final28/28 exit0; никто не менял repository tests или assertions для сокрытия дефекта. P2 diagnostic намеренно проверяет факт acceptance, не выдаёт его за valid input.

## 12. Full Regression

Все gates повторены с explicit disposable local env/DOTENV_CONFIG_PATH=/dev/null, не real .env. Generate/build завершены до real API suites; TS/MJS lint без auto-fix.

| Gate | Fresh result | Unique count |
| --- | --- | ---: |
| Full Jest | PASS,53 suites/661 cases | 661 |
| Standard integration runner | PASS,24 TAP groups/400 | 400 |
| Real student+staff Document API | PASS,74+140 | 214 |
| Real MinIO foundation | PASS,20 | 20 |
| Storage runner security | PASS,13 | 13 |
| Observation runner | PASS,CLI26+PG25 | subset400 |
| Document HTTP security | PASS,80 | subset400 |
| Existing OpenAPI/migrations | PASS,11/4 | subset400 |
| Prisma validate/generate | PASS; client7.8.0 | — |
| Nest build / TypeScript noEmit | PASS/PASS | — |
| Full TS lint / storage+observation MJS lint | PASS/PASS | — |
| Diff check / scope/unchanged files/index/HEAD | PASS | — |
| Temporary independent probes | PASS,28 | separate |

**661+400+214+20+13=1308 unique repository cases**, expected baseline совпал. Repeated subsets и probes не добавлены. Student/staff214 pass извлечён из first combined runner log отдельно от failed temporary hook group; эти repository suites process exit0. Final probes-only runner exit0. Hosted CI/cold resources не проверены remote; mandatory CI integration подтверждена statically [CI:97](../.github/workflows/ci.yml#L97) + runner всегда включает staff suite [runner:111](../test/run-student-document-storage.mjs#L111).

Logs `/private/tmp/oxus-phase3-final-{jest,integration,probes-api,probes,minio,runner,observation,document-http,validate,generate,build,typescript,lint,mjs-lint}.txt`; snapshot `oxus-phase3-final-baseline.json` и final verification `oxus-phase3-final-check.json`. Temporary logs не являются permanent repository tests.

Verified explicit local Docker Desktop socket `unix:///Users/johnycarlson/.docker/run/docker.sock`, PG17/Redis7 loopback57251/57252, generated runner MinIO credentials/tmpfs/owner labels. PG exactID `fb7def439d555f081c6563ed18bd373d2f0d4953499a9b2e0c9e09896ccf710e`; Redis `456167ef24d0e252697209256ddd0c0e1d59fba9780cb9e8543d7462e257dd32`. SQL cleanup confirmed только bootstrap/postgres DBs,0 public tables; MinIO suite containers отсутствуют. Owned PG/Redis удалены по exactIDs после labels, manifest cleaned=true. Global prune/чужие containers/data/Production/Test не использовались.

## 13. Findings P0–P3

**New P0:0. New P1:0. New P2:1.** Existing P2 infrastructure/P3 остаются open. Findings не исправлены автоматически в read-only review.

### F-3-R01 — P2 OPEN: raw numeric DTO принимает boolean/non-decimal ID

Source: [expectedVersion Number transform:11](../src/modules/document/api/dto/staff-document.dto.ts#L11), [create target transform:38](../src/modules/document/api/dto/staff-document.dto.ts#L38), [query target transform:65](../src/modules/document/api/dto/staff-document.dto.ts#L65), [validation order:75](../src/modules/document/api/dto/staff-document.dto.ts#L75), [raw interceptor:21](../src/modules/document/api/staff-document-input.interceptor.ts#L21).

Evidence I18: real HTTP PATCH с current version1/timestamp и JSON `expectedVersion:true` вернул200 и изменил title; direct DTO получился expectedVersion1. GET filter с hexadecimal form owned targetProgramId вернул200. Raw check выполняется вовремя, но `plainToInstance` уже приводит primitive прежде `IsInt`, поэтому public OpenAPI integer contract не обеспечивает strict raw type. Это новый API validation defect; existing route `staffDocumentId` остаётся strict, `1e2`/hex route IDs400.

Impact/severity: принимает ошибочные/несогласованные с OpenAPI numeric inputs. **Не** показан IDOR/CAS bypass: actor и target ownership checked, exact expectedUpdatedAt и SQL conditional WHERE работают, исходный stale timestamp после first mutation409. Поэтому P2 nonblocking backend security note, не P1 data-integrity breach. Возможные другие coercions требуют targeted negative coverage; не заявляются как independently reproduced здесь.

Минимальная remediation: staff-only raw primitive numeric validation до plainToInstance для snapshot/program/query fields. Reject boolean/array/object; JSON snapshot — integer number по контракту; multipart/query — canonical positive decimal string или разрешённый уже typed integer; сохранить positive bounds и own-program authorization. Не менять global/student DTO. Добавить permanent HTTP/direct DTO negatives для boolean и malformed numeric forms, повторить targeted + applicable regressions. Пока OPEN; recommendation — закрыть перед отдельным commit, либо явно принять этот note.

### F-2B1-03 — inherited P2 OPEN: hosted cold/resource/deadline budget

Source [mutable base images:3](../test/minio.Dockerfile#L3), [runner child:27](../test/run-student-document-storage.mjs#L27), [first build:48](../test/run-student-document-storage.mjs#L48), [CI timeout:27](../.github/workflows/ci.yml#L27). Evidence unchanged runner: cold source build, mutable image tags, no per-command CPU/RAM/tmpfs/deadline bounds; warm local success не доказывает hosted budget/kill cleanup. Минимальная separate remediation: reproducible/pinned cache strategy, cold CI measurement и explicit resource/command/cleanup budgets.

### F-2B1-04 — inherited P2 OPEN: Docker context locality

Source [inherited Docker env:29](../test/run-student-document-storage.mjs#L29), [side effect:48](../test/run-student-document-storage.mjs#L48), [loopback publish:62](../test/run-student-document-storage.mjs#L62). Runner не validates daemon locality до Docker side effects; loopback относится к selected daemon host. **Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки.** Этот audit явно проверил local Unix socket, но не исправил общий дефект. Минимальная separate remediation: approved local daemon guard before build/create; не проверять гипотезу на Production/Test/remote context.

### F-OBS-01 — inherited P2 OPEN: observation capacity/freshness

Source [full summaries:39](../src/modules/document/observation/document-observation.repository.ts#L39), [references:123](../src/modules/document/observation/document-observation.repository.ts#L123). Evidence source и повторённый real observation suite: bounded output не ограничивает global aggregate/reference scan cost и полного sweep freshness. Phase 3 observer/indexes не меняет. Минимальная separate remediation: workload/instance DB budgets, freshness/alert strategy, отдельно approved index design при необходимости.

### F-2B2-R01 — inherited P3 OPEN: unreachable TimeoutError branch

Source [cleanup abort:19](../src/modules/document/api/document-stream-response.ts#L19), [deadline:34](../src/modules/document/api/document-stream-response.ts#L34), [reason branch:65](../src/modules/document/api/document-stream-response.ts#L65). Abort вызывается без TimeoutError reason; deadline уже отправляет503, cleanup/catch возвращаются при ended response. Branch переехала без изменения, новый timeout/cleanup failure не подтверждён. Минимальная separate remediation: удалить unreachable branch и ненужный import с сохранением lifecycle tests.

## 14. Remaining Risks

**U1/U2/G1 OPEN / NOT APPROVED. Automatic destructive recovery NOT APPROVED.** Exclusive per-key producer authority, consumed reservation retention и paused future send boundary не решены Phase 3/observer. Нет новых grants/fences/triggers/cleanup/pruning; existing conservative synchronous compensation не universal recovery protocol. [Runbook](student-documents-recovery-runbook.md), [rejected validation](student-documents-phase2b3-fencing-validation-report.md).

Остаются production memory/concurrency/admission budget, proxy/deadline/host capacity, hosted cold mandatory CI/locality/resources, observation DB capacity/freshness/alerts, JWT-aware frontend/mobile sign-off/rollout, legacy public files/Phase2C, structural validation без AV/decoder, old-version/uncertain-object retention и request-time in-flight download revocation boundary. Seeds/raw SQL не должны обходить live runtime CAS. Historical reviews preserved; старые rejected proposals не выдаются за actual architecture.

No new P0/P1 не означает universal proof: controlled barriers проверяют конкретные interleavings, fault hooks имитируют ack loss, малый local benchmark не моделирует все networks/hosts/proxies. F-3-R01 остаётся явным contract note несмотря на green repository tests.

## 15. Backend Commit Gate

**PASS WITH NOTES.** В рассмотренном diff нет подтверждённых P0/P1, IDOR, lost-update/archived resurrection, physical archive deletion или private storage/audit leak; mandatory fresh gates и independent actual SQL/MinIO assertions прошли. Можно готовить отдельный Phase 3 backend commit с указанными notes. **Рекомендуемая точечная доработка перед commit — F-3-R01**, без schema/API scope expansion; этот audit её не выполняет и не объявляет закрытой. Inherited infrastructure P2/P3 остаются отдельными notes.

Index пуст, HEAD сохранён; application/tests/CI/Prisma/existing reports неизменны относительно pre-review snapshot. Review report ignored существующим docs rule, не staged. Git commit/push/deploy не выполнялись.

## 16. Production Deployment Gate

**NOT READY.** Local backend pass не снимает U1/U2/G1/destructive design gate, client/legacy/capacity/admission/hosted CI/locality/resource/operational rollout blockers. Production/Test не тронуты; deployment не разрешён этим review.

| Итоговый вопрос | Ответ |
| --- | --- |
| 1. Новые P0/P1? | Нет подтверждённых; новый P2 F-3-R01 raw numeric DTO |
| 2. Current-DB authorization без IDOR? | Да в рассмотренных seven-route/service/transaction scenarios и controlled revocations |
| 3. CAS bypass при concurrency? | Не выявлен; actual WHERE, same-ms/ABA/backward clock/races подтверждены |
| 4. Physical deletion через staff DELETE? | Нет, archive сохраняет row/references/bytes, SDK calls0 |
| 5. Storage/audit leaks? | В проверенных public/nested/error/binary paths не обнаружены; legacy URLs сохраняются как known scope |
| 6. Tests/probes? | 1308 unique repository + separately28/28 independent probes |
| 7. Можно отдельный Phase3 commit? | Да, PASS WITH NOTES; recommended F-3-R01 remediation before commit, index пуст |
| 8. Что блокирует Production? | U1/U2/G1/destructive recovery, JWT clients/legacy files, capacity/admission/hosted cold CI/locality/resources/operational rollout |
