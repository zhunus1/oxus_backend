# Phase 3 — Staff Document CRUD for StudentPortrait

Дата: 2026-10-10, Asia/Almaty. Baseline и текущий HEAD: `2296e351442064b9d18fed9dca6af4cb5bd42bb6`.

**Implementation завершена. Backend Commit Gate: PASS WITH NOTES. Production Deployment Gate: NOT READY.** Это implementation report для независимого Final Code Review; независимое одобрение данного diff ещё не получено.

## 1. Executive Summary

Реализованы все семь portrait-scoped staff routes. ADMIN работает с любым существующим StudentPortrait; EXPERT — только с актуально назначенным портретом при активном собственном ConsultantProfile и актуальных User/Role. Student JWT для staff операций не требуется: actor, ownerUserId, StudentPortrait.id и ConsultantProfile.id остаются разными сущностями.

Утверждённые пользователем решения выполнены:

- **DG-3-UPLOAD: APPROVED — Option A.** Текущий bounded Buffer pipeline, файл ≤10 MiB; early authorization перед Multer, повторная DB authorization в mutation transaction. Это buffered upload. Streaming/spooling и отдельного private writer нет; дополнительных полных копий в staff implementation нет. Aggregate memory/concurrency измерены, ограничения приведены в разделе 11.
- **DG-3-DELETE: APPROVED WITH CONDITIONS.** Только soft-delete: strict expectedVersion/expectedUpdatedAt CAS и mandatory transactional AuditLog на первом DELETE; stale active snapshot →409. Повторный DELETE уже archived row после актуальной staff authorization и проверки portrait/document ownership →200 `{"deleted":true}` независимо от старого валидного snapshot, без повторного audit event. Document row, file references, version/status/feedback и bytes сохраняются.
- **DG-3-METADATA: APPROVED — title-only.** Все остальные business/storage поля напрямую менять запрещено.

Timestamp CAS проверен на реальном PostgreSQL при замороженном wall clock: каждое runtime API изменение продвигает updatedAt минимум на 1 ms, включая title A→B→A, student submit, review и replacement. Схема не изменена. Прошло **1308 уникальных tests = baseline 1126 + 182 новых**; все обязательные локальные regression gates прошли.

## 2. Git Scope

Ветка `release/manual-contract-candidate`; HEAD сохранён. Preflight: index и tracked/untracked worktree были чистыми; сохранён hash inventory 708 существовавших файлов. Local upstream `origin/release/manual-contract-candidate`: ahead 1 / behind 0. Fetch, hosted CI queries и remote операции не выполнялись.

Scope: **9 modified tracked implementation files + 8 new source/test files + этот существовавший ignored report = 18 файлов**. Index оставлен пустым. Остальные файлы baseline inventory, включая Prisma/schema/migrations, Contracts/Payments/Lead, deployment, observation worker, recovery service, rejected architecture и другие пользовательские документы, сохранены. Полный список — раздел 13. Generated build/client outputs остаются ignored артефактами штатных проверок; env/secret/build файлы не входят в Git diff.

CI staff suite обязательна внутри существующего quality job: `yarn test:documents-private-api` теперь без opt-in запускает и student, и staff реальные suites. Triggers workflow по-прежнему PR/push test/main и workflow_dispatch; push в текущую release branch сам по себе не доказывает hosted gate. [CI](../.github/workflows/ci.yml#L97), [runner](../test/run-student-document-storage.mjs#L111).

Git add/commit/push/reset/restore/clean, deployment и подключения к Production/Test не выполнялись. Файлы пользователя не удалялись и не перемещались.

## 3. Staff API Contract

`B = /api/v1/expert/portraits/:portraitId/documents`. Prefix согласован с existing staff portrait API; контроллер обслуживает ADMIN и EXPERT. [Controller](../src/modules/document/api/staff-document.controller.ts#L38).

| Операция | Method / route | Input | Success | Business audit |
| --- | --- | --- | --- | --- |
| List | GET B | page, limit; optional status/documentType/targetProgramId | 200 `{data,total,page,totalPages}` | Нет |
| Detail | GET B/:documentId | scoped IDs | 200 DocumentEntity | Нет |
| Upload | POST B | multipart: file, title, documentType; optional targetProgramId | 201 DocumentEntity | DOCUMENT_CREATED |
| Private download | GET B/:documentId/file | scoped IDs | 200 binary attachment | Нет |
| New version | PATCH B/:documentId/new-version | multipart: file, expectedVersion, expectedUpdatedAt | 200 DocumentEntity | DOCUMENT_VERSION_UPLOADED |
| Metadata | PATCH B/:documentId | JSON: title, expectedVersion, expectedUpdatedAt | 200 DocumentEntity | DOCUMENT_METADATA_UPDATED |
| Soft-delete | DELETE B/:documentId | JSON: expectedVersion, expectedUpdatedAt | 200 `{"deleted":true}` | DOCUMENT_DELETED только при первом переходе |

IDs: positive integers ≤2147483647; raw route params дополнительно проверяются до global transform, поэтому `1e2`, fractions, overflow и malformed IDs не превращаются в другой resource ID. Title trim, 1..255 символов; null, unknown/protected fields и пустой PATCH запрещены. Raw DTO проверяется до global whitelist, который иначе мог бы незаметно удалить запрещённые поля. Для multipart такая проверка повторяется после Multer; прямые service calls также валидируются. [DTO](../src/modules/document/api/dto/staff-document.dto.ts#L9), [interceptor](../src/modules/document/api/staff-document-input.interceptor.ts#L16).

Pagination: default page=1, limit=20, max limit=100, max offset=100000; order updatedAt DESC, id DESC; count/page с одинаковыми active filters в одной RepeatableRead transaction. `totalPages=max(1,ceil(total/limit))`. Между несколькими HTTP requests snapshot pagination при concurrent writes не обещается. targetProgramId filter/create проверяется на принадлежность выбранному portrait. deleted/includeDeleted filters отсутствуют.

Snapshot: обязательный positive expectedVersion и canonical UTC timestamp `YYYY-MM-DDTHH:mm:ss.SSSZ` из предыдущего response. Invalid DTO →400, stale valid snapshot →409. Already archived DELETE всё ещё требует валидную форму DTO, но не сравнивает старый token с текущим.

Файл: один PDF/JPEG/PNG ≤10485760 bytes с существующей content/MIME validation. Busboy сообщает file/parts limit при equality; staff-only sentinel MAX+1 и parts+1 разрешает **ровно 10 MiB** и разрешённое число полей, оставляя oversized rejection до Put. Upload: fields=3, fieldSize=1024, parts sentinel=5; replacement: fields=2, parts sentinel=4. Shared validator по-прежнему ограничивает файл 10 MiB; student multipart contract не изменён. [Limits](../src/modules/document/api/staff-document.controller.ts#L23).

Errors: 400 invalid input; 401 missing/invalid JWT или отключённый account на guard; 403 current role/profile/assignment denied, missing/inaccessible portrait или missing/foreign target; 404 scoped document missing/foreign/archived, legacy binary или отсутствующий private object; 409 stale snapshot/concurrent write/access change; 413 multipart limits; 503 private storage/deadline; 500 безопасный DB/audit failure. SDK details наружу не сериализуются. Swagger содержит exact seven routes, bearer, DTO, multipart, binary MIME/headers, CAS и responses; проверен автоматически.

## 4. Authorization Matrix

| Actor / актуальная БД | Staff routes |
| --- | --- |
| Active ADMIN + enabled Role | Любой existing StudentPortrait, включая unassigned и SCHOOLBOY portrait |
| Active EXPERT + enabled Role + active own ConsultantProfile + current assignment | Только назначенный portrait |
| Foreign/unassigned EXPERT; inactive/missing/transferred profile | Deny |
| Blocked User / deleted Role / смена role | Deny; JWT role claim не источник прав |
| STUDENT/SCHOOLBOY, SALES_MANAGER, SUPPORT и прочие roles | Deny |
| No/invalid JWT | 401 |

JwtAuthGuard читает актуальную БД и заменяет JWT roleCode; centralized StudentDocumentAccessService применяется также в staff service. Multipart mutation guard выполняется **до FileInterceptor/Multer**. После внешнего Put все authorization predicates повторно проверяются под DB locks в mutation transaction. [Early guard](../src/modules/document/api/staff-document-mutation.guard.ts#L12), [policy/locks](../src/common/authorization/student-document-access.service.ts#L11).

Не требуются student login, student JWT или собственный StudentPortrait у staff. Не добавлено требование активного target student account, отсутствующее в утверждённом контракте. Service сперва authorizes portrait, затем ищет Document по id+studentPortraitId; foreign document и missing document получают одинаковый 404. ADMIN также не может подставить document чужого portrait.

## 5. CRUD Implementation

Staff controller/guard зарегистрированы в existing DocumentModule. Узкие staff methods добавлены в existing DocumentService; repository переиспользует existing Prisma и public select. Дополнительного независимого orchestration/storage service нет. [Service](../src/modules/document/service/document.service.ts#L154), [repository](../src/modules/document/repository/document.repository.ts#L76).

Upload создаёт DRAFT/version=1 с immutable UUID private key. New-version строго проверяет client snapshot и затем existing conditional repository write; successful replacement увеличивает version, устанавливает DRAFT/feedback=null, оставляет старый объект. Metadata меняет только title и CAS timestamp, сохраняя version/status/feedback, type/program и file references. Даже такой же trimmed title — успешная mutation с новым token и audit, а не скрытый no-op.

First DELETE atomically выставляет deletedAt, продвигает token и пишет audit. Row, title/type/program, fileKey/fileUrl, version/status/feedback и MinIO objects сохранены. Stale active row →409. Archived повтор сначала authorizes актуальную БД и проверяет scoped ownership, затем возвращает success без write/audit и snapshot equality. Revoked actor не получает idempotent bypass. Concurrent requests, прочитавшие ещё active row, могут получить 409; последующий repeat после archive получает 200. [Archive transaction](../src/modules/document/service/document.service.ts#L247).

Archived row исключается из existing student/staff reads, nested portrait/target reads, download, new-version, metadata и review. Restore, purge, physical deletion и отдельные submit/review aliases не добавлены. Staff upload сам по себе не образует полный staff-only review lifecycle: существующий student submit и существующий ADMIN/EXPERT review сохранены.

## 6. Private Storage Reuse

Staff upload/new-version вызывают тот же `persistPrivateFile`: validate → bucket verification → UUID key → durable PENDING intent before Put → conditional PutObject → короткая Document + business AuditLog + intent COMMITTED transaction → existing conservative compensation. Actor — staff User.id, ownerUserId — portrait.userId; не происходит impersonation студента или student journey logging от staff. [Shared persist](../src/modules/document/service/document.service.ts#L66).

Option A сохраняет Multer Buffer и existing storage-owned copy, которая защищает validated bytes во время asynchronous I/O. Staff path не делает дополнительный Buffer.from/concat/readFile. Upload не streaming. Storage validator, SDK client, recovery service и bucket configuration не изменены.

Soft-delete не вызывает SDK и никогда не делает DeleteObject. Existing synchronous compensation по-прежнему допустима только для fresh unreferenced key при доказанном rollback; это не physical delete документа. Put failure/lost acknowledgement, unknown COMMIT и unavailable DB после Put сохраняют intent/object по existing conservative правилам. Новых cleanup paths, automatic destructive recovery или private writers нет.

## 7. Concurrency/CAS

Старого version/status CAS недостаточно для title-only изменения: несколько writes могут иметь тот же version и одинаковый millisecond updatedAt. Минимальное исправление — общий `nextDocumentTimestamp(previous) = new Date(max(Date.now(), previous+1 ms))` для всех **runtime Document API update writers**: metadata/archive, private/legacy version, submit и review. SQL write остаётся conditional по ожидаемой строке; вычисление token без conditional predicate не считалось бы защитой. [Token](../src/modules/document/repository/document-snapshot.ts#L5), [conditional writes](../src/modules/document/repository/document.repository.ts#L21), [review](../src/modules/document/service/document.service.ts#L376).

Client snapshot проверяется на входе; DB update защищён id/portrait/version/updatedAt/deletedAt/status/file identity. Первый DELETE может проиграть metadata/version/review/submit и тогда возвращает 409. Реальный frozen-clock тест с future timestamp проверяет строгий +1 ms и ABA title; student/staff concurrent versions и metadata/archive races проверяют одного winner и один business audit. Prisma schema/index/migrations не потребовались.

Authorization lock order: User FOR SHARE → Role FOR SHARE → StudentPortrait FOR SHARE → own ConsultantProfile FOR SHARE для staff/review → TargetProgram FOR SHARE при file mutation с target. Под locks current-DB policy проверяется повторно. Transfer/revocation, завершившиеся до этой проверки, запрещают mutation; writers, пришедшие после acquisition, ждут commit/rollback. Это точка сериализации authorization, а не обещание откатить уже завершённую операцию при последующем revoke. Реальные NOWAIT probes подтвердили защиту всех пяти row types.

Upload/replacement не держат DB transaction во время Multer buffering/MinIO Put. После I/O дополнительно сравниваются relevant portrait owner/assignment и actor role snapshots; transaction ReadCommitted maxWait/timeout=5 s. Review использует existing Serializable transaction с теми же authorization locks. Deadlock/serialization conflict →409, automatic retry отсутствует.

Граница гарантии: participating runtime writers соблюдают monotonic token; существующий seed/raw SQL/admin DB write не защищён новым DB trigger и не должен concurrent изменять Document в live workload. При clock rollback token может быть на несколько ms впереди wall clock. API fields и millisecond precision PostgreSQL сохранены. Durable history всех revoke/regrant ABA здесь не обещается: проверяется актуальное разрешение в точке mutation.

## 8. AuditLog

DOCUMENT_CREATED / DOCUMENT_VERSION_UPLOADED переиспользуют existing mandatory transaction. Добавлены два explicit public allowlist actions: DOCUMENT_METADATA_UPDATED (fromTitle/toTitle/fromVersion/toVersion) и DOCUMENT_DELETED (fromStatus/toStatus/fromVersion/toVersion). Actor/portrait/owner/document identity хранится во внутреннем audit; private key/operationId/internal diagnostics не выходят через public audit projection. [Allowlist](../src/common/serialization/public-audit.ts#L21).

Audit failure rollback проверен для всех четырёх mutation kinds. Metadata/delete не оставляют partial Document write. Upload/version после доказанного rollback сохраняют existing conservative fresh-object compensation. Повторный archived DELETE не пишет второй audit event. Read/download не добавляют business mutation audit; HTTP response не является доказательством successful полного file transfer.

## 9. Privacy

PublicDocument остаётся existing safe whitelist из 11 полей; fileKey, recovery intent/operation diagnostics и deletedAt не добавлены в response. Private fileUrl сохраняет existing authenticated `/api/v1/documents/:id/file`, не bucket URL/presigned URL. Legacy fileUrl сохраняется для совместимости, но staff binary route при fileKey=NULL возвращает 404 и никогда не fetch-ит произвольный URL.

Binary responder извлечён из existing student controller в общий helper и переиспользуется staff controller: Content-Length/Content-Type, attachment, private no-store, nosniff, response deadline, upstream cleanup, backpressure и cancellation сохранены. Existing реальные 74 private API tests и HTTP security cases проверяют shared behavior. [Responder](../src/modules/document/api/document-stream-response.ts#L1).

Scoped IDOR, forged JWT claims, unknown/protected input, internal public audit exclusion и generic errors проверены permanent tests. Read/download authorization выполняется при запросе; уже начатый stream не прерывается автоматически при последующем archive/transfer — это existing lifecycle boundary. Новый запрос после изменения доступа проходит новую DB authorization.

## 10. Real Integration Tests

Permanent [staff HTTP/PostgreSQL/MinIO suite](../test/document-staff-api.test.ts) содержит **140 cases**, реальный Nest HTTP server, JwtAuthGuard/RolesGuard, production-like global transform/whitelist, actual Prisma/PostgreSQL и SDK/MinIO. Используются synthetic data; IDs владельца, portrait и consultant profile намеренно различаются. SDK barriers инъецируют race/failure в реальном HTTP flow; объектные bytes и SQL state проверяются после операций.

Coverage:

- ADMIN/assigned EXPERT без student JWT, PDF/JPEG/PNG и exact private bytes; denied roles на всех семи routes; oversized denied uploads возвращают authorization error до SDK/Multer success. No-JWT status проверяется с небольшим валидным file: отправка огромного body при early 401 может законно оборвать client socket.
- Current DB revocation/block/role/profile/assignment transfer при том же JWT; direct service entrypoints; own/foreign target programs; scoped document IDOR; strict IDs/query/title/protected fields под existing global whitelist.
- Title-only preservation, CAS stale/ABA/frozen milliseconds, student submit/review/replacement interplay; first/repeat/revoked DELETE; archived student/staff/nested filters; old/new MinIO byte preservation и отсутствие delete SDK calls при archive.
- Staff/staff и staff/student replacements; metadata/delete/review during Put; replacement wins против stale metadata/delete и review; authorization changes during Put; five SQL FOR SHARE/NOWAIT checks. Barriers bounded, без random sleep для определения winner.
- Четыре audit rollbacks, Put failure/lost acknowledgement, unknown COMMIT, DB unavailable after Put; реальный producer child exit 77 после actual Put оставляет durable intent/object без Document row.
- PublicDocument/PublicAudit privacy, legacy URL no-fetch, OpenAPI exact routes/DTO/binary, negative file validation, list EXPLAIN/query counts и aggregate upload memory benchmark.

Новые Jest tests: 40 cases snapshot/DTO/IDs/monotonic timestamps и 2 public audit allowlist/privacy cases. Mandatory runner создаёт отдельные owned DB для existing student suite и нового staff suite; CI не может silently пропустить staff suite с option flag. Existing migration deployment используется исключительно внутри disposable databases.

Infrastructure: перед side effects проверен local Docker Desktop Unix socket `unix:///Users/johnycarlson/.docker/run/docker.sock`, OS/type; PG17/Redis7 только loopback, UUID ownership labels, MinIO runner-owned tmpfs, generated local credentials, explicit child env и DOTENV_CONFIG_PATH=/dev/null. Реальные .env/Production/Test credentials не использовались. После gates проверено отсутствие suite DB/MinIO containers, в bootstrap DB 0 public tables, затем **только owned PG/Redis** удалены по exact IDs после проверки labels. Manifest `/private/tmp/oxus-phase3-infra.json` отмечает cleaned=true. Global prune/чужие контейнеры не трогались.

Промежуточные отказы не скрыты: сначала fixtures делали create уже seeded Role →unique violation; исправлены на upsert. Затем выявлены Busboy equality limits и `1e2` global transform: исправлены staff sentinel/raw validation, добавлены permanent checks. Не дошедший до Put barrier run остановлен только по owned runner PID и штатно cleaned; barrier waits ограничены. No-JWT oversized client ECONNRESET заменён на валидный небольшой file для проверки 401; proof early rejection oversized сохранён для остальных forbidden actors. Также исправлены missing import при TypeScript и unbound/лишний type assertion при lint. Финальные suites имеют 0 fail/skip, `.only`/`.skip` не добавлены. Initial evidence: `/private/tmp/oxus-phase3-private-api-initial-fixture-failure.txt`, `...-private-api-multipart-failure.txt`, `...-typescript-initial.txt`.

## 11. Performance

List benchmark на synthetic 50/100/500 active documents одного portrait, limit=100, одинаковые timestamps для tie ordering; один измеренный request на размер. Не production capacity forecast.

| Documents | HTTP ms | All data SELECTs включая JWT/auth | Document SELECTs | EXPLAIN execution ms |
| --- | ---: | ---: | ---: | ---: |
| 50 | 11.312 | 9 | 2 | 0.246 |
| 100 | 10.197 | 9 | 2 | 0.132 |
| 500 | 12.506 | 9 | 2 | 0.456 |

Document queries — count + bounded page, N+1 нет. Actual EXPLAIN использовал existing `Document_studentPortraitId_deletedAt_updatedAt_idx`, затем Sort(updatedAt DESC,id DESC); 500-row plan — top-N heapsort. Проверена уникальная полная pagination при равных timestamps. Новый индекс/migration не добавлен; measurements без production-sized statistics не обосновывают capacity guarantee.

Upload benchmark: **4 concurrent uploads ×10485760 bytes**, bounded-buffer mode. Все четыре held на barrier перед завершением actual Put; полный upload + byte verification занял **492.760 ms**. Post-Put mutation transaction durations: **19.798 / 15.697 / 16.573 / 17.397 ms**. Buffering/Put находятся вне этих transactions.

| Process memory, bytes | Baseline | At four-Put barrier | Peak sampled |
| --- | ---: | ---: | ---: |
| RSS | 523862016 | 580812800 | 580943872 |
| heapUsed | 149074464 | 94286288 | 150302440 |
| external | 72782606 | 155134278 | 155134278 |
| arrayBuffers | 43648793 | 94518423 | 125987778 |

RSS peak ≈554.03 MiB, delta ≈54.45 MiB. Sampling: interval 10 ms, 45 samples. **HTTP client + Nest server + Prisma + SDK находятся в одном процессе**, после других tests; GC влияет на baseline/heap. Это sampled aggregate process memory, не isolated server RSS, не абсолютный peak и не hard bound. external включает arrayBuffers — значения не складывать. Per-request 10 MiB не ограничивает aggregate uploads; новый global admission limiter не введён. Before production требуется host memory/concurrency budget и отдельное admission/rollout решение. Полные measured plans/bytes: `/private/tmp/oxus-phase3-benchmarks.json`; benchmark воспроизводится permanent suite.

## 12. Full Regression Results

Все перечисленные gates выполнены заново локально, на disposable инфраструктуре. Команды из package scripts исполнялись напрямую через local node binaries/runner с explicit isolated env; build выполнен перед HTTP suites. Итоговые logs — `/private/tmp/oxus-phase3-<gate>.txt`; временные logs не входят в Git scope, permanent tests остаются в репозитории.

| Gate / equivalent command | Result | Unique membership |
| --- | --- | ---: |
| Targeted snapshot Jest (`--runTestsByPath .../document-snapshot.spec.ts`) | PASS, 40 cases | subset full Jest |
| Full Jest (`yarn test --runInBand`) | PASS, 53 suites / 661 cases | 661 |
| Standard PG/Redis integration (`yarn test:integration`) | PASS, 24 TAP groups / 400 cases | 400 |
| Actual student + staff API (`yarn test:documents-private-api`) | PASS, 74 + 140 cases | 214 |
| Real MinIO foundation runner | PASS, 20 cases | 20 |
| Storage runner security tests | PASS, 13 cases | 13 |
| Observation runner (`yarn test:documents-observation`) | PASS, CLI26 + PG25 | subset integration |
| Document HTTP security (`yarn test:documents-security`) | PASS, 80 cases | subset integration |
| OpenAPI and clean migration/schema checks | PASS, OpenAPI11 + migrations4 | subset integration |
| Prisma validate / generate | PASS; client 7.8.0 | — |
| Nest build / TypeScript noEmit | PASS / PASS | — |
| Full TS lint / storage+observation MJS lint | PASS / PASS | — |
| Git diff check and scope/index check | PASS | — |

**661+400+214+20+13=1308 unique cases. Baseline 1126 + new snapshot40 + audit2 + actual staff140 =1308.** Repeated subsets/reruns не добавлены к сумме. В final TAP groups fail=0 и skipped=0. Новые staff Swagger cases находятся в staff140; существующий OpenAPI gate также прошёл. Hosted CI не запускался/не проверялся, deploy-specific shell/Compose suites не выдаются за выполненные Phase 3 regression gates.

## 13. Changed Files

| Status | File | Purpose |
| --- | --- | --- |
| Modified | `.github/workflows/ci.yml` | Explicit student+staff API gate name; existing required command |
| Modified | `src/common/authorization/student-document-access.service.ts` | staff-mutate operation, own profile mutation lock, current DB policy reuse |
| Modified | `src/common/serialization/public-audit.ts` | Two explicit business allowlist actions |
| Modified | `src/common/serialization/public-audit.spec.ts` | Two privacy/allowlist regression cases |
| Modified | `src/modules/document/api/document.controller.ts` | Existing download delegates extracted same responder |
| Modified | `src/modules/document/document.module.ts` | Staff controller/guard registration |
| Modified | `src/modules/document/repository/document.repository.ts` | Scoped reads/list, metadata/archive CAS, monotonic tokens |
| Modified | `src/modules/document/service/document.service.ts` | Seven staff operations/shared persist, review lock/token |
| Modified | `test/run-student-document-storage.mjs` | Mandatory separate owned student and staff API DB suites |
| New | `src/modules/document/api/document-stream-response.ts` | Extracted shared streaming response lifecycle |
| New | `src/modules/document/api/dto/staff-document.dto.ts` | Strict staff DTO/IDs/snapshot/service validation |
| New | `src/modules/document/api/staff-document-input.interceptor.ts` | Raw params/DTO before global transform/whitelist; after Multer |
| New | `src/modules/document/api/staff-document-mutation.guard.ts` | Early staff portrait/document authorization before Multer |
| New | `src/modules/document/api/staff-document.controller.ts` | Seven scoped staff routes/OpenAPI |
| New | `src/modules/document/repository/document-snapshot.ts` | Strict snapshot assertion and monotonic timestamp |
| New | `src/modules/document/repository/document-snapshot.spec.ts` | 40 targeted cases |
| New | `test/document-staff-api.test.ts` | 140 actual HTTP/PG/MinIO cases + benchmarks |
| Modified, ignored | `docs/student-documents-phase3-staff-crud-report.md` | This final implementation/gate report |

Итого 17 implementation/source/test/CI files + 1 report. Report ignored existing docs rule, не staged. Нет изменений package/dependencies, schema/migrations, bucket configuration, ContractScanService/public UploadService, deployment, observation worker или automatic recovery design.

## 14. Findings P0–P3

Новых подтверждённых P0/P1 после implementation self-review и перечисленных gates не выявлено. Это не замена независимому Final Code Review и не доказательство отсутствия всех возможных дефектов.

| Finding / decision | Status |
| --- | --- |
| DG-3-UPLOAD Option A | APPROVED, реализовано; memory/admission production note остаётся |
| DG-3-DELETE strict first CAS / idempotent archived repeat | APPROVED WITH CONDITIONS, implemented/tested; bytes/row preserved |
| DG-3-METADATA title-only | APPROVED, implemented; protected fields rejected |
| Same-ms timestamp lost-update risk | Закрыт для participating runtime API writers без schema change |
| Raw DTO stripping / malformed route transform / inclusive multipart limits | Выявлены и исправлены в implementation, permanent regression coverage |
| F-2B1-03 P2 | Existing CI/resource/deadline infrastructure risk не закрыт |
| F-2B1-04 P2 | Existing Docker context/locality risk не закрыт |
| F-OBS-01 P2 | Observation DB capacity/scan/freshness risk не закрыт |
| F-2B2-R01 P3 | Existing unreachable download TimeoutError branch сохранён в shared responder |

Исторические reviews и rejected designs не удалены/не переписаны. Отложенные type/program metadata, restore/purge и staff submit требуют отдельного контракта; не выдаются за разрешённые операции.

## 15. Remaining Risks

**U1/U2/G1 OPEN / NOT APPROVED; automatic destructive recovery NOT APPROVED.** Phase 3 не решает exclusive producer authority U1, consumed reservation retention U2 или paused future send G1. Existing durable intents и conservative synchronous compensation не превращены в destructive recovery; нет новых workers/fences/grants/triggers/pruning. [Recovery runbook](student-documents-recovery-runbook.md), [observation final review](student-documents-phase2b3-final-review.md).

**Existing Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки.** В этом запуске exact local socket и ownership проверены внешним harness; общий runner locality defect не исправлен. Cold hosted CI, image/resource budgets/deadlines и observation production capacity остаются прежними инфраструктурными notes.

Открыты production admission/memory budget для concurrent buffered uploads; JWT-aware frontend/mobile sign-off и rollout; legacy public files/Phase 2C; deeper parsing/AV; old-version/uncertain-object retention; in-flight download revocation. Test fixtures/temporary evidence не являются deployment approval. Seed/direct DB updates не должны обходить runtime monotonic CAS при live workload. Student API shapes сохранены; изменение более точного updatedAt — необходимый concurrency token, не новая API field/schema.

## 16. Backend Commit Gate

**PASS WITH NOTES.** Все семь routes, approved gates и обязательные regression checks реализованы/проверены. Diff подготовлен для независимого Final Code Review, index пустой; commit не создан. Notes: existing infrastructure findings и deployment blockers из разделов 14–15, ограничения benchmark и hosted CI evidence. Данное implementation решение не утверждает rejected recovery architecture.

| Итоговый вопрос | Результат |
| --- | --- |
| ADMIN upload без student login? | Да, actual HTTP test, любой existing portrait |
| Assigned EXPERT upload без student login? | Да, active/current profile+assignment |
| Foreign EXPERT blocked? | Да, все routes и direct service; revocation/transfer races проверены |
| List/detail/download/new-version работают? | Да, private bytes, scoped ownership, legacy safe behavior |
| Metadata/soft-delete protected? | Да, title-only, strict CAS, audit rollback, archived repeat без второго audit |
| Новые private writers? | Нет, existing shared persist/storage/recovery |
| Новые leaks/IDOR? | В проверенных cases не выявлены; public serialization и scoped IDs сохранены |
| Unique tests прошли? | Да, 1308 =1126 baseline+182 new, без двойного счёта |
| Новые P0/P1? | Подтверждённых нет; независимый review ещё требуется |
| Готово к независимому Final Code Review? | Да, unstaged implementation/report, index пустой |

## 17. Production Deployment Gate

**NOT READY.** Passing local backend gates не закрывают inherited infrastructure/recovery/rollout blockers. U1/U2/G1 и automatic destructive recovery остаются NOT APPROVED; production capacity, client sign-off и deployment authorization отсутствуют. Production/Test не тронуты; commit/push/deploy не выполнялись. Для дальнейшего шага нужен независимый Final Code Review этого diff, затем отдельное решение пользователя о Git/deployment scope.
