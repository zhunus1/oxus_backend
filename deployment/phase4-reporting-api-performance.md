# Phase 4 — reporting, API, performance

Проверка завершена 2026-09-29. Baseline: F01–F11 и Phase 3 R01/R02/R08. **R03/R04/R05/R07 — PASS. R06 — PASS для backend-контракта; реальная provider interoperability остаётся непроверенной до staging merchant E2E.**

Commit, push, deployment и операции с production-данными не выполнялись. Изменения сравнивались с SHA-256 snapshot рабочего дерева перед Phase 4: HEAD не отражает все накопленные изменения предыдущих фаз. Новых миграций нет.

## Findings

| Finding | Before | Root cause | Fix | Regression | After |
|---|---|---|---|---|---|
| R03 | Оплаченный CRM student увеличивал одновременно paymentsCompletedCount и lostLeads на 1. При dateTo до регистрации всех пользователей totalStudents=0, lostLeads=4. | Отдельный lost predicate терял dateTo/education filter и не исключал payment/conversion. | Общая регистрационная когорта, прежний stalled-registration критерий, исключение подтверждённых платежей/конверсий; summary в одном RepeatableRead snapshot. | Paid/backdated, границы дат и 7 дней, education/country, empty/reversed range, legacy/no events, converted/rejected, конкурентная запись оплаты. | **PASS**: paid и lost не пересекаются; фильтры и snapshot согласованы. |
| R04 | SCHOOLBOY получил PAID и PAYMENT_COMPLETED, но visible events=0, journey=404. | В analytics была hardcoded роль STUDENT. | Использован существующий liveContractStudent predicate: STUDENT/SCHOOLBOY с активной ролью и неудалённым account. | Обе роли, reuse через CRM/manual payment, SCHOOLBOY legacy gateway settlement, unsupported/deleted accounts/roles. | **PASS**: summary/events/funnel/journey включают поддерживаемую популяцию. |
| R05 | Сгенерированный OpenAPI: finance/manual response schemas отсутствовали; OTP обещал 200; scan не имел binary schema; callback выглядел обычным frontend JSON DTO; bearer declarations отсутствовали. | Runtime flow менялся без response documentation. | Response schemas и security metadata только для затронутых областей; OTP deprecated/409; scans multipart/binary; raw signed callback + XML ACK. | 7 автоматических тестов документа из compiled production controllers. | **PASS**: ключевые пути/поля/auth/ref resolution проверены на сгенерированном документе. |
| R06 | Оба init unit cases падали: pg_request_method отсутствует. Отправлялся Pg_result_url_method. | Неверные имя и регистр поля. | Единственный init parameter pg_request_method=POST, включённый в исходный подписываемый набор. | Точные имя/значение, отсутствие старого поля, независимый расчёт подписи, modes 0/1, F01 и R01 runtime matrix. | **PASS backend**; внешняя merchant interoperability не объявляется доказанной. |
| R07 | По 40000 строк: contracts 33506687 bytes, earnings 20677103 bytes; heap delta 150.51/245.05 MiB. | Unlimited findMany; earnings загружал все installments/contracts ради totals. | Default 20/max 100, deterministic order; earnings details paginated, full totals SQL-side. | HTTP/direct bounds, status/ownership, page-independent currency totals, 40000/60000 fixture, read-only performance/EXPLAIN probe. | **PASS**: default 20 строк, размер зависит от page size; нет роста query count на строку. |

## BEFORE и порядок работ

Production-код изменён после повторных воспроизведений всех пяти findings:

- R03/R04: исходные HTTP characterization-сценарии повторены на локальной synthetic DB, **2 passed** означает воспроизведение дефектов. `AUDIT_LOST`: paidIncrement=1, lostIncrement=1; вне cohort totalStudents=0/lostLeads=4. `AUDIT_SCHOOLBOY`: PAID, storedPaymentMilestone=1, visibleEvents=0, journey=404.
- R05: документ заново сгенерирован из исходного build. Проверены реальные path responses/security/requestBody, а не только исходные декораторы.
- R06: сначала прочитана официальная документация и запущен постоянный тест; **2 failed** на отсутствующем pg_request_method для modes 0/1. После изменения тот же тест проходит.
- R07: исходные `findAllByStatus` и `getExpertEarnings` вызваны до edits на существующем volume fixture; по 40000 строк и измеренные bytes/heap/latency сохранены. AFTER использует те же service/repository entry points и ту же БД.

## R03 — analytics cohort

`lostLeads` сохраняет прежний продуктовый смысл **застрявших незаполненных регистраций**, а не становится счётчиком CRM Lead.REJECTED.

Точные условия:

1. Пользователь входит в общую analytics population: STUDENT/SCHOOLBOY, User.deletedAt=null, Role.deletedAt=null.
2. К нему применён общий `buildUserWhere`: включительные User.createdAt dateFrom/dateTo, страна User.country, portrait.educationLevel.
3. Возраст регистрации не меньше 7 × 24 часов; portrait.currentStep=DISCOVERY и educationLevel=NONE.
4. Нет PAYMENT_COMPLETED/LEAD_CONVERTED journey event, SUCCESS gateway transaction или связанного договора с PAID, manualConfirmedAt, оплаченным installment либо Lead.CONVERTED.

Это пересечение условий: запрос educationLevel=HIGH_SCHOOL может иметь студентов в cohort, но lostLeads=0, поскольку профиль с заданным уровнем уже не является незаполненным NONE. Раньше этот фильтр ошибочно игнорировался lost-query.

Summary/funnel используют одну регистрационную когорту; `buildPortraitWhere` делегирует общему user builder. Summary conversion по-прежнему означает уникальных студентов с PAYMENT_COMPLETED **за всю наблюдаемую историю внутри выбранной регистрационной когорты**. DateFrom/dateTo summary не стали фильтром даты платежа. Исторический PAID без journey event не выдумывает новый milestone/payment count, но и не считается lost.

Даты включительные как timestamps. Date-only `dateTo=2001-01-20` означает `2001-01-20T00:00:00Z`, не конец дня; это существующее поведение, теперь описанное в DTO. Для целого дня frontend передаёт точный верхний timestamp с timezone. Неверно упорядоченный, но синтаксически валидный range даёт пустую cohort. Events endpoint сохраняет F08: фильтрует occurredAt, fallback createdAt для legacy, отдельно от даты регистрации.

Backdated manual payment может предшествовать созданию account: conversion учитывается, отрицательная duration остаётся null. Для summary введён RepeatableRead snapshot: тест записывает PAYMENT_COMPLETED через другое соединение между lost-count и payment-read, и подтверждает, что один ответ не смешивает состояния до/после оплаты.

Старые registrations без journey events остаются lost, если удовлетворяют stalled-критерию и нет другого payment/conversion evidence. DISCOVERY с заполненным education и продвинувшиеся ProcessStep не lost. CRM rejected lead без account не входит в student analytics; GAP_YEAR не DISCOVERY. Связывание разных людей по email/phone ради метрики не добавлялось.

## R04 — student-like roles

В [analytics.service.ts](../src/modules/admin/analytics.service.ts) повторно использован [liveContractStudent](../src/modules/contract/domain/contract-access.ts), уже применяемый контрактным domain. Его реализация не менялась. Таким образом, analytics не вводит независимый список ролей.

STUDENT и SCHOOLBOY уже поддерживаются contract access, reuse существующего student в CRM и gateway settlement. Новый CRM account по-прежнему создаётся с STUDENT; существующий SCHOOLBOY при reuse сохраняет роль. Finance остаётся отчётом по договорам и историческому signedByUserId, глобальная role model не изменена.

Все analytics reads — summary, funnel, listEvents, getStudentJourney — теперь используют эту популяцию. Unsupported roles, удалённые accounts и удалённые student-like roles исключены. Постоянные tests подтверждают HTTP visibility после manual payment и видимость после настоящего legacy gateway settlement repository path; verification callback отдельно повторён в F01.

## R05 — OpenAPI

Schemas собраны в [flow-responses.ts](../src/common/openapi/flow-responses.ts) и подключены к production decorators. Это переиспользуемые inline response schemas, а не новые runtime serializers; тела успешных ответов этой документационной правкой не преобразуются.

| Область | Что документируется |
|---|---|
| `/admin/finance/summary` | Nullable scalar money/currency, byCurrency, counts, expertOptions, earningsByExpert |
| `/admin/finance/contracts` | Существующий paginated response, currency/paidAmount/remainingAmount каждой строки |
| `/admin/finance/experts/{id}/earnings` | expert, full-set totals/byCurrency, page details и pagination metadata |
| `/contracts` | Новый page envelope, page/limit bounds, status filter |
| Prepare/update lead contract | lead, contract nullable, draft nullable, invitationRequired; повторный prepare уже созданного договора может вернуть contract |
| Lead manual signature/confirmation | `{lead,draft}` и `{lead,contract,invitationRequired}` соответственно |
| Lead detail | contractDraft и nullable contract |
| Generic manual routes/preview | Contract metadata, manualConfirmedAt, installments; Decimal amount в JSON — строка; schedule preview |
| Business conflicts | 409, optional machine code: HISTORICAL_BENEFITS_REVIEW_REQUIRED / EXISTING_STUDENT_CONFIRMATION_REQUIRED / MANUAL_SIGNATURE_REQUIRED; message-only conflicts также допустимы |
| Analytics | occurredAt — business timestamp; createdAt — storage timestamp; known event types без запрета historical/custom strings; nullable durationMs/durationDays |
| Четыре OTP routes | deprecated, только documented 409 MANUAL_SIGNATURE_REQUIRED, больше нет advertised 200/201 signing success |
| Scans | required multipart file, PDF/JPEG/PNG, 10485760 bytes, invalid MIME/size errors, binary content types, auth |
| FreedomPay callback | Подписанные raw scalar fields и extensions; urlencoded/multipart и принимаемый runtime JSON; XML ACK вместо frontend JSON response; signature auth, без bearer |

Все затронутые protected endpoints объявляют bearer. Схема bearer — HTTP/bearer/JWT. Callback остаётся Public и проверяет provider signature; реальная авторизация не ослаблялась. Download scan всё так же доступен owner student/current expert/ADMIN по существующей policy.

[openapi-contract.test.ts](../test/openapi-contract.test.ts) генерирует весь документ из **compiled controllers** со stub dependencies (без обращения к внешним сервисам), проверяет paths/response fields/security, отсутствие ложных OTP success responses и разрешимость всех schema references. Финальный документ: **223 paths, 102 named schemas** плюс inline responses. Artifact сохраняется как `oxus-phase4-openapi.json` в OS temp directory. Это contract-generation test; реальные guards и response behaviour дополнительно проверяются HTTP integration suites.

## R06 — FreedomPay

Повторно сверены официальные [Merchant API / Приём](https://freedompay.kz/docs/merchant-api/pay) и [Create payment](https://docs.freedompay.kz/api-11620859). В Merchant API `pg_request_method` задаёт метод обращения к Check URL/Result URL; документированный вариант — POST. В примерах init/frame он входит в подписываемый набор.

В init заменён **только** `Pg_result_url_method` на `pg_request_method: "POST"`. Неподдерживаемое старое поле не дублируется. Signature canonicalization получает окончательный набор полей, включая pg_request_method, до построения FormData. Unit test независимо считает MD5 от отсортированных значений, имени init_payment.php и synthetic secret, а не вызывает production signature helper для expected value. Modes 0/1 проверены отдельно.

Runtime callback уже объявлен POST `/api/v1/payment/freedompay-webhook`; его raw scalar parsing, verification и signed XML ACK сохранены. F01 проверяет POST form callbacks и rejects; R01 повторно проверяет compiled service внутри local/server Compose containers. Старые неизвестные signed callback extension fields по-прежнему участвуют в подписи: удаление неправильного init field не вводит whitelist для callback.

Реального merchant request не было. Backend request соответствует проверенному provider contract, но доставка конкретного merchant callback, networking, кабинет провайдера и фактический payment lifecycle требуют отдельного E2E.

### Staging E2E checklist — не выполнялся в этой фазе

1. На изолированном staging merchant проверить effective FREEDOM_TESTING_MODE=1 в процессе, корректные merchant/result URL и receiving secret без вывода секрета.
2. Создать тестовый order разрешённым student-like account. Проверить init request: pg_request_method=POST, testing mode=1, правильные currency/amount и результат signature calculation.
3. Провести провайдерский test payment, проверить фактический POST на точный HTTPS Result URL; отличать callback от browser success redirect.
4. Проверить signed XML ACK, корректный SUCCESS ledger и положенные legacy effects либо manual ledger-only policy. Сопоставить provider/order reference и сумму/валюту.
5. Повторить callback и параллельную доставку: нет повторных benefits/events. Неверные signature/mode/result/amount/currency не меняют state.
6. Проверить late/retry delivery, доступность Result URL, content type и gateway retry behaviour; сохранить redacted evidence с timestamps/order IDs.
7. Зафиксировать результат merchant E2E перед production decision. Переключение production merchant на mode=0 — отдельное контролируемое действие, не часть unit tests или этой работы.

## R07 — pagination и performance

Frontend source в этом repository не найден. Изучены backend callers, tests, документация и имеющиеся page conventions. Для generic contracts использован формат admin finance/analytics `data + total + page + totalPages` с additive limit. Для earnings сохранён существующий contracts array, ограниченный страницей, с metadata на верхнем уровне.

- Общий [PageQueryDto/pageBounds](../src/common/dto/page-query.dto.ts): default page=1, limit=20; 1 ≤ limit ≤ 100; positive safe integer page/offset. Невалидные значения → 400 и при HTTP, и при direct service call. Unlimited/legacy mode не добавлен.
- Contract list сохраняет status filter и contractAccessWhere. Порядок `createdAt DESC, id DESC`; одинаковые timestamps больше не дают неопределённого порядка.
- Earnings details используют те же page bounds и stable order. Totals/allContracts не зависят от страницы и считают весь набор historical signedByUserId.
- [expertEarningsTotalsQuery](../src/modules/admin/finance-earnings.query.ts) агрегирует receipts в PostgreSQL, затем группирует деньги по currency. В Node передаются currency groups, а не 40000 contracts/60000 installments для totals. Details загружают installments только текущей страницы.
- F07 сохранён: receipt sum имеет приоритет над fallback whole PAID price; нет двойного учёта; SIGNED unpaid = price − paid; mixed-currency scalars null; пустой набор даёт прежние нули/null currency.

### Измерения на одной synthetic volume DB

Данные: **40000 contracts, 60000 installments**, 20000 KZT / 10000 USD / 10000 EUR; historical signer expert один. База создана для прежнего audit, production не использовался. Node 22.15.1, локальный PostgreSQL 16, arm64. BEFORE service measurements сняты до production edits. AFTER повторяет те же entry points.

| Entry point | Rows BEFORE → AFTER | JSON bytes BEFORE → AFTER | Heap delta MiB BEFORE → AFTER | Service latency ms BEFORE → AFTER |
|---|---|---|---|---|
| Contracts default | 40000 → 20 | 33506687 → 17181 | 150.51 → 1.91 | 949.97 → 352.22 |
| Earnings default | 40000 → 20 | 20677103 → 10963 | 245.05 → 1.43 | 1185.62 → 135.70 |
| Contracts limit=100, AFTER | 100 | 85717 | 2.99 | 250.33 |
| Earnings limit=100, AFTER | 100 | 52979 | 3.56 | 108.45 |

Это разовые наблюдения, не SLO/load-test. Heap — heapUsed delta после GC перед запросом и до сериализации, не peak/RSS. Числа latency зависят от cache/нагрузки. Бounded response и точные totals дополнительно проверяются assertions, а не только по одному timing.

Query logging и `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`:

| Проверка | BEFORE SQL replay | AFTER |
|---|---|---|
| Contract SELECT | 40000 rows, 237.83 ms server execution | limit 20: 20 rows, 60.92 ms; limit 100: 100 rows, 64.16 ms |
| Contract count | отсутствовал | 1 aggregate row, 261.23/252.29 ms для actor-filtered 40000; SQL считает весь scope |
| Earnings Contract SELECT | 40000 rows, 48.13 ms | 20 rows / 40.23 ms; 100 rows / 27.78 ms |
| Earnings installments | 60000 rows, разбитые Prisma на 2 IN-batches | 60/300 rows на страницах 20/100 |
| Earnings totals query | totals считались в Node | 3 currency rows, 93.09/89.76 ms |
| Client SQL time sum, contracts | 450.82 ms | 316.21 ms default; 239.75 ms max page |
| Client SQL time sum, earnings | 552.26 ms | 131.13 ms default; 105.50 ms max page |
| SELECT query count contracts | 7 с relation batches | 7 для page size 20 **и** 100 |
| SELECT query count earnings | 8 с relation batches | 6 для page size 20 **и** 100 |

Для SQL comparison исходные projection/include/predicates дополнительно повторены read-only после AFTER; это replay старого SQL, а не повторная смена production implementation. Service BEFORE bytes/heap/latency остаются исходными pre-edit measurements. Count и aggregate требуют обработки matching данных в PostgreSQL, но не загружают их в Node. N+1 отсутствует: SELECT count не растёт с количеством строк страницы; relations Prisma получает пакетами.

Постоянный тест отдельно создаёт 40000 student contracts/60000 installments в свежей migrated DB, выполняет ANALYZE после bulk loading и проверяет page bounds, JSON size и точные mixed-currency totals. Первая диагностическая попытка без свежей статистики выявила плохой planner plan и transaction expiration; это исправлено подготовкой synthetic fixture, без увеличения production timeouts или отключения query planner features.

Воспроизводимый read-only measurement tool: [phase4-performance.cjs](../test/performance/phase4-performance.cjs). Он требует localhost/127.0.0.1 и `_test` DB, минимум 40000/60000 данных и `--expose-gc`, логирует действительные Prisma SQL и проверяет постоянное query count между page sizes.

```sh
# DATABASE_URL — только локальная synthetic *_test БД с подготовленным объёмом.
PHASE4_PERF_EXPERT_ID=100001 node --expose-gc test/performance/phase4-performance.cjs
```

## API compatibility / frontend migration

| Endpoint/consumer | Изменение | Что сделать frontend |
|---|---|---|
| GET `/contracts` | **Breaking response shape**: раньше Contract[], теперь `{data,total,page,limit,totalPages}`. Default 20, max 100, stable order; invalid status/page/limit → 400. | Читать `response.data`; хранить page/limit, передавать status на каждой странице. Использовать total/totalPages, не длину массива как общий count. |
| GET `/admin/finance/experts/:id/earnings` | `expert`, `totals`, `contracts` сохранены; additive total/page/limit/totalPages. **Breaking completeness**: contracts теперь страница, не весь набор. | Пагинировать contracts; использовать totals/byCurrency сервера, никогда не вычислять общий доход суммой текущей страницы. |
| Analytics summary/funnel/events/journey | Форматы сохранены. Corrective semantic change: SCHOOLBOY включён, deleted role исключён, lost cohort согласована, paid/converted больше не lost. | Ожидать исправленные counts/visibility; summary даты — registration cohort, events даты — occurrence window. |
| Finance scalars/byCurrency | Runtime F07 semantics не менялись; теперь явно описаны nullable поля. | Обрабатывать null scalars при mixed currencies и показывать byCurrency. |
| Prepare/manual/detail/scans | Runtime shapes не менялись; OpenAPI стал точнее. | Prepare может вернуть contract=null и draft; не считать подпись оплатой/конверсией. Для scans использовать multipart/binary. |
| OTP routes | Runtime не менялся: 409; документация deprecated и без advertised success. | Использовать manual routes, не строить online signing по старой Swagger-схеме. |
| Swagger-generated clients | Новые response types, nullable fields, pagination, binary и provider callback schemas меняют generated declarations. | Перегенерировать и проверить consumers; не трактовать webhook как frontend payment confirmation API. |
| FreedomPay init | Provider-facing исправление имени поля; frontend payment initiation response не менялся. | Frontend изменений не требует. |

Для перехода не нужен временный unlimited endpoint. Если UI действительно должен пройти весь набор, он последовательно запрашивает ограниченные страницы; default response всегда bounded. Offset pagination стабильно сортируется при фиксированных данных, но не является snapshot across requests: при одновременной вставке возможен обычный сдвиг offset. Экспорт/новая cursor API здесь не добавлялись.

В repository найдены и обновлены два test consumers старого array response: Phase 1 ownership assertions и sales V2 middlename assertion. Проверяемые business/security условия сохранены. Внешний frontend не находится в workspace, поэтому совместный rollout должен учитывать описанные breaking changes.

## Regression baseline

| Baseline | Повторённые гарантии | Результат |
|---|---|---|
| F01 | Signature/raw fields, result/capture, amount/currency/mode, XML ACK, неизвестные signed extensions | PASS |
| F02 | Duplicate/concurrent callbacks, providerRef cross-order, rollback, historical SUCCESS, manual ledger-only | PASS |
| F03/F06 | Ownership/permissions/live roles, direct domain calls, ADMIN, deleted actors | PASS |
| F04 | Contract uniqueness, numbering, generic-vs-CRM races | PASS |
| F05 | Transfer, current expert access/payment/scan, preserved historical signer | PASS |
| F07 | Currency-aware finance, Decimal receipts, no double counting, nullable totals | PASS |
| F08 | Journey atomicity/retry, occurredAt, backdated/null duration, migration repeatability | PASS |
| F09/F10 | Summary/list filters, ADMIN matrix и business restrictions | PASS |
| F11 | Demo, Redis, migrations/schema diff, CI integration gate | PASS |
| R01 | Real container env modes 0/1/invalid/empty/default, init/verifier agreement | PASS |
| R02 | Historical benefits fail-closed / consumed valid package / new installments / ADMIN / no mutation / read-only audit | PASS |
| R08 | Shared paid-tier invariant, FREE rejection, direct/ADMIN/metadata/draft paths | PASS |

Phase 3 commercial/schedule/historical-benefits policy не перерабатывалась. Cambridge, refunds, e-signature, DIRECTOR permissions, schema/migrations и production data не менялись. Callback settlement implementation и shared signature canonicalization сохранены; FreedomPay production change ограничен одним init parameter.

## Test evidence

Финальный gate, без суммирования повторных запусков:

| Suite/check | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Jest, 39 suites, включая 2 R06 cases | 270 | 0 | 0 |
| Phase 4 reporting/roles/pagination/volume/snapshot | 12 | 0 | 0 |
| Generated OpenAPI contract | 7 | 0 | 0 |
| Phase 3 blockers | 17 | 0 | 0 |
| Admin expert profiles | 11 | 0 | 0 |
| Phase 1 security | 28 | 0 | 0 |
| Phase 2 reporting | 18 | 0 | 0 |
| Phase 2 journey migration | 1 | 0 | 0 |
| Manual HTTP | 11 | 0 | 0 |
| Sales contract reliability | 12 | 0 | 0 |
| Sales V2 HTTP | 9 | 0 | 0 |
| Expert visibility | 6 | 0 | 0 |
| Sales V2 regression | 40 | 0 | 0 |
| Call notifications | 9 | 0 | 0 |
| Lead status migration | 1 | 0 | 0 |
| Demo | 1 | 0 | 0 |
| **Integration subtotal** | **183** | **0** | **0** |
| Deployment Python | 21 | 0 | 0 |
| Smoke script scenarios, отдельно | 11 | 0 | 0 |

**474 формальных теста + 11 smoke-сценариев.** 10 runtime mode subcases входят в один deployment test и повторно не прибавлены. BEFORE red expectations и диагностические запуски не включены в final totals.

PASS: Nest build; `tsc --noEmit`; полный ESLint без --fix, 0 errors/warnings; оба Compose config checks; shell syntax; git diff --check. Runner создал **16 чистых DB**, применил **42 migrations** на каждой, получил **16 × No difference detected**, затем удалил свои DB. Новые integration/OpenAPI tests включены в существующий runner quality gate; Jest автоматически включает R06 spec. Hosted CI не запускался, локально выполнены его проверки.

Промежуточные проблемы не скрыты: stale bulk-fixture statistics исправлены через ANALYZE; один неполный gate столкнулся с отсутствующим dist module при одновременном build. Финальный gate выполнен после завершённой сборки и прошёл целиком. Ошибки типов/линтера в новых test/schema helpers устранены до final validation.

Команды воспроизведения:

```sh
./node_modules/.bin/nest build
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint '{src,apps,libs,test}/**/*.ts'
./node_modules/.bin/jest --runInBand
# DATABASE_URL: disposable local *_test; SALES_V2_TEST_REDIS_URL: local Redis.
node test/run-integration.mjs
python3 -m unittest discover -s deployment/tests -v
docker compose -f compose.yaml config --quiet
docker compose --env-file deployment/.env.example -f deployment/compose.yaml config --quiet
git diff --check
```

Evidence этой сессии: `/private/tmp/oxus-phase4-before-analytics.log`, `oxus-phase4-before-freedom.log`, `oxus-phase4-before-performance.json`, `oxus-phase4-build.log`, `oxus-phase4-types.log`, `oxus-phase4-lint.log`, `oxus-phase4-unit.log`, `oxus-phase4-integration-final.log`, `oxus-phase4-deployment.log`, `oxus-phase4-baseline-sql.json`; OpenAPI и full AFTER plans — `oxus-phase4-openapi.json` / `oxus-phase4-performance-after.json` в OS temp directory. Постоянные tests и benchmark tool находятся в repo.

## Итог / Final Candidate Gate

1. **R03 PASS** — единая registration cohort, paid/converted исключены из lost, snapshot consistency.
2. **R04 PASS** — поддерживаемые student-like роли видимы в analytics без глобальной смены role model.
3. **R05 PASS** — generated OpenAPI проверен на нужных runtime contracts/security.
4. **R06 PASS для backend fix**; **provider E2E не подтверждён** без реального staging merchant. Checklist выше обязателен для внешнего interoperability verdict.
5. **R07 PASS** — bounded default/max, SQL totals, stable pagination и проверенные 40000/60000 measurements.
6. В проверенном scope **незакрытых подтверждённых backend technical blockers не обнаружено**. Это не утверждение об отсутствии любых дефектов во всём проекте. Historical data review из R02, merchant E2E и frontend migration остаются release conditions.
7. **Можно переходить к Final Candidate Gate**, включив эти условия в окончательную проверку. Готовность к этому gate не означает автоматическое разрешение на deployment.
