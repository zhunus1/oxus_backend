# Student Documents Phase 2A — Prisma Schema & Safe Serialization

Дата: 09.10.2026. Baseline Phase 1: `6648f7b423eaf5b2d75deabd71a2321b5db63258`.

## 1. Executive Summary

Реализованы две nullable внутренние колонки Document, один индекс, explicit public select/mapper и SQL-фильтры архивных документов. Существующие upload/download/fileUrl semantics сохранены. Phase 1 authorization, review CAS, Serializable transaction и audit rollback сохранены.

Перед работой проверены ветка `release/manual-contract-candidate`, HEAD и чистый working tree/index. Локальный upstream ref `origin/release/manual-contract-candidate` совпадал с HEAD; это состояние локальных refs, без remote fetch или предположения о push. Изучены [design review](student-documents-crud-design-review.md) и [Phase 1 remediation report](student-documents-phase1-remediation-report.md); фактические исходники и migrations использовались как источник текущего поведения. Исторические описания authorization в design review не принимались за текущую реализацию.

**Итог: готово к final review Phase 2A.** 713 уникальных выполненных тестов прошли; 0 failed / skipped в финальных прогонах. Миграция реально применена через Prisma Migrate к disposable PostgreSQL, сохранение двух исторических строк доказано. Production/Test не подключались и не изменялись. Коммит, push и deploy не выполнялись. Production readiness для private documents не заявляется.

## 2. Перечень изменённых файлов

| Файл | Изменение |
|---|---|
| [schema.prisma](../src/prisma/schema.prisma#L638) | Только Document.fileKey, deletedAt и индекс |
| [Новая migration.sql](../src/prisma/migrations/20261009120000_document_private_fields/migration.sql) | Две ADD COLUMN и CREATE INDEX |
| [public-document.ts](../src/common/serialization/public-document.ts) | Общий public select/type и явный mapper 11 полей |
| [public-document.spec.ts](../src/common/serialization/public-document.spec.ts) | 3 unit tests: неизвестные свойства, entity constructor, partial/null/date compatibility |
| [document.entity.ts](../src/modules/document/api/dto/document.entity.ts) | Constructor использует allowlist; status типизирован существующим DocumentStatus |
| [document.repository.ts](../src/modules/document/repository/document.repository.ts) | Active filters, public selects, deletedAt в CAS |
| [document.service.ts](../src/modules/document/service/document.service.ts) | Public mapper всех результатов; active read/update в review transaction |
| [admin.service.ts](../src/modules/admin/admin.service.ts#L236) | CRM document include: active filter + public select; существующий response mapper сохранён |
| [portrait.repository.ts](../src/modules/admin/portrait/repository/portrait.repository.ts#L86) | Оба document nesting levels: active filter + public select, сохранён owner filter |
| [expert-dashboard.repository.ts](../src/modules/expert-dashboard/repository/expert-dashboard.repository.ts#L50) | Active filter; прежний select из 6 полей сохранён |
| [target-program.repository.ts](../src/modules/target-program/repository/target-program.repository.ts#L13) | Active/owner filters + public select во всех nested responses |
| [program-requirement.repository.ts](../src/modules/program-requirement/repository/program-requirement.repository.ts#L70) | Active/owner/target filters и select нужных четырёх полей |
| [document-security-http.test.ts](../test/document-security-http.test.ts) | 12 новых HTTP scenarios; старое сравнение raw Prisma keys заменено проверкой фиксированных публичных полей |
| [document-schema-migration.test.ts](../test/document-schema-migration.test.ts) | 4 migration tests через migrate deploy на собственной disposable DB |
| [run-document-security.mjs](../test/run-document-security.mjs#L19) | Инициализация disposable DB через migrate deploy вместо db push |
| Этот отчёт | Результаты, ограничения и readiness |

Итого: 11 modified tracked + 4 новых source/test/migration файла; новый отчёт в ignored `/docs` отдельно. Generated Prisma Client обновлён локально штатным generate и остаётся ignored. Package.json, lockfile, roles/permissions/auth policy, MinIO, contracts/payments/Lead flow, deployment и historical migrations не изменены. Другие пользовательские файлы и предыдущие отчёты сохранены.

## 3. Изменения Prisma schema

В существующем Document добавлены:

```prisma
fileKey   String?
deletedAt DateTime?

@@index([studentPortraitId, deletedAt, updatedAt])
```

Оба поля nullable без default. fileKey пока только внутреннее поле модели, без интерпретации bucket/key и без автоматической записи при upload. Старые строки и текущие uploads сохраняют NULL. deletedAt подготавливает будущий soft delete; endpoint, restore и file cleanup не добавлены.

Существующие 11 полей, enums DocumentStatus/RequirementType, relations, FK/referential actions не менялись. В baseline Document не имел secondary indexes; дублирующий индекс не добавлен.

## 4. Новая миграция и её безопасность

Создана ровно одна миграция `20261009120000_document_private_fields`. SQL сгенерирован Prisma Migrate diff между сохранённой baseline schema и текущей schema, без переписывания истории:

```sql
-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "fileKey" TEXT;

-- CreateIndex
CREATE INDEX "Document_studentPortraitId_deletedAt_updatedAt_idx"
ON "Document"("studentPortraitId", "deletedAt", "updatedAt");
```

Нет UPDATE/backfill, DROP/DELETE/TRUNCATE, изменения enums, FK или существующих defaults. Nullable ADD COLUMN не требует подстановки значения в старые записи. Не выполняется перенос файлов или изменение fileUrl. Generated SQL не содержит `CONCURRENTLY`; ALTER TABLE/обычный CREATE INDEX требуют штатных DDL locks. Время/нагрузка на серверных БД не измерялись, remote применение не разрешалось.

Проверка миграции использует официальный CLI (`migrate deploy`, `migrate diff`), не db push. Сначала применена копия полной baseline migration history без новой миграции, затем созданы две старые строки, после чего новый deploy применил repository migration. Исторические файлы в репо не менялись; только временная копия нового файла удалялась при подготовке baseline fixture.

Автоматическая down migration не добавлялась. До использования новых полей структурный откат возможен отдельным согласованным планом. После заполнения fileKey/deletedAt удаление колонок теряет информацию; старый Phase 1 binary может раскрыть внутренние поля/архивы через raw responses. Предпочтителен roll-forward или совместимая версия с whitelist/filtering.

## 5. Public Document serialization

Общий [PUBLIC_DOCUMENT_SELECT и toPublicDocument](../src/common/serialization/public-document.ts) разрешают ровно:

`id`, `title`, `fileUrl`, `documentType`, `version`, `status`, `feedback`, `studentPortraitId`, `targetProgramId`, `createdAt`, `updatedAt`.

DocumentRepository create/read/update и transaction read/update в review используют этот select. DocumentService дополнительно строит явный объект mapper перед возвратом; неизвестные будущие свойства исходной Prisma row также не копируются. Mapper сохраняет значения, Date objects и nullable поля; HTTP JSON timestamps остаются ISO strings. Existing DocumentEntity constructor больше не копирует произвольный input через raw Object.assign.

Nested full portrait и TargetProgram.documents защищены select в самом Prisma query, включая документы внутри target programs. Это allowlist до сериализации, а не recursive удаление секретных свойств после загрузки. Добавление будущей колонки Document не меняет эти projections автоматически.

У существующих fragments сохранены более узкие wire contracts: Admin CRM map из 9 document fields, dashboard из 6 fields, requirements-status собственный requirement mapping. Они не расширяются до 11 полей: существующие клиенты продолжают получать прежнюю структуру. CRM теперь также не загружает внутренние колонки, dashboard/requirements имеют explicit narrow selects.

Другие сущности могут иметь собственные исторические deletedAt/file-key свойства; здесь гарантируется защита **Document**, без изменения сериализации User/Contract и других доменов.

## 6. Soft-delete filtering

| Query/path | SQL-level условие и результат |
|---|---|
| Document self list | studentPortraitId + deletedAt=null, прежняя сортировка updatedAt desc |
| Direct read/new-version/submit lookup | unique id + deletedAt=null; архив равен отсутствующему document, 404 для уполномоченного actor |
| Review transaction lookup | id + deletedAt=null на том же Serializable transaction client |
| Replacement/submit/review write | deletedAt=null добавлен к прежнему CAS snapshot; архивирование после initial read не позволяет stale write |
| Admin CRM portrait.documents | deletedAt=null в include, разрешённый ADMIN guard сохраняется |
| Expert full direct documents | Relation owner + deletedAt=null |
| Full portrait nested target-program documents | studentPortraitId текущего портрета + deletedAt=null |
| TargetProgram list/detail/update/create responses | studentPortraitId владельца программы + deletedAt=null |
| Dashboard kanban/stale documents | Relation owner + deletedAt=null, прежний assignment filter |
| Requirements document lookup | targetProgramId + studentPortraitId + deletedAt=null; архив не влияет на isSubmitted/status |

Исторические неверно привязанные чужие документы по-прежнему исключаются, даже если активны и имеют fileKey. Фильтрация выполняется в БД, архивы не загружаются для последующего JS filtering. Сами строки сохраняются, физическое удаление/restore не реализованы.

Поиск всех Document delegates/includes выполнен по `src`. Помимо API найдены findFirst/update/create в `src/prisma/seed/expert.seed.ts`: это внутреннее создание демоданных, не reader публичного API. Seed logic не менялась и этот seed не запускался. Internal TargetProgramRepository.findById, generic portrait CRUD, status updates не включают документы. Task.fileUrl и Contract.scanFileKey относятся к другим сущностям и не менялись.

## 7. HTTP/API compatibility

Все шесть Document endpoints сохраняют 11 public fields и прежние success status codes: POST 201, reads/PATCH 200. Успешные upload→replacement→submit→review и read ADMIN/assigned EXPERT/owner проверены с non-null synthetic fileKey. GET documents/me остаётся массивом.

CRM остаётся `detail.portrait.documents`; full portrait содержит документы портрета и вложенных программ; TargetProgram list/detail/update/create сохраняют структуру; dashboard/requirements сохраняют прежние fragments. Student/SCHOOLBOY ownership, assigned expert и current ADMIN/deleted-role/block behavior Phase 1 не ослаблены.

Новая намеренная семантика: архивный документ не виден и операции с ним возвращают 404 после обычных guards. Если архивирование фиксируется между snapshot и write — 409, без изменения версии/status/feedback/fileUrl и без audit. Review по-прежнему разрешает только APPROVED/NEEDS_REVISION из REVIEW; неверные состояния сохраняют 400, RBAC 403/blocked User 401. Автоматического review retry нет.

Private bucket/download endpoint и изменённые URL здесь отсутствуют. Непустой fileKey в tests — синтетическая проверка конфиденциальности поля, а не реализация private storage или подтверждение возможности скачивания такого объекта.

## 8. Security regression results

| Финальный прогон | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Full Jest: 46 suites | 412 | 0 | 0 |
| Real PostgreSQL document HTTP suite | 80 | 0 | 0 |
| Штатный integration runner: 19 node:test suites | 217 | 0 | 0 |
| Новый Document migration suite | 4 | 0 | 0 |
| **Уникальный итог** | **713** | **0** | **0** |

Targeted Jest: 34 passed / 0 failed / 0 skipped, включён в full Jest и повторно не суммируется. Отдельный existing sales-expert smoke script: exit 0, 11 сценариев, не прибавлен к test count. Cancelled/todo в node suites отсутствуют.

Сравнение Phase 1: 688 → 713. Добавлено 19 новых tests (3 unit, 12 HTTP, 4 migration), и теперь выполнены ранее исключённые четыре historical migration suites, всего ещё 6 checks. Исходные 211 business regression tests по-прежнему прошли.

| Existing suite | Passed |
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

Новые HTTP tests проверяют все Document responses, internal fields, archive refusal без upload/audit, CRM shape, обе full portrait document relations, active/owner filters program list/detail/update/create, dashboard kanban/stale с действительно присутствующим fixture, SCHOOLBOY, archived requirements и три контролируемых archive-vs-write сценария. Unit test передаёт fileKey/deletedAt, будущее неизвестное поле и relation в mapper и проверяет их отсутствие в JSON.

Старый HTTP assert сравнивал response с полным набором Prisma keys; он заменён явной проверкой 11 fields, так как ORM теперь имеет 13 колонок. Остальные Phase 1 scenarios сохранены, включая concurrent reviews/replacements и audit-stage P2034/unknown-error rollback/no-retry.

Prisma validate/generate, Nest TypeScript build, полный configured lint и git diff --check: exit 0. Lint output пустой. Новых регрессий в выполненном покрытии не обнаружено.

Неуспешная начальная попытка migration suite: 4 hookFailed / 0 passed из-за missing updatedAt в тестовом SQL Country fixture, до применения новой миграции. Исправлен fixture; финальный повтор 4/4. Application code/migration для обхода этой ошибки не менялись.

HTTP использует production controllers/services/guards и PostgreSQL, fake UploadService без S3. Legacy StudentPortraitService.findMe fixture остаётся прежним; full AppModule e2e, frontend/mobile downloads и реальные storage tests не выполнялись. Git secret/scope review изменённых tracked/untracked файлов не выявил реальных credentials/PII; тестовые значения example.test/случайные JWT secrets не являются серверными credentials.

## 9. Migration verification results

[document-schema-migration.test.ts](../test/document-schema-migration.test.ts) сам создаёт UUID DB только на loopback PostgreSQL. В baseline доказаны 11 колонок Document, после deploy — две новые nullable колонки; schema + catalog + migration history проверяются отдельно.

| Проверка | Фактический результат |
|---|---|
| Старая migration history | Успешный deploy в новую БД без Phase 2A migration |
| Fixtures до новой миграции | PASSPORT/APPROVED/version=3 и TRANSCRIPT/NEEDS_REVISION/version=2; заданные title/fileUrl/feedback/dates/owner; одна program link и одна NULL link |
| Новый migrate deploy | Exit 0, применена новая migration |
| Data preservation | Полное сравнение всех прежних 11 колонок обеих строк до/после: равны |
| New fields | fileKey=NULL, deletedAt=NULL для обеих строк; типы/nullability/defaults проверены в information_schema |
| Index | Найден в pg_indexes с точным набором portrait/deletedAt/updatedAt |
| Existing constraints | PK/FK names + pg_get_constraintdef до/после равны |
| Повторный deploy | Exit 0 / No pending migrations; обе строки неизменны; новая migration зарегистрирована один раз |
| Schema agreement | migrate diff --from-config-datasource --to-schema --exit-code: exit 0 |
| Prisma Client | Generate успешен, клиент содержит новые поля |

Штатный integration runner также успешно применил **полную** историю, включая новую миграцию, и проверил отсутствие drift в каждой из 20 отдельных DB. HTTP runner теперь применяет migrations, db push в Phase 2A не запускался. Все созданные suites DB удалены в finally, собственные локальные PostgreSQL/Redis контейнеры по завершении удалены вместе с данными.

Для повторения с DATABASE_URL только локального disposable `*_test` PostgreSQL и локальным Redis:

```sh
node node_modules/prisma/build/index.js validate
node node_modules/prisma/build/index.js generate
node node_modules/@nestjs/cli/bin/nest.js build
node --import tsx --test --test-concurrency=1 test/document-schema-migration.test.ts
node test/run-document-security.mjs
node node_modules/jest/bin/jest.js --runInBand
# SALES_V2_TEST_REDIS_URL должен указывать на disposable localhost Redis
node test/run-integration.mjs
node node_modules/eslint/bin/eslint.js '{src,apps,libs,test}/**/*.ts'
git diff --check
```

Артефакты доступны локально: `/private/tmp/oxus-document-phase2a-{baseline-deploy,targeted,migration,http,unit,lint,integration}.txt` и `oxus-document-phase2a-integration-summary.json`. Эти логи не добавлялись в repository.

## 10. Performance/SQL considerations

Индекс `(studentPortraitId, deletedAt, updatedAt)` покрывает общий owner + active predicate и сортировку списков по updatedAt. PostgreSQL может использовать обратный проход для desc при фиксированных первых ключах. id не включён: основным спискам не требуется новая stable pagination, её scope не добавлялся. Дополнительный targetProgram-specific index не введён без измерений; requirements сохраняет существующую сортировку updatedAt/id и ограничивает два owner IDs.

Unique id lookups используют PK и дополнительный active predicate; CAS сохраняет PK/version/status/updatedAt/fileUrl плюс deletedAt=null. Явные selects не загружают новые внутренние поля и не добавляют прикладных запросов/N+1. Маппер линейный по числу возвращённых документов, без дополнительных DB reads или recursive копирования whole portraits.

Не измерялись production EXPLAIN/load/DDL duration; каталог доказывает создание индекса, но не принудительное использование planner на двух строках. Review остаётся короткой Serializable DB transaction без S3 I/O и без новых общих revocation locks.

## 11. Остаточные риски

Публичные legacy bucket policies/известные fileUrl сохраняются; soft delete скрывает metadata API, но не отзывает уже известную публичную ссылку и не удаляет объект. Private bucket, authenticated download, legacy migration/backfill, retention и upload validation остаются для Phase 2B/2C. Значение fileKey не меняет fileUrl response автоматически.

Существующая in-flight revocation граница Phase 1 для transfer/role/User block сохраняется. Новые archive CAS tests доказывают конфликт при конкурентном изменении **самой строки Document**; это не общий lock-протокол actor/profile/portrait. Read/list с архивированием одновременно могут вернуть документ из ранее полученного snapshot; новые запросы после commit исключают архив.

Orphan object после upload + failed CAS, прежняя filename/key collision strategy и отсутствие реальных storage/mobile проверок сохраняются. Перед внедрением настоящих private keys необходимо согласовать private-file replacement/CAS/download semantics и client compatibility; Stage 2A сам их не реализует. Nullable schema не гарантирует безопасный rollback на binary, возвращающий raw ORM records.

Remote data/schema/indexes не проверялись агентом; сохранность доказана для локальных аналогов двух предоставленных исторических записей и неизменённых constraints. Test/Production остались нетронутыми.

## 12. Readiness к final review и отдельному коммиту

**READY FOR FINAL REVIEW — Phase 2A scope.** Реализация и финальные проверки завершены: schema additive, одна generated migration, явная allowlist serialization во всех найденных document-bearing API, SQL active/owner filtering, archive CAS и прежняя security policy подтверждены реальными HTTP/PostgreSQL tests.

Рабочая копия оставлена uncommitted/unstaged для независимого review. В HEAD остаётся Phase 1 commit `6648f7b`. Commit/push/deploy не выполнялись. `/docs` уже игнорируется Git; включение нового отчёта в будущий Phase 2A commit потребует явного force-add после review. Readiness этого этапа не означает production readiness всей private documents функции; Phase 2B/2C ещё не выполнены.
