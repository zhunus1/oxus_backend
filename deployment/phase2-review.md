# Phase 2 — F07–F11

Дата: 28 сентября 2026. Изменения выполнены относительно завершённой Phase 1; исходные файлы зафиксированы хешами до начала работы. Commit, push и deployment не выполнялись. Production DB и реальные SMTP/S3/FreedomPay не использовались.

## Findings

| Finding | Before | Root cause | Fix | Regression test | After |
|---|---|---|---|---|---|
| F07 | `500000 KZT + 100 USD + 200 EUR` возвращались как `totalPaidAmount: 500300`. | Суммы группировались по эксперту/статусу без валюты; итоговые earnings повторяли смешение. | Группировка денег по currency, Decimal arithmetic, `byCurrency`; scalar money totals становятся null при нескольких валютах. | Mixed KZT/USD/EUR, legacy SIGNED/PAID, manual installments, точные дроби, полный расчёт без двойного начисления, пустой эксперт. | **PASS** |
| F08 | После manual confirmation у созданного студента было 0 journey events. | Manual transaction не записывала события; analytics использовала createdAt и считала платежные события вместо уникальных студентов. | Атомарные milestones, отдельные последующие транши, occurredAt, безопасные duration metrics, backfill подтверждённых исторических фактов. | FULL/INSTALLMENT, concurrent/retry, backdating, исторические события, rollback при ошибке event insert, повторный backfill. | **PASS** |
| F09 | При search без совпадений SIGNING list total=0, summary SIGNING=1. | Summary не принимала фильтры и строила отдельный where. | Общий filter builder и DTO search/source для summary. | 24 комбинации search/source × 6 табов, ownership, deletedAt, pagination и overlapping CONTRACTS. | **PASS** |
| F10 | ADMIN мог работать с договором, но PATCH unsigned CRM metadata возвращал 403. | В общей policy оставалось отдельное ограничение CRM metadata; fallback для unassigned договора мог приписать сделку ADMIN. | Убрано только исключение CRM metadata; administrative authority отделена от attribution, исключён fallback на ADMIN как эксперта. | Полная HTTP-матрица owner/foreign/ADMIN для CRM/non-CRM, finalized terms, duplicate create, ordering, deleted records/account, unassigned student. | **PASS** |
| F11 | Demo-test падал на старом summary без SIGNING/SIGNED; quality job не имел PostgreSQL/Redis integration gate. | Fixtures отражали account-before-payment; CI запускал только Jest. | Demo drafts/signature/payment, сильные assertions; services PostgreSQL/Redis, отдельная чистая DB на suite, migrations/schema diff и полный integration runner в quality. | Demo 1/1, весь CI runner локально, YAML parse, shell syntax, deployment unit tests. | **PASS** |

До исправлений новые воспроизведения F07–F10: **0 passed / 4 failed**. Отдельно существующий demo-test F11: **0 passed / 1 failed**. Отсутствие CI services/integration step подтверждено чтением workflow. После исправлений те же четыре сценария входят в постоянный зелёный набор.

## Изменённые файлы

- **F07:** `src/modules/admin/finance.service.ts`, `src/modules/admin/admin.controller.ts`, `deployment/audits/phase2-currencies.sql`; финансовые assertions в `test/manual-contract-http.test.ts` теперь выбирают KZT явно.
- **F08:** `src/prisma/schema.prisma`, миграции `20260928150000_journey_occurred_at` и `20260928151000_backfill_manual_journey`; `src/modules/contract/domain/contract-journey.ts`, `manual-contract-confirmation.ts`, `src/modules/contract/service/manual-contract.service.ts`; `src/modules/user-journey/user-journey.constants.ts`, `src/modules/admin/analytics.service.ts`, `src/modules/admin/api/dto/analytics-query.dto.ts`; `test/phase2-journey-migration.test.ts`.
- **F09:** `src/modules/lead/service/expert-lead.service.ts`, `src/modules/lead/api/expert-lead.controller.ts`, `src/modules/lead/api/dto/sales/expert-lead-query.dto.ts`.
- **F10:** `src/modules/contract/domain/contract-access.ts`, `src/modules/contract/domain/manual-contract-confirmation.ts`.
- **F11:** `src/prisma/seed/sales-expert-demo.seed.ts`, `src/prisma/seed/sales-expert-demo.plan.ts`, `test/sales-expert-demo.test.ts`, `test/run-integration.mjs`, `.github/workflows/ci.yml`, `package.json`.
- Общие постоянные HTTP/PostgreSQL regressions F07–F10: `test/phase2-reporting.test.ts` — 18 тестов. Отчёт: этот файл.

## Financial model

Глобальный поиск финансовых `_sum`, SQL SUM, totalPaidAmount/revenue/earnings и reduce по amount/price показал, что публичные агрегаты Contract/Installment находятся в FinanceService. Отдельного `totalRevenue` endpoint/aggregate в этом backend нет. Transaction хранит валюту каждого gateway order; его суммы не добавлены к Contract receipts, чтобы не считать один платёж дважды.

Read-only audit: [phase2-currencies.sql](audits/phase2-currencies.sql). Локальная сохранённая DB Phase 1 содержала KZT и исторические USD. Phase 2 regression dataset добавляет EUR, включая дробный manual legacy contract. Это данные изолированных локальных тестов, не утверждение о составе production DB.

Новые manual contracts по существующему domain rule по-прежнему стоят 1 500 000 KZT либо 750 000 KZT для Cambridge. Исторические KZT/USD/EUR поддерживаются. Ограничения цены, количества траншей и алгоритм расписания не менялись.

Каждый contract row сохраняет `currency`, `amount`, `paidAmount`, `remainingAmount`. При наличии installment schedule `paidAmount` — сумма только подтверждённых траншей. Для legacy договора без schedule: PAID означает paidAmount=price, остальные статусы — 0. В агрегате оплаченный manual договор учитывается по траншам один раз; к ним не прибавляется повторно полный price. `signedUnpaidAmount` — остаток договоров в SIGNED, не стоимость неподписанных drafts/pending contracts.

Все денежные группы включают currency. Суммы считаются в PostgreSQL numeric/Prisma Decimal и выдаются прежними JSON numbers внутри явно обозначенной валюты. Конвертация валют не введена. Идентификатор эксперта для earnings остаётся историческим `signedByUserId`, а не текущим portrait owner.

Семантика scalar totals:

- Пустая выборка: суммы 0, `currency: null`, `byCurrency: []`.
- Одна валюта договоров в выборке: scalar numbers сохранены, `currency` указывает валюту.
- Несколько валют: scalar money totals равны `null`; точные отдельные суммы находятся в `byCurrency`. Counts остаются числами.

**Это явное изменение типов number → number | null для mixed-currency responses.** Сохранить старый числовой итог без ложного смысла невозможно. Во frontend нельзя превращать null в 0 либо суммировать валютные группы.

## Analytics semantics

Новая nullable колонка `UserJourneyEvent.occurredAt` отделяет бизнес-дату от времени записи `createdAt`. Старые события остаются нетронутыми: effective timestamp = occurredAt ?? createdAt. Существующий FreedomPay processing Phase 1 не менялся; его события продолжают использовать legacy fallback.

| Event | Когда создаётся | occurredAt | Кратность |
|---|---|---|---|
| CONTRACT_SIGNED | При первом manual confirmation, когда User уже существует внутри transaction | Фактический signedAt | Первый milestone студента; существующий исторический event сохраняется |
| PAYMENT_COMPLETED | Первый подтверждённый manual payment | Фактический paidAt первого транша/полной оплаты | Первый payment milestone студента |
| LEAD_CONVERTED | При переводе связанного Lead в CONVERTED | Время подтверждения конверсии | Однократно при переходе |
| CONTRACT_INSTALLMENT_PAID | Подтверждение следующего транша | paidAt этого транша | Один event на подтверждение транша; одинаковый retry не создаёт event |

Подпись draft без оплаты не создаёт UserJourneyEvent: User ещё нет. Сохранённый signedAt переносится в событие только при confirmation. Все новые события записываются в существующей Serializable transaction с User/Contract/Installment/Lead; принудительная ошибка PAYMENT_COMPLETED откатывает всю операцию. Повторы и конкурентные запросы сохраняют защиту Phase 1. Новые внешние side effects/outbox не добавлены.

PAYMENT_COMPLETED в analytics означает достижение первой оплаты, поэтому следующие installments имеют другой eventType. `paymentsCompletedCount` и `conversionToPaymentPercent` считают уникальных студентов с payment milestone; повторные исторические/gateway payment events не увеличивают conversion выше 100%. AverageDaysToPayment использует первое событие каждого студента.

Для backdated payment occurredAt может быть раньше User.createdAt — событие физически записывается после создания User, но отражает ранее произошедшую оплату. Такая длительность от регистрации не определена и исключена из average. Отрицательные stage durationMs/durationDays возвращаются как null, а не как отрицательное число или выдуманный ноль. Фактический paidAt не заменяется временем API.

Journey/events responses сохраняют createdAt и дополнительно возвращают effective occurredAt. Порядок пагинации событий по createdAt сохранён; duration calculations используют бизнес-хронологию. `/admin/analytics/events` dateFrom/dateTo фильтруют effective occurredAt, без одновременного ограничения User.createdAt — иначе историческая оплата нового аккаунта исчезала бы из выдачи. Country/educationLevel сохраняются. У summary/funnel date filters остаются фильтрами student registration cohort. ProcessStep образовательной воронки не менялся на основании оплаты.

Вторая миграция восстанавливает milestones и оплаченные последующие installments из сохранённых manualConfirmedAt/studentSignedAt/paidAt/convertedAt. Неподтверждённые drafts не порождают аккаунтов или событий. Существующие события не переписываются; повторный SQL не создаёт дубли. Для первого milestone выбирается первый известный факт пользователя, включая защиту от исторических duplicate contracts. Даты регистрации и платежей не изменяются. Миграция выполняется атомарно.

## Dashboard semantics

Выбрано **B: counters отражают текущие search/source**, как требует исходный продуктовый запрос. Отдельного frontend-кода с противоположным контрактом в репозитории нет. Backend/manual-contracts API уже закрепляет новые SIGNING/SIGNED и legacy CONTRACTS.

List и summary используют один filter builder: assignedExpertUserId, deletedAt=null, source code, одинаковый trim/search по имени/email/телефону. Summary считает весь отфильтрованный таб, а не размер текущей страницы. Параметры tab/page/limit не сужают summary до одного таба. Без filters поведение прежнее.

| Counter | Lead statuses |
|---|---|
| NEW | CALL_SCHEDULED, OFFICE_INVITED |
| FOLLOW_UP | RECALL |
| SIGNING | CONTRACT_PENDING |
| SIGNED | CONVERTED |
| CONTRACTS | CONTRACT_PENDING, CONVERTED |
| ARCHIVE | REJECTED, NEW |

Всегда `CONTRACTS = SIGNING + SIGNED`. Это совместимый legacy counter, а не дополнительная независимая группа. Frontend должен отправлять одинаковые search/source в list и summary, и не складывать CONTRACTS с SIGNING/SIGNED. Ответы list и summary сохраняют форму и названия полей.

## ADMIN authorization matrix

Фактическая матрица до Phase 2 (при допустимом состоянии договора и активных аккаунтах):

| Operation | EXPERT owner с permission | EXPERT foreign | ADMIN |
|---|---|---|---|
| Read contract | Да | Нет | Да |
| Update unsigned terms | Да | Нет | Да для non-CRM; 403 для CRM другого эксперта |
| Manual signature | Да | Нет | Да |
| Confirm payment | Да | Нет | Да |
| Confirm installment | Да | Нет | Да |
| Upload scan | Да | Нет | Да |
| Download scan | Да | Нет | Да |

Финальная матрица:

| Operation | EXPERT owner | EXPERT foreign | ADMIN |
|---|---|---|---|
| Read contract | Да | Нет | Да |
| Update unsigned terms | Да, с permission | Нет | Да |
| Manual signature | Да, с permission | Нет | Да |
| Confirm payment | Да, с permission | Нет | Да |
| Confirm installment | Да, с permission | Нет | Да |
| Upload scan | Да, с permission | Нет | Да |
| Download scan | Да | Нет | Да |

Permission — активная EXPERT_LEAD_CALLS_RESPOND. Ownership и pre-assignment fallback Phase 1 сохранены. ADMIN получает administrative access только на уже объявляющих ADMIN contract routes. `/expert/leads/...` остаются EXPERT-only. Роль DIRECTOR не добавлена.

ADMIN проходит проверки живого account/role, Student/Lead и бизнес-инвариантов. Нельзя поменять finalized terms, создать второй договор, пропустить транш, подтвердить неправильную сумму или получить доступ к deleted Lead/Student. Автор фактического действия сохраняется в auditLog/confirmedByUserId/eventData; он не заменяет historical owner. У unassigned non-CRM договора ADMIN не записывает себя в signedByUserId и не получает consultant assignment. Existing historical attribution не переписывается.

## API compatibility / изменения для frontend

Все URL ниже имеют прежний префикс `/api/v1`.

| API | Изменение |
|---|---|
| GET /admin/finance/summary | Добавлены currency, byCurrency, signedUnpaidAmount. totalSignedAmount/totalPaidAmount теперь number или null при mixed currencies. То же представление добавлено в earningsByExpert[]. Counts и expertOptions сохранены. |
| GET /admin/finance/experts/:id/earnings | totals содержит currency и byCurrency[{currency,paidAmount,signedUnpaidAmount}]. Scalar totals.paidAmount/signedUnpaidAmount nullable для mixed currencies. contracts[] сохраняется. |
| GET /admin/finance/contracts | Request/response shape сохранён; каждая строка уже содержит currency. |
| GET /expert/leads | Request/response shape сохранён. |
| GET /expert/leads/summary | Добавлены optional query search/source с теми же валидацией и семантикой, что у list; ответ сохраняет шесть counters. |
| Contract ADMIN routes | Shapes сохранены; допустимый PATCH unsigned CRM metadata теперь 200 вместо прежнего ошибочного 403. ADMIN не приписывает договор себе. |
| GET /admin/analytics/events | Добавлен occurredAt, dateFrom/dateTo теперь относятся к дате события без registration-date intersection. Добавлены event types LEAD_CONVERTED и CONTRACT_INSTALLMENT_PAID. |
| GET /admin/analytics/student/:id/journey | events[].occurredAt добавлен; невозможные отрицательные durations возвращаются null. |
| GET /admin/analytics/summary | Shape сохранён; paymentsCompletedCount/conversion считают студентов с первой оплатой, durations — первую бизнес-дату. |

Пример mixed financial summary (фрагмент):

```json
{
  "currency": null,
  "totalSignedAmount": null,
  "totalPaidAmount": null,
  "signedUnpaidAmount": null,
  "byCurrency": [
    {"currency":"KZT","totalSignedAmount":1500000,"totalPaidAmount":500000,"signedUnpaidAmount":1000000},
    {"currency":"USD","totalSignedAmount":150,"totalPaidAmount":100,"signedUnpaidAmount":50}
  ]
}
```

Frontend: отрисовать каждую валюту отдельно; обновить nullable types и не форматировать null как 0; передавать одинаковые filters в list/summary; учитывать overlapping counters; использовать occurredAt для фактической даты и createdAt для времени записи; добавить подписи двух новых event types. Цена, payment DTO, installment schedule, account creation и OTP policy не менялись.

## CI release gate

Quality job получает PostgreSQL 17 и Redis 7 services с health checks и локальными портами. Конфигурация сверена с официальными примерами [PostgreSQL services](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) и [Redis services](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-redis-service-containers). Реальные provider secrets отсутствуют.

После install/generate/lint/Jest/build выполняются tsc и `yarn test:integration`. Runner создаёт уникальную пустую local *_test DB на каждый suite, выполняет migrate deploy и schema diff, запускает suite, затем удаляет только созданную им DB. Это устраняет зависимость результатов от оставшихся fixtures и mutations общих ролей. Redis queues используют существующие уникальные префиксы suites. Отсутствие Redis URL — ошибка, не skip.

В gate подключены:

1. phase1-contract-security — 28 tests.
2. phase2-reporting — 18 tests.
3. phase2-journey-migration — 1 test.
4. manual-contract-http — 11 tests.
5. sales-contract-reliability — 12 tests.
6. sales-expert-v2-http — 9 tests.
7. expert-lead-visibility-http — 6 tests.
8. sales-expert-v2-regression — 40 tests, включая реальный Redis outage/recovery.
9. lead-call-notifications — 9 tests.
10. lead-status-migration — 1 test.
11. sales-expert-demo — 1 комплексный test.
12. sales-expert-v2-smoke — 11 scenarios.

Security tests используют локальные подписанные FreedomPay payloads с test secret. S3 transport заменён mock, HTTP/authorization/DB реальны. SMTP/realtime изолированы. Ошибка runner даёт nonzero exit и блокирует quality; docker и production jobs уже зависят от quality, test deploy зависит от docker. Цепочка release gate сохранена.

Demo теперь создаёт draft для всех трёх contract scenarios: unsigned draft, signature без оплаты/аккаунта, confirmed full payment с одним аккаунтом и PAID договором. Проверяются actual receipt, package, journey и counts. Preview, atomic failure, concurrency, сохранение прогресса и разные пары Sales/Expert остались в тесте. Старые demo batches не переписываются; legacy pending contract completion отдельно покрывается manual HTTP suite.

Workflow разобран YAML-парсером; services/steps/needs проверены, все run-блоки прошли bash -n. Runner проверен node --check и реально выполнен локально. Новый workflow **не запускался на GitHub**, поскольку commit/push запрещены задачей; remote success не заявляется.

## Validation / Regression

| Проверка | Passed | Failed |
|---|---:|---:|
| BEFORE F07–F10 | 0 | 4 ожидаемых воспроизведения |
| BEFORE demo F11 | 0 | 1 ожидаемое воспроизведение |
| Jest unit suite | 263, 38 suites | 0 |
| Финальный CI integration runner | 136 | 0 |
| Дополнительный smoke внутри runner | 11 scenarios | 0 |
| Deployment Python tests | 18 | 0 |
| Повтор Phase 2 после расширения валютных assertions | 18, входят в 136 выше | 0 |

У integration runner 0 skipped. Без двойного учёта повторных прогонов: **417 автоматических tests passed / 0 failed**, плюс **11 smoke scenarios passed / 0 failed**.

Nest build, tsc --noEmit, ESLint без --fix, git diff --check — exit 0. Каждая из 12 чистых DB прошла migrate deploy и schema diff (`No difference detected`). Backfill повторён на существующих synthetic records отдельным regression test, без дублей и изменения legacy event. Весь исходный Phase 1 test file сохранён без изменений и прошёл 28/28.

Проверка хешей подтверждает, что FreedomPay signature/settlement, contract-creation locking, lead-transaction retry, manual price/schedule rules и LeadContractService остались baseline Phase 1. Намеренные изменения общей contract boundary ограничены F08 events и F10 ADMIN exception/attribution. Four OTP routes остаются закрытыми.

Локальные артефакты в `/private/tmp/`: `oxus-phase2-before-tests.log`, `oxus-phase2-before-demo.log`, `oxus-phase2-final-integration.log`, `oxus-phase2-reporting-final.log`, `oxus-phase2-unit.log`, `oxus-phase2-deployment-tests.log`, `oxus-phase2-build.log`, `oxus-phase2-types.log`, `oxus-phase2-lint.log`, `oxus-phase2-currencies.log`. Это временные логи; постоянные regression tests и результаты сохранены в репозитории.

Для повторения локально: задать DATABASE_URL на disposable local *_test PostgreSQL и SALES_V2_TEST_REDIS_URL на отдельный local Redis; затем `yarn prisma generate`, `yarn build`, `yarn tsc --noEmit`, `yarn lint`, `yarn test --runInBand`, `yarn test:integration`. Runner требует пользователя БД с CREATE DATABASE для изоляции suites.

## Release coordination и границы проверки

Две новые миграции нужно применить до приложения с occurredAt. Они не удаляют данные. При откате приложения additive column/events могут оставаться в БД; удалять восстановленную историю для rollback не требуется. Необходимо согласовать migration/application cutover: если старые workers ещё принимают manual confirmations после backfill, повторить идемпотентный backfill SQL после их остановки, чтобы не оставить окно отсутствующих событий.

Nullable finance totals и event date filtering требуют описанных frontend изменений до production rollout. Реальный frontend здесь не редактировался и не проверялся. Production historical-data inventory и provider staging E2E из Phase 1 остаются проверками окружения для release-readiness audit, а не выполненными действиями этой фазы.

## Remaining business decisions

- Финальное подтверждение директором равных траншей и коммерческих ограничений количества.
- Правила изменения согласованного графика, частичных/избыточных платежей, возвратов и просрочки.
- Сверка in-flight gateway receipts с manual ledger.
- Требуется ли единая управленческая валюта; если да — источник курсов и правила conversion. Сейчас суммы корректно разделены, технический дефект смешения закрыт.
- Отдельные права DIRECTOR и будущая электронная подпись.

## Вывод

**F07 PASS · F08 PASS · F09 PASS · F10 PASS · F11 PASS. F01–F06 остаются PASS.**

Открытых подтверждённых технических blockers в объёме Phase 2 не осталось. Можно переходить к финальному release-readiness audit. Production release ещё требует frontend coordination, controlled migration cutover и проверки реального окружения/провайдера; эти действия не подменены локальными тестами. Commit и deployment не выполнялись.
