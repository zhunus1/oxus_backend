# Student Documents Phase 1 — Remediation Report

Дата: 09.10.2026. Baseline: `3ab5d7a9fccae34890b65cebaa33b37bbe62313d`.
Рассмотрены [implementation report](student-documents-phase1-security-report.md) и [final review](student-documents-phase1-final-review.md). Этот отчёт фиксирует последующее исправление F-01/F-02 и заменяет прежний NOT READY gate для текущей рабочей копии. Старые отчёты сохранены как история проверки.

## 1. Root cause F-01

StudentDocumentAccessService проверял актуальные User.deletedAt и Role.deletedAt. JwtAuthGuard загружал текущий role.code, но игнорировал Role.deletedAt. RolesGuard доверял роли, установленной этим guard. Admin CRM возвращал `detail.portrait.documents`, включая fileUrl, после JWT + ADMIN guards без отдельной document policy. Поэтому soft-deleted ADMIN Role запрещала прямое чтение документа, но оставляла CRM reader доступным.

Это унаследованный API bypass внутри Phase 1, а не проблема, которую исправляет private bucket. Исправлен в [JwtAuthGuard](../src/modules/admin/auth/rbac/auth.guard.ts#L42); document policy не ослаблялась.

## 2. Выбранный способ исправления

| Вариант | Оценка |
|---|---|
| A: Role.deletedAt в общем JwtAuthGuard | Выбран: добавляется поле к существующему DB select и отказ перед установкой request.user/проверкой permissions. Нет дополнительного запроса или новой DI-зависимости. Все использующие guard маршруты применяют одинаковое правило актуальности роли. |
| B: StudentDocumentAccessService в Admin CRM domain boundary | Возможен, но потребовал бы actor ID и DI/signature changes у CRM service; исправлял бы один reader, оставляя общий guard с другим правилом для deleted Role. Для подтверждённого HTTP bypass избыточен. |

Удалённая роль получает **403**, согласованно с document/contract domain policy и существующей договорной HTTP-семантикой. Заблокированный/отсутствующий User по-прежнему получает **401**. Активные ADMIN/EXPERT/STUDENT/SCHOOLBOY/SALES_MANAGER сохраняют права текущей роли из БД, независимо от JWT roleCode. Эти пять ролей соответствуют текущему roles seed.

Первоначальная правка возвращала 401 и выявила несовместимость с existing contract security test. В финальной версии сохранён 403; существующий тест не менялся. Это намеренное уточнение compatibility после регрессии.

StudentDocumentAccessService сохраняет собственные проверки для прямых service calls и review transaction. AdminService остаётся внутренним reader за production guards: новая гарантия для CRM относится к HTTP boundary, а не к произвольному вызову AdminService вне него. Никаких always-allow guards или повторной policy в CRM не добавлено.

Общее изменение также применяется к guarded `auth/me` и `auth/sign-out`: active Role → 200, deleted Role → 403, восстановление → 200. Реальные AuthController/AuthService/UsersService/UsersRepository/CookieService проверены через HTTP для всех пяти ролей. Sign-in, sign-up, refresh-token не используют изменённый guard; их service logic и выдача токенов не менялись. Выданный токен не обходит проверку текущей роли на защищённых маршрутах.

## 3. Проверенные альтернативные readers

Поиск Document includes/queries/fileUrl в application source повторён. Student document readers:

| Reader | Проверка |
|---|---|
| `GET documents/:id` | ADMIN active/deleted/restored с одним JWT; own STUDENT/SCHOOLBOY, assigned/foreign/inactive EXPERT; чужие роли; disabled User |
| `GET admin/crm/students/:studentUserId` | Реальный AdminController + AdminService + JwtAuthGuard + RolesGuard: active ADMIN видит ожидаемый id/fileUrl; deleted Role → 403 без вложенных данных; восстановление → 200; ADMIN→SALES_MANAGER → 403; blocked User → 401 |
| `GET expert/portraits/:id/full` | Deleted Role отвергается; назначение/active expert проверяются domain policy; чужие nested program documents отфильтрованы |
| `GET target-programs/:id/requirements-status` | Deleted Role отвергается; active actors сохраняют допустимый доступ; историческая неверная привязка исключается |
| `GET documents/me`, `GET target-programs/me`, `GET target-programs/:id` | Deleted STUDENT/SCHOOLBOY/EXPERT/SALES_MANAGER Role → 403 раньше reader; после восстановления соблюдаются прежние права |
| `GET expert/dashboard/kanban`, `GET expert/dashboard/stale` | Deleted Role → 403; inactive profile → 403; документы выбираются по существующему assignment filter |

Для denied response проверяется полный набор error-only полей (`error`, `message`, `statusCode`), а не только отсутствие fileUrl. При deleted ADMIN Role дополнительно проверяется service-level 403.

Generic portrait list/detail/KYC/subscription не включают Document; Task.fileUrl относится к отдельной сущности. Нового document-bearing bypass в рассмотренных маршрутах не обнаружено. Общий аудит всех legacy CRUD не заявляется.

## 4. Исправление F-02

[AuditLogService](../src/modules/audit-log/service/audit-log.service.ts#L17) повторно выбрасывает **тот же** PrismaClientKnownRequestError с code=P2034 только при наличии transaction client. DocumentService.review использует существующий внешний catch и преобразует его в HTTP 409. Автоматического retry нет.

Non-transaction audit callers сохраняют прежнюю InternalServerErrorException/500 семантику, включая P2034. Произвольный Error и другие Prisma codes по-прежнему дают 500. Document update + AuditLog продолжают выполняться в одной Serializable transaction; schema и review алгоритм не менялись в remediation.

[HTTP audit-stage test](../test/document-security-http.test.ts#L550) вызывает реальный SQL audit INSERT, затем инъецирует настоящий PrismaClientKnownRequestError через transaction delegate. Ошибка проходит через настоящий AuditLogService.log. Проверено: 409 для P2034, полный rollback исходной Document row (включая feedback/updatedAt), отсутствие AuditLog, один вызов audit и один INSERT без retry. Контрольный P2003 даёт 500 с тем же rollback.

Это контролируемая fault injection на audit stage внутри реальной PostgreSQL-транзакции. Естественный SSI конфликт именно на audit INSERT под нагрузкой не воспроизводился; тест доказывает propagation/error mapping и атомарность, а не вероятность такого конфликта.

## 5. Новые targeted tests

Добавлено **29** тестов относительно предыдущего покрытия: 5 Jest guard lifecycle, 4 Jest audit error propagation и 20 HTTP.

| Проверка | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Targeted Jest: guard, audit, document policy | 31 | 0 | 0 |
| Полный document HTTP suite | 68 | 0 | 0 |

Targeted 31 входит в full Jest и повторно не суммируется. Новые HTTP сценарии: deleted Role lifecycle/aliases, CRM metadata, current ADMIN role/User block, audit P2034/P2003 rollback, inactive/missing expert profile для четырёх dashboard операций, positive dashboard behavior, Swagger outcomes, auth/me/sign-out для всех пяти ролей.

HTTP fixture использует production controllers/services/repositories/guards, реальный disposable PostgreSQL и validation pipe. UploadService замещён без обращения к storage; StudentPortraitService.findMe остаётся прежним fixture lookup, поэтому production missing-portrait path этим набором не доказывается. Неиспользуемые finance/realtime и auth signup dependencies inert, без внешнего I/O.

## 6. Общие regression results

| Финальный прогон | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Полный Jest, 45 suites | 409 | 0 | 0 |
| Document HTTP security | 68 | 0 | 0 |
| Existing regression suites, 15 node:test файлов | 211 | 0 | 0 |
| **Уникальные тесты** | **688** | **0** | **0** |

Предыдущий итог: 659 = 400 + 48 + 211. Текущий: **688 = 409 + 68 + 211**, прирост **29**. Cancelled/todo в node suites отсутствуют. Smoke script завершился exit 0 и не прибавлен к test count.

| Existing suite | Passed |
|---|---:|
| phase4-reporting | 12 |
| openapi-contract | 10 |
| phase3-production-blockers | 17 |
| admin-expert-profile | 12 |
| phase1-contract-security | 34 |
| phase2-reporting | 18 |
| manual-contract-http | 11 |
| sales-contract-reliability | 12 |
| sales-expert-v2-http | 9 |
| expert-lead-visibility-http | 6 |
| sales-expert-v2-regression | 40 |
| lead-call-notifications | 9 |
| express-lead-http | 14 |
| manual-lead-metrics-http | 6 |
| sales-expert-demo | 1 |

Nest/TypeScript build, configured eslint всего проекта и `git diff --check`: **exit 0**. Lint output пустой. Проверено после последних application changes.

История неуспешных попыток не скрывается:

- Sandbox EPERM при первом localhost DB connection: runner повторён с разрешением вне sandbox, адрес остался localhost.
- Новый Jest audit suite первоначально не стартовал из-за generated-client module resolution/PrismaService fixture; исправлена только настройка unit mock с настоящим runtime error class. Финальный targeted/full Jest успешен.
- Первый расширенный HTTP прогон: 62 passed / 1 failed — тест читал CRM `.portrait.documents` вместо существующего `.detail.portrait.documents`. Исправлен fixture assertion, application response не менялся.
- Первый широкий regression прогон: 183 passed / 4 failed / 0 skipped, 187 обнаруженных tests вместо 211. Один contract test выявил 401 вместо прежнего 403 для deleted Role; исправлен guard. Три suite-level bootstrap failures были вызваны параллельной пересборкой `dist` во время imports. Финальный полный повтор проведён после завершения build: 211/211. Существующие regression source files не менялись.

БД создавались с UUID-именами, схема инициализировалась `prisma db push` только в новых disposable DB, каждая БД удалялась в finally. Четыре migration suites и integration runner с migrate deploy не запускались. Это **не ноль выполненных skipped suites**, а явно не запущенные проверки вне разрешённого scope; число skipped=0 относится к выполненным тестам. Full AppModule e2e/реальное storage/mobile download/remote smoke не выполнялись.

Локальные артефакты: `/private/tmp/oxus-document-remediation-{targeted,unit,http,lint}.txt`, `/private/tmp/oxus-document-remediation-regression-summary.json`, отдельные suite logs. Первоначальный широкий summary сохранён отдельно с суффиксом `regression-first-summary.json`.

## 7. Решение по F-03/F-04/F-05

**F-03 — accepted residual, concurrency hardening следующего этапа.** Serializable review читает прежний snapshot. Уже начавшийся review может завершиться после параллельного transfer/role change/User block. Новый guard закрывает следующий запрос после revocation, но не отменяет прошедший guard in-flight request. Общий row-lock протокол не добавлялся. Воспроизведение трёх случаев находится в [final review, F-03](student-documents-phase1-final-review.md#f-03--p2-подтверждённая-и-ранее-документированная-граница-in-flight-ревокации); в remediation эти probes не повторялись. Известная граница явно сохраняется, обещания строгой in-flight ревокации нет.

**F-04 — metadata исправлены.** Review summary сообщает assigned active expert или admin. Все Document операции получили 403 description; replacement/submit/review получили 409 description. Swagger test генерирует OpenAPI из настоящих контроллеров и проверяет эти outcomes. Форматы запросов/успешных ответов не менялись; широкая доработка legacy Swagger schemas/multipart annotations не проводилась.

**F-05 — helper сохранён с явным security scope.** Inactive/missing ConsultantProfile не должен позволять expert-only assignment/transfer/comment/test-answer. Проверка перед операцией оправданна; прежний 404 для missing profile становится 403. Добавлены четыре negative HTTP tests с проверкой отсутствия assignment/transfer/audit изменений, positive test для всех четырёх операций и missing-profile HTTP coverage. В active test проверены реальные audit/comment, assignment/transfer и существующий attempt в answers response. Helper не переименовывался/не разделялся; dashboard refactor не выполнялся.

## 8. Изменённые файлы и scope review

В этом remediation изменены ровно шесть source/test файлов плюс новый отчёт:

- [auth.guard.ts](../src/modules/admin/auth/rbac/auth.guard.ts): select Role.deletedAt и 403 до request.user.
- [auth.guard.spec.ts](../src/modules/admin/auth/rbac/auth.guard.spec.ts): пять lifecycle cases.
- [audit-log.service.ts](../src/modules/audit-log/service/audit-log.service.ts): transaction P2034 propagation.
- [audit-log.service.spec.ts](../src/modules/audit-log/service/audit-log.service.spec.ts): четыре новых unit cases.
- [document.controller.ts](../src/modules/document/api/document.controller.ts): Swagger metadata.
- [document-security-http.test.ts](../test/document-security-http.test.ts): реальные CRM/auth/dashboard fixtures и двадцать новых tests.
- Этот отчёт.

Полная рабочая копия Phase 1 относительно baseline содержит **23 modified tracked + 6 untracked source/test files**. Остальные ранее реализованные изменения сохранены и проверены:

| Группа | Полный inventory |
|---|---|
| Package | `package.json` |
| Общая policy, untracked | `src/common/authorization/student-document-access.module.ts`, `student-document-access.service.ts`, `student-document-access.service.spec.ts` |
| Auth, tracked | `src/modules/admin/auth/rbac/auth.guard.ts`, `auth.guard.spec.ts` |
| Admin portrait, tracked | `src/modules/admin/portrait/api/portrait.controller.ts`, `portrait.module.ts`, `repository/portrait.repository.ts`, `service/portrait.service.ts` |
| Audit | `src/modules/audit-log/service/audit-log.service.ts` (tracked), `audit-log.service.spec.ts` (untracked) |
| Document, tracked | `src/modules/document/api/document.controller.ts`, `api/dto/review-document.dto.ts`, `document.module.ts`, `repository/document.repository.ts`, `service/document.service.ts` |
| Dashboard, tracked | `src/modules/expert-dashboard/expert-dashboard.module.ts`, `service/expert-dashboard.service.ts` |
| Requirements, tracked | `src/modules/program-requirement/api/program-requirement.controller.ts`, `program-requirement.module.ts`, `repository/program-requirement.repository.ts`, `service/program-requirement.service.ts` |
| TargetProgram, tracked | `src/modules/target-program/api/target-program.controller.ts`, `target-program.module.ts`, `repository/target-program.repository.ts`, `service/target-program.service.ts` |
| HTTP tooling, untracked | `test/document-security-http.test.ts`, `test/run-document-security.mjs` |

Prisma schema/migrations, generated client, MinIO/storage, contract/payment/lead application code, deployment, yarn.lock и .gitignore не имеют изменений. Новых миграций нет. В изменённых файлах выполнены source review и поиск AWS key/private key/external DB URL indicators: реальных credentials/персональных данных не обнаружено. Fixtures используют случайные example.test email/URL и локальные тестовые данные; JWT secret создаётся случайно и восстанавливается после suite.

Git index пуст относительно HEAD; git add/commit/push и другие Git mutations не выполнялись. `/docs` уже игнорируется `.gitignore`; отчёт существует локально, обычный git status его не показывает. Для включения отчёта в будущий коммит потребуется явное добавление ignored файла. .gitignore не менялся.

## 9. Остаточные риски

Сохраняются известные ограничения Phase 1: публичные legacy fileUrl/MinIO policy, in-flight revocation (F-03), orphan objects после успешного upload и DB failure, прежняя filename/key strategy и возможные storage collisions, отсутствие новых MIME/magic-byte/retention/private-download механизмов. Реальный S3 I/O и клиентское скачивание не проверялись. Private bucket/schema/Staff CRUD относятся к следующей фазе.

Добавленный guard не исправляет все unrelated legacy domain calls без HTTP guards и не меняет unguarded token issuance; guarantee относится к перечисленным защищённым маршрутам. Global role activity check расширяет отказ на остальные guarded APIs — это согласованное security tightening для недействительной роли, без изменения active-role success contracts. Existing contract/security/Admin/RBAC regressions прошли.

Test/Production не подключались. Deploy, schema/storage changes и Staff CRUD не выполнялись. Для тестов использованы только созданные для этой проверки локальные PostgreSQL/Redis контейнеры; по завершении они удалены вместе с их данными.

## 10. Итоговый release gate

**PASS WITH NOTES.** F-01 закрыт реальным HTTP regression через AdminController/DocumentController, production guards/services и PostgreSQL. F-02 закрыт propagation + HTTP audit-stage rollback/no-retry тестами. F-04 metadata исправлены; F-05 решение подтверждено positive/negative HTTP coverage. F-03 сохранён как документированный residual следующего этапа.

**Подтверждённых незакрытых P0/P1 в согласованном Phase 1 scope не осталось.** Финальные проверки: 688 passed, 0 failed, 0 skipped; build/lint/diff-check успешны. Рабочая копия готова к отдельному коммиту Phase 1 с учётом перечисленных notes. Коммит/deploy не выполнены; gate не является утверждением о приватности уже существующих файлов.
