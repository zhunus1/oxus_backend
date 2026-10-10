# Phase 2B-2 — Targeted Remediation F-2B2-01 / F-2B2-02

Дата: 2026-10-10, Asia/Almaty. Baseline HEAD: `4ac6cf3f6ba5de7e5d0193f4c351c0087ad531bd`. Ветка: `release/manual-contract-candidate`.

**Backend Commit Gate: PASS WITH NOTES. Production Deployment Gate: NOT READY.** Два подтверждённых findings закрыты текущим implementation и regression evidence. Изменения оставлены незакоммиченными для независимого review. Recovery worker/client download rollout не реализовывались.

## 1. Root Cause F-2B2-01

Technical `DOCUMENT_STORAGE_PENDING` сохранялся в namespace `StudentPortrait`, который читался существующим `/api/v1/expert/portraits/:id/audit-log`. Этот reader требовал только JWT, не передавал actor в service и возвращал raw AuditLog.details. Поэтому чужие STUDENT/EXPERT получали private fileKey/operationId/owner/document metadata через audit, хотя download был защищён.

Исправлены три границы: service authorization, internal journal namespace и explicit public audit projection. Старые implementation/final-review reports сохранены как исторические evidence; их файлы не переписывались.

## 2. Audit Authorization

[Controller:87](../src/modules/admin/portrait/api/portrait.controller.ts#L87) передаёт authenticated actor ID. [PortraitService:198](../src/modules/admin/portrait/service/portrait.service.ts#L198) до repository read вызывает существующий `StudentDocumentAccessService.assertPortrait(actor, portrait, "staff-read")`. Нет доверия JWT roleCode, отдельного нового RBAC механизма или проверки только в controller.

Endpoint находится в `expert/portraits`, имеет Expert - Portraits назначение и существующие staff portrait operations. Подтверждённого student self-service назначения не найдено. Поэтому выбран **staff-only contract**, без автоматического расширения self access:

| Actor | Доступ |
| --- | --- |
| ADMIN с active User/Role | К существующему портрету согласно централизованной staff-read policy |
| Назначенный активный EXPERT | К своему студенту при текущем assignment и active User/Role/profile |
| Foreign EXPERT / inactive expert | 403 |
| STUDENT / SCHOOLBOY, включая собственный портрет | 403; это не новый self-service endpoint |
| SALES_MANAGER / другие роли | 403 |
| Blocked User / deleted Role / без JWT | 401 / 403 / 401 через существующий JWT guard |

ForbiddenException от policy не превращается в generic 500: authorization выполняется перед repository error wrapper. Same JWT после transfer заново проверяет DB assignment и получает отказ прежнему expert. Строгая retroactive in-flight revocation существующих reads/review не добавлялась; сохраняется ранее описанная граница snapshot authorization.

## 3. Internal Recovery Journal Isolation

[Recovery:12](../src/modules/document/service/document-storage-recovery.service.ts#L12) определяет внутренний namespace `DocumentStorageIntent`; [begin:23](../src/modules/document/service/document-storage-recovery.service.ts#L23) создаёт новый intent только в нём. Action `DOCUMENT_STORAGE_PENDING`, key/opID/portrait/owner/document fields и durable-before-Put ordering сохранены. Schema/migrations не нужны.

[intentWhere:28](../src/modules/document/service/document-storage-recovery.service.ts#L28) связывает lookup и transitions с unique journal id, exact action, portrait entityId, supported namespace, exact fileKey/operationId и ожидаемым state. Используется в COMMITTED finalization, compensation reread, ROLLED_BACK и CLEANED updates. Последний update теперь тоже conditional, без перезаписи чужого/изменённого state.

Для старых rows разрешён **legacy namespace StudentPortrait с тем же technical action и identity**, поэтому ранее созданные PENDING intents не теряются. Нет data migration, удаления или автоматического переписывания business/legacy history. Public readers исключают legacy technical action независимо от namespace/state. Real tests подтвердили compensation и atomic COMMITTED finalization старого namespace. Raw internal reads находятся только внутри recovery service, без нового public endpoint.

Это узкое усиление journal identity/finalization, не новая state machine и не reconciler. Crash/unknown outcomes всё ещё требуют отдельно реализованного controlled recovery workflow.

## 4. Public Audit Serialization

Добавлен [shared public-audit.ts:4](../src/common/serialization/public-audit.ts#L4): положительная allowlist entity/action и action-specific detail fields. Не blacklist нескольких известных secrets. Existing portrait actions покрыты по фактическим writers: SUBSCRIPTION_UPDATE, PROCESS_STEP_CHANGE, DATA_FREEZE, ROADMAP_GENERATED/REGENERATED, EXPERT_SELECTED/ASSIGN_STUDENT/TRANSFER_STUDENT, STALE_COMMENT. Также явно описаны TargetProgram STATUS_CHANGE и Document business audit status/version/review fields.

[Select:24](../src/common/serialization/public-audit.ts#L24) выбирает только public envelope и actor id/firstname/lastname. [Mapper:41](../src/common/serialization/public-audit.ts#L41) строит новый JSON: `id/action/entityType/entityId/details/userId/createdAt/user`. Details содержат только предусмотренные scalar/null значения; nested arbitrary objects/arrays, future fields, fileKey/opID/recovery state не проходят. Обычный business actor и разрешённые assignment IDs сохраняются как часть staff business history; technical intent actor/owner/metadata не выдаются вообще.

Unknown entity/action исключаются целиком. Новые business action types требуют явного public contract прежде, чем станут видны; это intentional fail-closed boundary. Для existing business rows ничего в БД не изменяется. Null details сохраняются, date/sort order/envelope текущего audit response сохранены.

Оба найденных readers используют общий select/filter/mapper:

- [PortraitRepository:143](../src/modules/admin/portrait/repository/portrait.repository.ts#L143) — единственный найденный HTTP audit path, теперь также защищён service policy.
- [AuditLogRepository.findByEntity:20](../src/modules/audit-log/repository/audit-log.repository.ts#L20) — альтернативный generic service reader; internal namespace/unknown actions возвращают пустой public result. Current HTTP callers generic AuditLogService.findByEntity не найдены. Он не является самостоятельно авторизованным HTTP endpoint и не должен подключаться к будущему controller без policy.

Повторный поиск AuditLog/auditLogs/findByEntity/findAuditLogs по application code не выявил других public/nested raw audit readers. Mandatory AuditLog.log/write paths сохраняют полный внутренний journal/business record для consistency; API handlers не возвращают technical log result. HTTP tests проверяют exact JSON разрешённого history, отсутствие старых и новых technical entries и неизменность underlying rows.

## 5. F-2B2-02 PNG Validation

[student-document-file.ts:22](../src/common/utils/minio/student-document-file.ts#L22): chunk type decoding изменён ASCII → Latin1. Следующая строка требует четыре ASCII alphabetic tag bytes; high-bit/non-letter tags отвергаются до IHDR/IDAT/IEND recognition. Это сохраняет exact expected tags и запрещает обход через malformed дополнительный chunk.

Length/boundary/IHDR dimensions/IDAT/IEND checks сохранены. PDF/JPEG code, MIME whitelist, 10 MiB/nonempty/size equality и multipart limits не изменены. PNG decoder, CRC validation или AV не внедрялись; shallow structural validation остаётся прежней заявленной границей.

## 6. Changed Files

Remediation относительно pre-remediation snapshot: **9 existing files + 2 new source/test files + этот report = 12**. Accumulated Phase 2B-2 implementation не удалён и не откатан.

| File | Изменение / source |
| --- | --- |
| `src/modules/admin/portrait/api/portrait.controller.ts` | Actor forwarding, [87](../src/modules/admin/portrait/api/portrait.controller.ts#L87) |
| `src/modules/admin/portrait/service/portrait.service.ts` | Staff authorization, [198](../src/modules/admin/portrait/service/portrait.service.ts#L198) |
| `src/modules/admin/portrait/repository/portrait.repository.ts` | Safe history reader, [143](../src/modules/admin/portrait/repository/portrait.repository.ts#L143) |
| `src/modules/audit-log/repository/audit-log.repository.ts` | Safe alternate reader, [20](../src/modules/audit-log/repository/audit-log.repository.ts#L20) |
| NEW `src/common/serialization/public-audit.ts` | Positive public action/detail/envelope allowlist, [4](../src/common/serialization/public-audit.ts#L4) |
| NEW `src/common/serialization/public-audit.spec.ts` | Serialization/future-field/default-deny regressions, [15](../src/common/serialization/public-audit.spec.ts#L15) |
| `src/modules/document/service/document-storage-recovery.service.ts` | Internal namespace + backward-compatible identity filters, [12](../src/modules/document/service/document-storage-recovery.service.ts#L12) |
| `src/modules/document/service/document-storage-recovery.service.spec.ts` | Namespace/identity negative units, [73](../src/modules/document/service/document-storage-recovery.service.spec.ts#L73) |
| `src/common/utils/minio/student-document-file.ts` | Byte-preserving PNG tags, [22](../src/common/utils/minio/student-document-file.ts#L22) |
| `src/common/utils/minio/student-document-storage.service.spec.ts` | 24 PNG negatives, [34](../src/common/utils/minio/student-document-storage.service.spec.ts#L34) |
| `test/document-private-api.test.ts` | Real audit controller/service/repository + 19 regressions, [721](../test/document-private-api.test.ts#L721); crash fixture updated to internal namespace, [594](../test/document-private-api.test.ts#L594) |
| Этот report | Closure evidence, test results, remaining blockers |

Prisma schema/all migrations, bucket policies/config, public UploadService/MinioService, ContractScanService, contracts/payments/Lead, frontend/mobile, deployment, lockfile и CI infrastructure не менялись. DI prerequisites существовали; новых module/provider registrations не потребовалось. Prior docs и остальные source files сохранены по 681-file snapshot перед remediation.

## 7. New Regression Tests

**36 новых Jest cases:** 24 PNG + 3 recovery + 9 public serialization. PNG negatives включают все 12 high-bit mutations каждого byte IHDR/IDAT/IEND, пять truncated chunk headers, четыре boundary/CRC-tail/trailing-data cases, три MIME/size cases. Existing valid PDF/JPEG/PNG, PDF high-bit/EOF/10 MiB и storage streaming checks прошли. [PNG cases:34](../src/common/utils/minio/student-document-storage.service.spec.ts#L34).

Serialization tests проверяют explicit envelope, future root/detail/user fields, unknown/technical/prototype names, nested objects/arrays и null details. Recovery units проверяют namespace при begin, identity predicates всех reread/state updates, отказ compensation другого operation с тем же key. [serializer units:15](../src/common/serialization/public-audit.spec.ts#L15), [recovery units:73](../src/modules/document/service/document-storage-recovery.service.spec.ts#L73).

**19 новых real API cases:**

| Coverage | Cases |
| --- | --- |
| Foreign STUDENT/SCHOOLBOY/EXPERT, own STUDENT/SCHOOLBOY, SALES_MANAGER/other role denied | 7 |
| No JWT, blocked User, deleted Role, inactive profile | 4 |
| Transfer с тем же действующим JWT | 1 |
| ADMIN/assigned EXPERT exact safe JSON, new + legacy intents absent, rows preserved | 2 |
| All alternate repository readers / unknown fields / Document business audit sanitization | 1 |
| New и legacy namespace identity mismatch retain → valid compensation CLEANED | 2 |
| PENDING + archived Document reference retained | 1 |
| Legacy namespace atomic COMMITTED finalization и public isolation | 1 |

Использованы actual Nest controllers/guards/services/repositories и disposable PostgreSQL/MinIO, а не разрешающий authorization mock. JWT намеренно содержит forged ADMIN roleCode, который не даёт лишнего доступа. Denials проверяют точный JSON error, permitted history — весь точный JSON, не только отсутствие двух ключей. Existing crash-process case сохраняет строгий exit 77 после real PutObject и теперь проверяет новый namespace.

Новые критические tests входят в **существующие обязательные CI gates**: full Jest и `yarn test:documents-private-api`, [workflow:95](../.github/workflows/ci.yml#L95). Skip/optional mode не добавлялся, CI infra не менялась.

## 8. DB/MinIO Consistency Results

Real API **74/74**. Подтверждены прежние ordering/failure/concurrency scenarios плюс новые namespace/identity cases:

- Durable callback до PutObject; intent error не допускает Put и Document insertion.
- PENDING → COMMITTED атомарно с Document + mandatory business audit, включая legacy namespace.
- PENDING → ROLLED_BACK → CLEANED при доказанном callback rollback; cleanup failure сохраняет durable ROLLED_BACK.
- Lost PutObject ack/unknown COMMIT/connection-before-callback не ведут к blind delete; referenced committed bytes сохранены.
- Audit/finalization failure и CAS/review/replacement/revocation conflicts сохраняют DB/старые bytes; MinIO I/O остаётся вне transaction.
- Process exit после actual Put оставляет новый internal PENDING journal/private orphan без Document.
- Archived reference защищает даже genuinely PENDING intent, а не только COMMITTED early exit.
- Wrong operationId не читает/не изменяет journal и не удаляет object; old namespace корректно recoverable, technical history скрыта от ADMIN/EXPERT.

Unknown outcomes/crash требуют active reconciliation; safe conservative retention не превращена в обещание eventual cleanup. Current count/delete safety всё ещё зависит от fresh-key/single-writer/rollback/fencing invariants. Arbitrary direct DB writes/future worker требуют отдельного concurrency protocol.

Infrastructure: новый owned PG17/Redis7 через verified local Docker Unix socket; dynamic bindings 127.0.0.1:58967/58968. MinIO runners создавали собственные labelled containers/tmpfs/loopback ports с synthetic credentials; official fixed-source image использовал cached layers. SQL после suites подтвердил только bootstrap `oxus_review_test`/postgres, 0 public tables и отсутствие оставшихся suite DB. MinIO containers по ownership label отсутствовали; PG/Redis удалены по exact IDs после ownership checks. Global prune/чужие resources/Production/Test не использовались.

## 9. Full Test Results

| Gate | Result |
| --- | --- |
| Targeted storage/authorization/recovery/serializer Jest | PASS: **4 suites / 145 tests**, subset full Jest |
| Full Jest | PASS: **50 suites / 540 tests** |
| Real Document API + PostgreSQL/MinIO | PASS: **74** |
| Real MinIO foundation | PASS: **20** |
| Runner security probes | PASS: **13** |
| Existing standalone Document HTTP security | PASS: **80**, subset standard runner |
| Standard integration runner | PASS: **349**, 22 TAP files + plain smoke |
| Swagger/OpenAPI / migration cases | PASS внутри standard suite: 12 / 4, без повторного добавления |
| Prisma validate / generate | PASS: synthetic localhost config, dotenv /dev/null, Prisma client 7.8.0 |
| Nest build / TypeScript --noEmit | PASS |
| TS lint / MJS lint / node --check | PASS |
| Git tracked/untracked/report whitespace, scope, HEAD/index | PASS |

**996 уникальных repository cases = 540 + 349 + 74 + 20 + 13.** Remediation добавляет **55** к прежним 941: 36 Jest + 19 HTTP/real API. Targeted/standalone повторения, OpenAPI/migration subsets и предыдущие 11 temporary review probes не добавлены. Final TAP fail/skipped/cancelled/todo = 0.

Промежуточные ошибки не скрыты: ранний tsc пересёкся с Prisma generate и временно не нашёл browser client; после завершения generate проверка повторена последовательно и прошла. При добавлении controller harness ошибочная широкая test-text replacement попала во встроенный crash subprocess script, вызвав `klass is not defined`/exit 78. Диагностика stderr добавлена, script исправлен, strict exit/bytes/journal assertions сохранены; final full real API run прошёл 74/74. Это исправление test setup, не ослабление gate. Intentional fault-injection warnings и Superagent late-response warning сохраняются.

Evidence: `/private/tmp/oxus-phase2b2-remediation-{targeted,jest,private-api,minio,runner,document-http,integration,validate,generate,build,typescript,lint,mjs-lint}.txt`; initial crash failure сохранён отдельно `oxus-phase2b2-remediation-private-api-initial-failure.txt`. Scope snapshot: `/private/tmp/oxus-phase2b2-remediation-baseline.json`.

## 10. Remaining Risks

1. **B-2B2-RECOVERY OPEN:** отсутствуют active per-intent reconciler, backlog monitoring и tested operational runbook. Journal identity/state fence — foundation, не worker. Unknown Put/COMMIT/crash/cleanup failures могут оставлять private orphan objects.
2. **B-2B2-CLIENT OPEN:** frontend/mobile JWT binary download sign-off/e2e отсутствуют; relative locator требует корректного origin resolution и явной передачи credentials. Код клиентов не изменялся.
3. **F-2B1-03 OPEN:** cold hosted CI/network/build/resource/deadline budget не подтверждён warm local tests, mutable base tags и resource bounds не исправлялись.
4. **F-2B1-04 OPEN:** runner по-прежнему не проверяет arbitrary Docker daemon locality. **Нельзя считать Docker runner безопасным для произвольного удалённого Docker context без дополнительной проверки.** Эта сессия использовала явно проверенный local Unix socket.
5. Existing legacy public files/old private versions, shallow file validator без full decoder/AV, strict in-flight revocation и aggregate upload/resource/retention budgets остаются отдельными ранее описанными границами.
6. Public audit action/detail allowlist требует явного сопровождения новых business actions. Old/unknown technical rows не удаляются и не выдаются. Generic service reader не заменяет authorization будущего HTTP controller; текущий HTTP path защищён.

## 11. Backend Commit Gate

**PASS WITH NOTES.** F-2B2-01 закрыт staff authorization + internal namespace + положительной safe serialization обоих readers; F-2B2-02 закрыт byte-preserving PNG tags и negative regressions. Новых подтверждённых P0/P1 при remediation self-check не выявлено. Можно подготовить отдельный Phase 2B-2 backend commit после предусмотренного пользователем independent review текущего diff; этот отчёт не заменяет такой review и не создаёт commit автоматически.

HEAD остаётся baseline, локальный upstream ref без divergence, index пуст. Accumulated implementation сохранён. Изменения незакоммичены. Reports локальные/ignored существующим `/docs` правилом; ignore/index не менялись. Worker, Staff CRUD, Phase 2C, server bucket changes, commit/push/deploy не выполнялись.

## 12. Production Deployment Gate

**NOT READY.** До production нужны active controlled reconciliation + monitoring/runbook/retention, client JWT download implementation/sign-off/e2e, controlled CI/locality/runtime budget verification и отдельный rollout review. Production/Test не подключались.

| Вопрос | Итог |
| --- | --- |
| Закрыт P1? | Да в текущем implementation; foreign actors отказ, authorized readers не получают technical entries |
| Recovery metadata раскрываются? | Нет в найденных public/alternate readers, включая old namespace; проверен exact JSON и future fields |
| Обычный audit сохранён? | Да для явного business allowlist/envelope; DB rows не изменены; staff-only authorization согласована с назначением endpoint |
| PNG validator исправлен? | Да; все 12 high-bit tag mutations и boundary/MIME/size regressions отвергаются |
| Сколько прошло? | **996 уникальных repository cases** и остальные требуемые локальные gates |
| Остались P0/P1? | Новых подтверждённых нет; два findings remediated, independent review текущего diff ещё впереди |
| Можно отдельный commit? | Backend PASS WITH NOTES, готов к independent review/отдельному commit после него; index пуст, commit не создавался |
| Blockers до Production? | B-2B2-RECOVERY/B-2B2-CLIENT + controlled infrastructure/runtime verification; Deployment NOT READY |
