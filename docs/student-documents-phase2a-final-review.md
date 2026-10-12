# Student Documents Phase 2A — Final Independent Review

Дата: 09.10.2026. Проверен фактический working tree поверх Phase 1 commit `6648f7b423eaf5b2d75deabd71a2321b5db63258`.

## 1. Executive Summary

**Итог: PASS WITH NOTES. Phase 2A готова к отдельному коммиту. Подтверждённых P0/P1 нет.**

Проверены application diff, все найденные обращения к Document, вложенные API responses, новая миграция, authorization/CAS/audit и качество тестов. Заявленные результаты повторены независимо: **713 уникальных tests passed, 0 failed, 0 skipped** в окончательных прогонах. Prisma validate/generate, build, полный lint, дополнительный `tsc --noEmit` и diff-check завершились с exit 0.

Найдены два неблокирующих P2-замечания: текущая SQL-сортировка не устраняется новым индексом на проверенном PostgreSQL 16; новые migration tests не подключены к штатному CI. Второй пункт также выявил унаследованное отсутствие Document HTTP suite в основном integration runner. Подробные finding cards находятся в разделе 9.

Добавление двух nullable колонок не меняет старые значения/constraints. Все найденные публичные Document projections исключают `fileKey`, `deletedAt` и автоматически добавляемые будущие колонки. Архивы исключаются в SQL; archive-vs-write конфликты дают 409 и не повреждают строку. Две дополнительные пробы подтвердили ранее описанную границу archive-vs-read/list: уже прочитанный снимок может попасть в ответ, следующий запрос после archive commit исключает строку.

Изучены [implementation report](student-documents-phase2a-implementation-report.md), [Phase 1 remediation report](student-documents-phase1-remediation-report.md) и [design review](student-documents-crud-design-review.md). Старый design используется как проектный контекст, а не описание текущих исправленных guards. Выводы о текущем поведении основаны на исходниках и новых прогонах.

Это gate подготовительной Phase 2A. Приватность реальных файлов, staff upload/CRUD и совместимость authenticated download с клиентами ещё не реализованы/не доказаны. Production/Test и MinIO не опрашивались. Commit/push/deploy и Git mutations не выполнялись. Единственный созданный файл репозитория в этом review — данный отчёт; application code, schema, migrations, tests и предыдущие отчёты сохранены.

## 2. Git Diff Inventory

Ветка: `release/manual-contract-candidate`. HEAD: `6648f7b423eaf5b2d75deabd71a2321b5db63258`, subject `fix(documents): enforce ownership and harden document security`. Staged diff пуст. Локальное отображение upstream проверено без fetch; актуальность remote refs не утверждается.

Полный inventory относительно baseline:

| Статус | Файл | Назначение |
|---|---|---|
| M | [admin.service.ts:236](../src/modules/admin/admin.service.ts#L236) | Active filter/public select в CRM include |
| M | [portrait.repository.ts:86](../src/modules/admin/portrait/repository/portrait.repository.ts#L86) | Два уровня document relations в full portrait |
| M | [document.entity.ts:18](../src/modules/document/api/dto/document.entity.ts#L18) | Allowlist constructor, тип существующего статуса |
| M | [document.repository.ts:8](../src/modules/document/repository/document.repository.ts#L8) | Public select, active reads и CAS |
| M | [document.service.ts:48](../src/modules/document/service/document.service.ts#L48) | Explicit mapper и transaction projections |
| M | [expert-dashboard.repository.ts:50](../src/modules/expert-dashboard/repository/expert-dashboard.repository.ts#L50) | Active filter, прежний fragment |
| M | [program-requirement.repository.ts:70](../src/modules/program-requirement/repository/program-requirement.repository.ts#L70) | Active/owner filters и narrow select |
| M | [target-program.repository.ts:13](../src/modules/target-program/repository/target-program.repository.ts#L13) | Shared nested public include |
| M | [schema.prisma:638](../src/prisma/schema.prisma#L638) | Только две колонки Document и индекс |
| M | [document-security-http.test.ts:76](../test/document-security-http.test.ts#L76) | Contract assertions и 12 новых scenarios |
| M | [run-document-security.mjs:19](../test/run-document-security.mjs#L19) | migrate deploy вместо db push |
| ?? | [public-document.ts:3](../src/common/serialization/public-document.ts#L3) | Общий select/type и explicit mapper |
| ?? | [public-document.spec.ts:4](../src/common/serialization/public-document.spec.ts#L4) | Три serialization unit tests |
| ?? | [migration.sql:2](../src/prisma/migrations/20261009120000_document_private_fields/migration.sql#L2) | Единственная новая additive migration |
| ?? | [document-schema-migration.test.ts:110](../test/document-schema-migration.test.ts#L110) | Четыре data/catalog/history/drift checks |

Итого 11 modified tracked + 4 untracked source/test/migration files. Tracked diff: 261 insertions / 27 deletions; этот stat не включает содержимое четырёх новых файлов. Сравнение исходного и итогового inventory, а также SHA-256 fingerprints этих файлов и существующих student-documents reports подтвердило отсутствие изменений со стороны review.

Не изменены: package.json, yarn.lock, .gitignore, Dockerfile, compose.yaml, deployment, MinIO utilities, contract/billing/lead application code, authorization policy, auth guards и audit service. Все 44 historical migration.sql и migration_lock.toml побайтно совпадают с baseline. Generated client/dist обновлены штатными generate/build и остаются ignored.

Tracked/untracked diff прочитан, выполнен поиск private-key/AWS-key/GitHub-token/literal-credential/external-DB indicators. Реальных credentials, PII или случайных временных файлов в проверяемом наборе не обнаружено. Фикстуры используют synthetic names, example.test URLs/emails и test-only values; JWT secret генерируется случайно. Содержимое .env не выводилось. Исходные server credentials не использовались.

Каталог `/docs` игнорируется существующим .gitignore:85; новый review report не появляется в обычном status. Implementation report также ignored, remediation report уже tracked в baseline. Отчёты не добавлялись в index. Решение, какие два Phase 2A reports включить в будущий commit, остаётся отдельным Git действием; другие локальные отчёты автоматически включать не следует.

## 3. Prisma Migration Review

[Новая migration.sql:2](../src/prisma/migrations/20261009120000_document_private_fields/migration.sql#L2):

```sql
ALTER TABLE "Document" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "fileKey" TEXT;

CREATE INDEX "Document_studentPortraitId_deletedAt_updatedAt_idx"
ON "Document"("studentPortraitId", "deletedAt", "updatedAt");
```

В schema это `fileKey String?`, `deletedAt DateTime?` и один `@@index`. Нет DEFAULT/NOT NULL, backfill, UPDATE/DELETE/DROP/TRUNCATE, enum изменений, смены FK/defaults или копирования файлов. Nullable ADD COLUMN без default не требует заполнения старых строк. До Phase 2A у Document был только PK; новый secondary index не дублирует существующий индекс из repository history.

Повторно выполнен [migration suite:52](../test/document-schema-migration.test.ts#L52) на собственной UUID database:

| Проверка | Независимый результат |
|---|---|
| Baseline | Успешно применены 44 historical migrations; Document имеет 11 колонок |
| Старые данные | До нового deploy вставлены PASSPORT/APPROVED и TRANSCRIPT/NEEDS_REVISION; разные version, nullable program link, заданные dates/feedback |
| Новый deploy | Новая migration применена поверх history, exit 0 |
| Сохранность | Все 11 прежних значений обеих строк полностью равны исходным, включая dates, URL, owner и program link |
| Новые поля | NULL у обеих строк; types/nullability/defaults проверены через catalog |
| Constraints | Имена и определения PK/FK до/после равны |
| Index | Один ожидаемый индекс, точный набор трёх колонок |
| Повторный deploy | No pending migrations; data unchanged; ровно одна finished запись новой migration |
| Drift | migrate diff datasource → current schema, exit 0 |

Кроме специального migration suite, штатный integration runner успешно применил все 45 migrations и проверил отсутствие drift в каждой из 20 новых database. HTTP runner также использовал migrate deploy. db push/reset/dev не использовались. Baseline fixture готовится во временной копии migrations; historical repository files не редактируются.

**DDL/операционные ограничения.** ALTER TABLE требует ACCESS EXCLUSIVE lock; он может ждать даже долгую читающую транзакцию. Обычный CREATE INDEX без CONCURRENTLY допускает чтение, но блокирует writes во время построения. Скрипт не содержит explicit BEGIN/COMMIT; не следует считать два statements атомарным пользовательским rollout. При неуспехе после ADD COLUMN возможна partial migration, требующая проверки фактического состояния и согласованного Prisma recovery, а не слепого повторного запуска raw SQL.

Для двух строк, сообщённых пользователем для каждого сервера, объём построения индекса ожидается небольшим; наличие blocker transactions, server history/checksums, реальное текущее количество строк и продолжительность locks этим review не измерены. Перед разрешённым server deployment нужны проверка migration history/drift, оценка blockers и ограниченное окно применения с bounded lock wait. Это безопасная по данным additive migration, **не обещание zero-downtime**. Новый Prisma Client должен запускаться после добавления колонок: его active queries обращаются к deletedAt.

Down migration не добавлена. Drop новых колонок после их использования уничтожит key/archive информацию. Предпочтителен roll-forward. Важно уточнение к implementation report: согласованный старый Phase 1 artifact со своим старым generated client знает только прежние поля; утечку новых колонок через него нельзя автоматически заключать из одного наличия колонок в БД. При этом старый код точно не фильтрует архивы; комбинация старых raw-return readers с новым generated client уже способна раскрыть новые поля. [Dockerfile:23](../Dockerfile#L23) генерирует client при сборке и переносит его вместе с приложением. Возврат к старому artifact после появления archive/private state требует отдельной проверки, а не безусловного rollback обещания.

## 4. Serialization Security Review

Поиск выполнен по всему `src`: Document delegate calls, document relations, DTO/entity, fileUrl, raw/spread returns, raw SQL, class-transformer и audit/error paths. Production API delegates находятся только в DocumentRepository, DocumentService.review и RequirementsRepository; остальные API читают nested relations ниже. Найденный дополнительный delegate в expert.seed.ts — внутренний demo seed, не HTTP reader.

[PUBLIC_DOCUMENT_SELECT:3](../src/common/serialization/public-document.ts#L3) разрешает ровно:

`id`, `title`, `fileUrl`, `documentType`, `version`, `status`, `feedback`, `studentPortraitId`, `targetProgramId`, `createdAt`, `updatedAt`.

[toPublicDocument:21](../src/common/serialization/public-document.ts#L21) строит новый объект с этими 11 значениями, без spread/blacklist. Date остаётся Date до JSON serialization; nullable values не меняются. Unit test передаёт populated fileKey, deletedAt, неизвестное futureInternalField и relation — ни одно не попадает в результат. Partial DocumentEntity construction сохраняет прежний JSON с отсутствующими undefined полями; constructor теперь копирует только mapper output, [document.entity.ts:19](../src/modules/document/api/dto/document.entity.ts#L19).

| API/return path | Query boundary / response boundary | Результат |
|---|---|---|
| POST documents | Repository create select + service mapper | 11 полей |
| GET documents/me | Owner/active findMany select + map | Массив 11-field объектов |
| GET documents/:id | Active findUnique select + mapper после policy | 11 полей |
| PATCH new-version / submit | CAS update select + mapper | 11 полей |
| PATCH review | tx read/update select + mapper перед transaction return | 11 полей |
| Admin CRM | [include:236](../src/modules/admin/admin.service.ts#L236) + [старый map:349](../src/modules/admin/admin.service.ts#L349) | Ровно 9 полей, без owner IDs |
| Full portrait root documents | [portrait.repository.ts:101](../src/modules/admin/portrait/repository/portrait.repository.ts#L101) | Active relation + public select |
| Full portrait targetPrograms.documents | [portrait.repository.ts:97](../src/modules/admin/portrait/repository/portrait.repository.ts#L97) | Owner/active + public select |
| TargetProgram create/list/detail/update | [includeForPortrait:14](../src/modules/target-program/repository/target-program.repository.ts#L14), используется всеми четырьмя путями | Owner/active + public select |
| Expert kanban/stale | [studentInclude:50](../src/modules/expert-dashboard/repository/expert-dashboard.repository.ts#L50) | Прежние 6 document fields |
| Requirements-status | [select:74](../src/modules/program-requirement/repository/program-requirement.repository.ts#L74) + [service map:99](../src/modules/program-requirement/service/program-requirement.service.ts#L99) | Select 4 полей; прежний requirement summary |

TargetProgramService возвращает raw *program* object, но его documents уже ограничены select. DashboardService распространяет student/program objects при расчёте deadlines, но document fragment определяется query select; dashboard targetPrograms не включают documents. Ни один найденный spread не обходит Document projection. Generic portrait CRUD/KYC/subscription и expert student summary не включают документы. Account/Auth ClassSerializerInterceptor относится к другим controllers; Document гарантия не зависит от exclude decorators.

Review audit содержит только fromStatus/toStatus и optional feedback, [document.service.ts:147](../src/modules/document/service/document.service.ts#L147), а не Document row. Его результат не возвращается вместо документа. User journey получает explicit documentId/type/title/targetProgramId. Audit readers не подгружают Document relation; новые поля туда не копируются. Document catches возвращают обычные HTTP exceptions с фиксированными messages, без raw Prisma payload; denied/error-only shapes подтверждены старым HTTP regression.

Prisma explicit select защищает nested readers также при добавлении будущей внутренней колонки: default scalar selection здесь не используется. Future-property unit test доказывает дополнительную защиту direct mapper; это не заявление о выполненной миграции произвольной будущей колонки или о real storage privacy. User.deletedAt/Contract.scanFileKey принадлежат другим моделям и не должны ошибочно интерпретироваться как Document leaks. Обнаруженных утечек внутренних Document fields в рассмотренных API нет.

## 5. Soft Delete & Concurrency

В SQL всех application Document readers присутствует `deletedAt: null`: direct list/detail, CRM, оба full-portrait nesting levels, dashboard, target-program nesting и requirements. Сохранились owner/target predicates Phase 1. Mislinked document другого портрета не становится доступным через targetProgramId.

Уполномоченный actor получает 404 для archived direct document, review, replacement и submit; upload/audit не вызываются, строка остаётся неизменной. Guard/RBAC выполняются в обычном порядке, поэтому denied role может получить 403 раньше document lookup. Новой DELETE/restore/archive API нет: deletedAt устанавливается напрямую только в disposable fixtures.

| Гонка | Сохранённая защита | Фактическая проверка |
|---|---|---|
| Archive во время replacement upload | [updateVersion CAS:26](../src/modules/document/repository/document.repository.ts#L26) с deletedAt=null и snapshot fields | HTTP 409, archived row unchanged |
| Archive перед submit write | [updateStatus CAS:34](../src/modules/document/repository/document.repository.ts#L34) | HTTP 409, row unchanged |
| Archive после review tx snapshot | [active tx read:133](../src/modules/document/service/document.service.ts#L133), [update predicate:138](../src/modules/document/service/document.service.ts#L138), Serializable | HTTP 409, row unchanged, audit count 0 |
| Two reviews / review vs replacement | Прежние version/updatedAt/status/fileUrl predicates, tx audit и conflict mapping | Старые HTTP race scenarios по-прежнему PASS |
| Archive после detail SQL read | Response использует уже полученный объект | Дополнительная service/real-DB probe: in-flight public snapshot; следующий read 404 |
| Archive после list SQL read | Уже полученный список маппится без повторного DB read | Дополнительная probe: in-flight snapshot; в следующем list archived ID отсутствует |

Две последние пробы вызвали реальные built DocumentService/Repository и StudentDocumentAccessService, архивировали строку отдельным PostgreSQL client между SQL read и возвратом, затем проверили следующий вызов. Это service-level probes, не новые HTTP tests; они не включены в число 713. При такой гонке fileKey/deletedAt всё равно не возвращаются. Новые запросы после commit не видят архив. Для строгой отмены любого уже начавшегося чтения нужен другой согласованный протокол; он здесь не заявлен.

Review update + AuditLog остаются одной короткой Serializable transaction без storage I/O. P2025/P2034 → 409; прочие unexpected errors → 500; retries не добавлены. Проверены audit-stage P2034 и P2003 после реального SQL INSERT: rollback Document и audit, один вызов без retry. Старые actor/assignment/role in-flight revocation ограничения Phase 1 остаются отдельным residual: Serializable snapshot не является универсальным lock-протоколом ревокации.

## 6. API Compatibility

Шесть Document endpoints сохраняют paths/request formats и успешные статусы: upload 201, GET и PATCH 200; GET /documents/me — массив. Полные ответы сохраняют прежние 11 fields/types/nullability/timestamps. CRM остаётся `detail.portrait.documents` из 9 полей; dashboard — 6 полей. Requirements-status и nested TargetProgram shapes не расширены. DocumentEntity status typing не меняет сам набор допустимых runtime значений.

Преднамеренное новое поведение — исключение архивов и отказ/409 при stale writes, а не изменение active-document success contract. Изменения DTO/controller validation/HTTP routes отсутствуют. `fileUrl` остаётся прежней строкой с legacy semantics, fileKey никак не переключает способ скачивания.

Повторно пройдены STUDENT/SCHOOLBOY ownership, assigned/foreign/inactive EXPERT, ADMIN, forged ADMIN claim у SALES_MANAGER, disabled User, deleted Role и restoration с тем же JWT, requirements IDOR и mislinked nested documents. Current DB role по-прежнему имеет приоритет над JWT roleCode. Admin CRM защищён production JwtAuthGuard + RolesGuard; произвольный внутренний вызов AdminService без этих guards не объявляется защищённым HTTP boundary.

Actual controllers/services/repositories/guards используются в Document HTTP suite; guard override подставляет экземпляры настоящих guards, а не always-allow функцию. Остались известные fixture boundaries: StudentPortraitService.findMe заменён простым lookup, неиспользуемые auth signup/finance/realtime dependencies inert, upload fake. Production missing-portrait semantics, полный AppModule, реальные cookie/mobile viewers и файлы этим suite не доказываются.

## 7. Performance & Index Review

Индекс подходит фильтру owner + active: обе первые колонки используются в Index Cond. Direct id lookup/CAS по-прежнему используют уникальный id/PK и дополнительные predicates. Индекс не дублирует PK; third key подготавливает сортировку, но не даёт безусловной гарантии устранения Sort.

На новой migrated PostgreSQL 16 database создано 100 synthetic owners × 200 документов, 20% архивов; вместе с двумя archived race fixtures 20 002 строки. ANALYZE выполнен, planner settings для измерений оставлены стандартными. Выбраны прежние 11 public columns, owner has 160 active documents.

| SQL | Наблюдавшийся plan | Actual rows / время одного контрольного прогона |
|---|---|---|
| Текущий WHERE owner + deletedAt IS NULL, ORDER BY updatedAt DESC | Forward Index Scan по новому индексу → quicksort | 160 / 0.112 ms |
| Тот же SQL, LIMIT 20 (future diagnostic) | Forward Index Scan 160 rows → top-N Sort → Limit | 20 returned / 0.102 ms |
| Diagnostic ORDER BY deletedAt DESC, updatedAt DESC, LIMIT 20 | Backward Index Scan → Limit, без Sort | 20 scanned / 0.028 ms |

Дополнительный EXPLAIN с enable_sort=off для исходного ORDER BY всё равно содержит Sort с высокой penalty cost. Это указывает на отсутствие подходящего распознанного ordering path для текущего запроса в проверенной версии: `deletedAt IS NULL` используется как index condition, но здесь не снимает промежуточный pathkey для ORDER BY только updatedAt. Actual query/order/index в репозитории не изменялись. Диагностический ORDER BY не внедрён в application code.

**Ответ о backward scan:** технически возможен и подтверждён для ordering, совпадающего с suffix индекса; для текущего SQL его нельзя обещать без отдельного Sort. F-2A-01 ниже корректирует более сильную формулировку implementation report. Эти sub-millisecond числа — synthetic cached single-run evidence, не benchmark production и не гарантия скорости на большом количестве документов одного владельца.

`id` пока не нужен для существующего непагинированного списка. При будущем cursor pagination потребуются deterministic `updatedAt DESC, id DESC` и соответствующая оценка index/query; просто добавить id в индекс без изменения ORDER BY недостаточно. Partial active index или явное совместимое ordering можно рассматривать после измерений, не добавлять спекулятивно в этом review.

Новых N+1 или application DB round trips в diff нет: меняются select/where в существующих calls, shared mapper выполняет только O(number of returned documents) присваивания. Nested ORM relations остаются batched relation queries; не вводится per-document fetch. CRM уже имел mapper, dashboard уже имел narrow fragment. Требования `.find` по списку и отсутствие document pagination унаследованы; large nested payload refactor здесь не выполнялся. Уникальные create/update selections также не добавляют отдельного повторного чтения в сервисе.

## 8. Test Coverage Assessment

Все результаты ниже получены в данном review, после generate/build, без пересборки dist во время HTTP/regression suites. PostgreSQL/Redis запускались только в собственных disposable localhost containers. Каждый runner владеет UUID databases и удаляет их в finally.

| Проверка | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Full Jest, 46 suites | 412 | 0 | 0 |
| Document HTTP runner | 80 | 0 | 0 |
| Integration runner, 19 node:test suites | 217 | 0 | 0 |
| Dedicated migration suite | 4 | 0 | 0 |
| **Уникальный итог** | **713** | **0** | **0** |

Targeted serialization/policy/auth-guard/audit Jest: **34/34**, часть full Jest и повторно не суммируется. Sales/expert smoke: exit 0, **11 scenarios**, не node:test count и не прибавлен к 713. Две controlled read/list probes и EXPLAIN также отдельно, без искусственного увеличения test count. Cancelled/todo в финальных node suites отсутствуют.

Штатный regression runner фактически прошёл все 20 файлов; последний — smoke:

| Suite | Passed |
|---|---:|
| phase4-reporting | 12 |
| openapi-contract | 10 |
| phase3-production-blockers | 17 |
| admin-expert-profile | 12 |
| phase1-contract-security | 34 |
| phase2-reporting | 18 |
| phase2-journey-migration | 1 |
| manual-contract-http | 11 |
| sales-contract-reliability | 12 |
| sales-expert-v2-http | 9 |
| expert-lead-visibility-http | 6 |
| sales-expert-v2-regression | 40 |
| lead-call-notifications | 9 |
| lead-status-migration | 1 |
| lead-source-migration | 1 |
| country-migration | 3 |
| express-lead-http | 14 |
| manual-lead-metrics-http | 6 |
| sales-expert-demo | 1 |

Prisma validate/generate, Nest build, ESLint `{src,apps,libs,test}/**/*.ts`, TypeScript `--noEmit`, `git diff --check` и `git diff --cached --check`: exit 0. Lint/TypeScript output пустой. Cached check относится к пустому index; untracked files прочитаны отдельно, поскольку обычный diff их не включает.

**Качество новых тестов.** Три unit tests проверяют values/null/date/partial compatibility и неизвестные свойства, а не только отсутствие двух текущих keys. 12 новых HTTP tests заполняют fileKey, проверяют all six returns, четыре archived operations без I/O/audit, оба nesting levels, mislinked documents, CRM/dashboard exact fragments, SCHOOLBOY, archived requirements, program creation и три archive write races. Nested test требует реального присутствия fixture в stale/kanban, поэтому отсутствие всего результата не даёт ложного PASS. Requirements fixture делает archived row новее active, проверяя именно SQL archive exclusion. Migration tests проверяют полный старый row и PK/FK, реальный deploy/history/no-op/drift, не подменяют миграцию db push.

Есть ограничения assertions: helper `assertNoInternalFields` распознаёт document-like objects по documentType и проверяет две текущие internal keys; future-field HTTP guard этим helper отдельно не моделируется. На actual nested paths дополнительно проверены exact full/fragment keys и explicit query selects; future-property mapper покрыт unit test. Program-create docs пусты, поэтому там real select проверен также code review. Это не обнаруженный runtime leak. Две list/detail race probes пока только локальные артефакты, не сохранённые repository tests.

История повторов: первичная migration/probe попытка без local-network permission не смогла подключиться из sandbox; успешные прогоны выполнены с разрешением, адрес остался localhost. Первоначальный targeted invocation содержал неверный путь guard spec и выполнил только 26 tests/3 suites; исправленный invocation выполнил 34/4 и подтверждён full Jest. Исходники для преодоления этих ограничений не менялись.

Артефакты: `/private/tmp/oxus-document-phase2a-review-{targeted,unit,http,migration,integration,lint,typescript}.txt`, `oxus-document-phase2a-review-integration-summary.json`, `oxus-document-phase2a-review-probe.{cjs,json,txt}` и fingerprints JSON. Они не добавлены в repository. Перед cleanup подтверждено отсутствие оставшихся suite/probe UUID databases; оба собственных контейнера удалены вместе с тестовыми данными.

## 9. Remaining Risks

### Findings Phase 2A

#### F-2A-01 — P2: индекс не устраняет Sort текущего списка

- **Место:** [schema.prisma:658](../src/prisma/schema.prisma#L658), [document.repository.ts:15](../src/modules/document/repository/document.repository.ts#L15); относящаяся формулировка [implementation report:198](student-documents-phase2a-implementation-report.md#L198).
- **Характер:** подтверждено EXPLAIN на disposable PostgreSQL 16; production impact потенциальный, не измерен.
- **Описание/воспроизведение:** owner + deletedAt IS NULL + ORDER BY updatedAt DESC с новым индексом даёт Forward Index Scan → Sort; LIMIT 20 всё равно сканирует 160 active rows и сортирует. Matching diagnostic ordering даёт Backward Index Scan без Sort.
- **Влияние:** результат корректен, filtering ускоряется, но дополнительные CPU/memory и scanning остаются при будущем большом объёме/cursor pagination. Текущий объём двух server rows со слов пользователя не делает этот пункт release blocker.
- **Минимальная мера:** считать индекс filtering index без обещания sort elimination, что зафиксировано этим report. При внедрении bounded stable pagination измерить совместимое ordering/active partial index и id tie-breaker; application/migration изменения сейчас не требуются.

#### F-2A-02 — P2: dedicated Document checks не входят в штатный CI

- **Место:** [test/run-integration.mjs:10](../test/run-integration.mjs#L10), [run-document-security.mjs:18](../test/run-document-security.mjs#L18), [CI:91](../.github/workflows/ci.yml#L91), [package.json:31](../package.json#L31).
- **Характер:** подтверждённый coverage/integration gap, не воспроизведённый application defect.
- **Описание/воспроизведение:** CI вызывает Jest + build + test:integration. Jest обнаруживает только src/*.spec.ts, integration runner перечисляет 20 файлов без document-schema-migration.test.ts и document-security-http.test.ts. Отдельный document runner запускает только HTTP. Следовательно, новый 4-test migration suite и 12 новых HTTP scenarios не проверяются штатным CI автоматически; отсутствие старых 68 Document HTTP scenarios в этом CI — унаследованный Phase 1 gap.
- **Влияние:** успешный CI в дальнейшем не доказывает эти document-specific guarantees. Все dedicated checks для текущей рабочей копии независимо выполнены вручную и прошли, поэтому текущий commit не блокируется.
- **Минимальная мера:** отдельной разрешённой задачей включить оба existing dedicated invocations после build в CI/общий runner с сохранением disposable DB lifecycle. До этого включать их явно в document release checklist. CI/package/runner изменения в этом audit запрещены и не сделаны.

Новых подтверждённых P0/P1, потери данных, authorization bypass, raw Document leaks или нарушений active API contract не найдено. Косметические P3 не выделяются как обязательная доработка.

### Отдельно: известные ограничения Phase 1 / будущей Phase 2B

| Residual | Характер / источник / сценарий | Влияние и необходимый следующий шаг |
|---|---|---|
| Public legacy storage | Подтверждено ранее предоставленной пользователем policy, в этом review не опрашивалось; [minio.service.ts:57](../src/common/utils/minio/minio.service.ts#L57), [return URL:94](../src/common/utils/minio/minio.service.ts#L94). Известный URL можно читать по public policy даже после metadata archive | Серьёзная известная privacy проблема общего проекта, вне gate подготовительной 2A. Private bucket + authorized download + согласованный legacy transfer; real anonymous GET ещё нужен |
| In-flight actor/assignment revocation | Принято в Phase 1 remediation; [policy:11](../src/common/authorization/student-document-access.service.ts#L11), [review tx:131](../src/modules/document/service/document.service.ts#L131). Transfer/role block после snapshot не отменяет уже начавшийся запрос | Следующий запрос закрыт; strict revocation, если требуется, нуждается в общем mutation/lock protocol. Повторно эти три Phase 1 revocation probes не запускались |
| In-flight archive reads | Подтверждено двумя новыми probes; [detail:68](../src/modules/document/service/document.service.ts#L68), [list:59](../src/modules/document/service/document.service.ts#L59). Archive после SQL read | Старый public snapshot возможен; следующий запрос скрывает строку. Не обещать отмену уже начавшегося чтения или скачивания |
| Upload orphan / collision / validation | Потенциальный известный storage риск, storage не вызывалось; [upload.service.ts:20](../src/common/utils/minio/upload.service.ts#L20), [filename:30](../src/common/utils/minio/upload.service.ts#L30), [replacement:92](../src/modules/document/service/document.service.ts#L92). Upload successful → DB CAS fails; Date.now+same name | В 2B immutable UUID keys, input limits/magic bytes, cleanup intent/reconciliation с защитой ambiguous commits и in-flight objects |
| No key lifecycle | Подтверждённая граница этапа; [repo update:27](../src/modules/document/repository/document.repository.ts#L27). Non-null synthetic key + legacy replacement сохраняет старый key | Пока приложение не пишет/не читает ключ как storage locator. В 2B обязательно атомарно менять key вместе с version/URL/status; нынешний synthetic test не доказывает safe private replacement |
| Parent hard-delete/seed | Унаследовано; [schema.prisma:649](../src/prisma/schema.prisma#L649), [expert.seed.ts:160](../src/prisma/seed/expert.seed.ts#L160). Parent CASCADE удаляет строки; demo seed может обновить archived fixture без active filter | Document soft-delete не является retention protection от всех admin/seed operations. Seed не запускался, не публичный reader; future purge/seed lifecycle отдельно согласовать |
| Runtime/storage/client coverage | Подтверждённое отсутствие прогона; [HTTP fake upload:63](../test/document-security-http.test.ts#L63) | Реальный MinIO, anonymous deny, download headers/stream, mobile viewer и полный AppModule остаются обязательными следующими проверками |

Эти residuals не переобозначаются как вновь внесённые Phase 2A P1. Если gate трактовать как готовность всей функции хранения паспортов, он был бы отрицательным из-за незавершённой приватности. Здесь оценён только явно согласованный schema/serialization/filtering этап.

## 10. Phase 2B Readiness

**Архитектурная основа достаточна.** Nullable key сохраняет legacy rows без backfill; API projections отделены от внутренней модели, active filtering и CAS подготовлены; существующая shared access policy переиспользуема для authenticated download. Переписывать таблицу или вводить новый contract/payment/lead flow не требуется.

Следующий этап должен отдельно реализовать и проверить:

1. Private student-documents bucket на существующем MinIO. General bucket/prefix с anonymous GetObject непригоден для новых private файлов. Contract scan implementation можно использовать как ориентир, не менять сам contract flow и не считать контрактный bucket проверенным этим audit.
2. UUID immutable keys без имени/PII в object key; key трактуется только в заранее заданном private bucket. Не включать fileKey в PUBLIC_DOCUMENT_SELECT ради server-side download: это снова откроет nested leaks. Нужен отдельный focused internal projection/type и явное public mapping перед HTTP return.
3. Private upload и authorized file endpoint по Document ID с active/ownership/current-role checks до S3 I/O. fileUrl остаётся строкой публичного контракта, но должен отдавать согласованный backend download URL для private mode, без сырого internal locator. Legacy URLs нельзя произвольно скачивать HTTP-клиентом: необходим allowlisted locator mapping, без SSRF.
4. Replacement snapshot с internal fileKey; atomic key/URL/version/status/feedback + обязательный audit. Сохранять archive predicate и conflict mapping; S3 upload вне короткой DB transaction, старый объект не удалять до подтверждённого commit. fileKey CAS/lifecycle пока отсутствует намеренно; перенос non-null keys в реальные строки до завершения 2B небезопасен.
5. File validation и bounded upload/stream: лимиты, MIME/signature, безопасное имя/headers, attachment, no-store/nosniff. Client compatibility проверять фактическим downloader, а не только строковым JSON contract.
6. Failure recovery: orphan compensation только при подтверждённом rollback; ambiguous commit требует повторной проверки references/operation identity. Durable reconciliation/cleanup intents, pagination listing, grace period, защита in-flight uploads; не копировать indiscriminate age cleanup общего storage utility.
7. Последующий разрешённый transfer: отдельно инвентаризировать **2 записи Production и 2 Test со слов пользователя**, проверить конкретные objects/ownership, copy/verify → transactional key update/audit → отдельно согласованное закрытие public copies. Совпадение агрегатов не доказывает одинаковые файлы или общую БД. Никакой автоматический backfill/transfer не сделан этим этапом.

Потребуются real disposable MinIO tests и HTTP/client tests, recovery fault injection и очередной release gate. Общий public select должен остаться закрытым; internal key query нельзя напрямую возвращать из контроллера. Ограничение публичного repository типа — полезная граница, а не препятствие для private storage.

## 11. Final Release Gate

**PASS WITH NOTES — READY FOR A SEPARATE PHASE 2A COMMIT.**

- P0/P1: **нет** в проверенном Phase 2A scope; mandatory remediation до коммита не требуется.
- Findings: **2 × P2** — Sort/index nuance и автоматическое подключение dedicated tests. Источники, подтверждение, воспроизведение и минимальные меры указаны выше.
- Tests: **713 unique passed / 0 failed / 0 skipped**; targeted 34 и smoke 11 отдельно без двойного подсчёта.
- Migration: additive, старые строки/constraints сохранены, повторный deploy/no drift доказаны локально; server locks/history требуют отдельной разрешённой operational проверки.
- Serialization/soft delete: leaks внутренних Document fields не обнаружены, active filters/CAS действуют, прежние успешные contracts и Phase 1 security сохранены.
- Phase 2B: можно начинать реализацию на этой основе; privacy/upload/download/recovery готовность самой функции ещё не заявляется.

HEAD/index и исходники оставлены для будущего отдельного commit. Ни git add/commit/push, ни remote operations/deploy/MinIO calls не выполнялись. Новый report ignored; предыдущие reports и все проверяемые implementation files сохранены.
