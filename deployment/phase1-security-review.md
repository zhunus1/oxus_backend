# Phase 1 — F01–F06

Проверка и реализация: 28 сентября 2026. Все шесть findings воспроизведены до изменения production-кода. Исправления проверены на локальных PostgreSQL/Redis; production и реальный merchant FreedomPay не использовались. Commit и deployment не выполнялись.

В рабочем дереве уже находилась реализация manual contracts. Изменения этого этапа сравнивались с хешами файлов на начало работы, а не только с HEAD. Схема, существующие миграции, цены Cambridge, расчёт рассрочки и табы в Phase 1 не менялись.

## Результат

| Finding | Before | Fix | Permanent regression test | After |
|---|---|---|---|---|
| F01 | Невалидная подпись переводила Transaction в SUCCESS; проверка результата и суммы не защищала начисление. | Проверка исходных подписанных полей, receiving secret, результата/capture/context; сверка суммы и валюты с Transaction до эффектов. | `F01:*`: invalid signature/result/amount/currency, merchant/mode/capture, неизвестные подписанные поля, неизвестный order, valid payment и signed XML ACK. | PASS: отклонённые callbacks не изменяют БД; подтверждённый проходит. |
| F02 | Два concurrent callbacks и повтор начисляли 30 slots вместо 10; поздний failure мог изменить SUCCESS. | Serializable, блокировка provider payment и строки Transaction; все DB-эффекты одним commit. | `F02:*`: повторы, concurrency, SUCCESS→SUCCESS, поздний FAILED, cross-order replay, historical SUCCESS, forced rollback. | PASS: одно начисление, одна journey-запись, стабильный SUCCESS; retry после rollback работает. |
| F03 | Foreign EXPERT мог создать чужой non-CRM договор: HTTP 201 вместо 403. Отсутствие Lead обходило ownership. | Общая policy текущего владельца, DB-фильтрация списка и проверка изменяющих операций в transaction. | `F03:*`: CRM/non-CRM create/list/read/meta/signature/confirmation/scan; deleted student/lead, неверная роль и отсутствие владельца. | PASS: owner имеет доступ; foreign EXPERT получает 403, чужие строки исключены из списка. |
| F04 | Два concurrent POST создавали два Contract одному Student. `count + 1` не сериализовал номера. | Общая блокировка Student во всех writers + Serializable/retry. Для автоматического номера — advisory lock, пропуск занятых номеров и существующий UNIQUE. | `F04:*`: два generic POST, generic против CRM confirmation, занятый следующий номер и параллельные номера. | PASS: один договор; проигравшая операция получает conflict, номера различаются. |
| F05 | После transfer новый эксперт получал 403; исторический Lead assignment сохранял доступ старого. | Portrait assignment определяет operational access; Lead assignment и signedByUserId сохраняются как история. | `F05:*`: настоящий transfer, read/list, следующий транш, upload/download scan, запрет старому эксперту через generic и lead routes. | PASS: B продолжает договор; A теряет доступ к договору; историческая атрибуция остаётся A. |
| F06 | Без permission CRM confirm возвращал 403, generic confirm — 201. | Общая domain-проверка активного пользователя, роли, профиля и `EXPERT_LEAD_CALLS_RESPOND`; ADMIN определяется из БД. | `F06:*`: permission revoked/deleted, роль deleted, профиль inactive, пользователь deleted, оба HTTP paths и прямые service calls, ADMIN и поддельный isAdmin. | PASS: оба пути отклоняют запрещённую операцию; разрешённые эксперт/ADMIN работают. |

Тесты находятся в [phase1-contract-security.test.ts](../test/phase1-contract-security.test.ts): 28 тестов. Первые шесть сохраняют исходные сценарии воспроизведения. До исправления: **0 passed / 6 failed**. После: все эти сценарии проходят с защитными assertions.

## Причины, файлы и гарантии

### F01 — проверка FreedomPay

Файлы: `src/modules/billing/domain/freedom-signature.ts`, `billing/service/freedompay.service.ts`, `billing/api/payment.controller.ts`, `billing/service/payment.service.ts`, `billing/repository/payment.repository.ts` (пути с `billing/` начинаются от `src/modules/`); `.env.example`, `deployment/.env.example`.

Причина была на доверительной границе: подпись не останавливала обработку, а DTO преобразовывал/отбрасывал подписанные поля. Теперь boundary сохраняет scalar values до проверки, исключает только `pg_sig`, включает неизвестные поля и проверяет подпись constant-time сравнением. Например, `499.00` не превращается в `499` перед вычислением подписи.

Алгоритм flat-message подписи, script basename и назначение receiving/payout secrets подтверждены [официальным Merchant API intro](https://freedompay.kz/docs/merchant-api/intro). Значения `pg_result`, captured-платёж, test mode и signed XML ответ сверены с [официальным описанием платежей](https://freedompay.kz/docs/merchant-api/pay). Это проверка подписанного уведомления, без дополнительного server-to-server запроса статуса платежа.

Применяется fail-closed: неверная/отсутствующая подпись, неизвестный формат, неоднозначные повторяющиеся поля, неподдерживаемый payment method, failure/unfinished, не captured bankcard, неверный mode/merchant, отсутствующая конфигурация/order или несовпадение amount/currency не вызывают payment effects. `pg_merchant_id` проверяется при наличии; `pg_testing_mode` обязателен. XML/nested callback payloads не реализованы и отклоняются. Поддерживаются плоские form, multipart без файлов и JSON scalar fields.

API URL сохранён. Provider-facing ответ намеренно исправлен на HTTP 200 с подписанным XML ACK вместо старого JSON. DTO и ответы manual/frontend endpoints этим не меняются. Невалидный/failed callback не сохраняет FAILED: отсутствие доказанного success означает отсутствие мутаций, в том числе после ранее записанного SUCCESS.

### F02 — атомарное применение платежа

Файлы: `billing/repository/payment.repository.ts`, `billing/service/payment.service.ts`, `lead/domain/lead-transaction.ts`, `lead/domain/lead-transaction.spec.ts` под `src/modules/`.

Причина: read/check и несколько независимых writes позволяли повторное начисление и частично завершённую оплату. Теперь одна Serializable transaction держит advisory lock по merchant/payment ID и `FOR UPDATE` по order. Внутри неё проверяются сохранённые amount/currency/providerRef, обновляются subscription/package/Contract/journey и фиксируется SUCCESS.

Invariant: один provider payment не оплачивает два order; один order не принимает другой provider reference; успешная обработка выдаёт benefits один раз. Конкурентный проигравший повторяет transaction и видит сохранённый SUCCESS. Retry обрабатывает P2034/P2002 и raw-query P2010 с SQLSTATE 40001/40P01, после трёх неудачных попыток возвращается 409. Другие ошибки не маскируются retry.

Существующий SUCCESS не получает benefits повторно, даже если прежняя обработка была неполной. Если у такого order нет providerRef, валидный callback заполняет его под теми же блокировками; это закрывает последующее повторное использование reference без повторения business effects. Историческую неполную обработку требуется сверять отдельно, автоматически «доначислять» её небезопасно.

In-flight callback для manual contract остаётся gateway ledger entry: он не оплачивает manual installments и не выдаёт benefits повторно. Это прежняя граница двух механизмов учёта. В webhook нет внешних side effects, требующих нового outbox.

### F03/F05/F06 — общая авторизация

Общая policy: `src/modules/contract/domain/contract-access.ts`.

Точки применения:

- `contract/repository/contract.repository.ts`, `contract/service/contract.service.ts`, `contract/api/expert-contract.controller.ts`;
- `contract/domain/manual-contract-confirmation.ts`;
- `contract/service/contract-scan.service.ts`, `contract/api/contract-scan.controller.ts`;
- `lead/service/lead-contract.service.ts`, `lead/service/expert-lead.service.ts`, `lead/service/lead-student-invitation.service.ts`.

Эти пути находятся под `src/modules/`. Scan unit tests адаптированы в `contract/service/contract-scan.service.spec.ts`.

Operational owner — активный эксперт из `StudentPortrait.consultantProfileId`. Только когда portrait ещё отсутствует/не назначен, допустим fallback на assigned expert связанного активного Lead в `CONTRACT_PENDING`. Отсутствующий Lead и исторический `signedByUserId` сами по себе права не дают. Unassigned non-CRM договор доступен ADMIN и самому студенту для чтения; эксперт должен получить назначение обычным процессом.

Historical attribution — `Lead.assignedExpertUserId` и `Contract.signedByUserId`. Transfer их не переписывает. Новый эксперт использует contract routes для дальнейших действий; CRM-назначение не переносится задним числом. Старому эксперту закрыто и получение linked contract через detail/prepare/confirm/resend invitation.

Read/list требуют допустимой роли и ownership. Изменяющие операции дополнительно требуют активную `EXPERT_LEAD_CALLS_RESPOND`. Проверка находится в общей domain boundary, включая вызовы без controllers. Deleted actor/role/permission, inactive expert profile, deleted student/lead и неподходящая student role не дают доступа. ADMIN authority читается из БД, переданный boolean не повышает права. Более широкая ADMIN-policy не менялась: существующее ограничение ADMIN на CRM metadata осталось для F10.

Проверки мутаций выполняются внутри Serializable transaction, поэтому конкурентные изменения проходят как упорядоченные операции либо конфликтуют и повторяются. Scan upload проверяет доступ до внешнего I/O и повторно перед записью audit/key; I/O не повторяется внутри DB retry. SQL-фильтрация list предотвращает загрузку чужих договоров. URL, request/response shapes и student self-read сохраняются; доступ посторонних намеренно ограничен.

### F04 — один договор ученика

Файлы: `src/modules/contract/domain/contract-creation.ts`, `contract/repository/contract.repository.ts`, `lead/service/lead-contract.service.ts` под `src/modules/`, плюс `src/prisma/seed/sales-expert-demo.seed.ts`.

Фактический invariant существующего кода — **один Contract на Student независимо от статуса**, а не один активный. Schema имеет UNIQUE на `contractNumber`, но не на `studentId`. Добавлен общий `lockStudentWithoutContract`: row lock User, проверка любого существующего Contract, создание в той же Serializable transaction. Все три найденных writers используют его. В demo добавлены только import и вызов блокировки; его бизнес-данные и старые test expectations не исправлялись.

Автоматический номер сохраняет формат `OXUS-год-порядковый номер`. Выделение сериализовано advisory lock; занятые номера пропускаются. Уникальность custom/CRM/demo номеров защищает существующий UNIQUE; конфликт не создаёт второй договор. Новые миграции и слепой UNIQUE(studentId) не добавлялись.

Read-only запросы: [phase1-contract-duplicates.sql](audits/phase1-contract-duplicates.sql). На `oxus_phase1_test` после BEFORE найден `studentId=8` с двумя договорами (`28638b19-b872-4fb7-9f57-75f82a22f950`, `442eeeaf-e0de-4076-9d40-0e523c266b56`). Это синтетический дубль, созданный воспроизведением F04. После исправлений остался только он; данные намеренно не удалялись. Дублей providerRef — 0. Production-аудит не проводился; перед rollout запрос следует выполнить на копии целевой БД.

## Сохранение manual flow

11 тестов `test/manual-contract-http.test.ts` проходят: prepare создаёт только draft; signature не создаёт User и не закрывает Lead; подпись и первый платёж атомарно создают Student/Contract; full payment даёт PAID; первый транш даёт SIGNED; последний — PAID; повтор/конкурентный confirm не дублируют данные; rollback не оставляет частичное состояние; четыре старых OTP HTTP routes закрыты. Дополнительно новый security test принудительно ломает позднюю запись auditLog и проверяет отсутствие User/Contract с последующим успешным retry.

В существующих integration fixtures добавлены нужные permissions и assignment для легитимного owner. Негативные assertions не удалялись. Это касается `test/manual-contract-http.test.ts`, `test/sales-contract-reliability.test.ts`, `test/sales-expert-v2-regression.test.ts`, `test/sales-expert-v2-smoke.ts`.

## Проверки и воспроизведение

| Проверка | Passed | Failed | Результат |
|---|---:|---:|---|
| Исходные воспроизведения BEFORE | 0 | 6 | Все F01–F06 подтверждены до production edits |
| Unit suite | 263 | 0 | 38 suites |
| Итоговые PostgreSQL/Redis/HTTP suites | 116 | 0 | 0 skipped; включают 28 новых security и 11 manual HTTP tests |
| Дополнительный sales-v2 smoke | 11 сценариев | 0 | Не добавлять к количеству unit tests |
| Demo suite, вне Phase 1 | 0 | 1 | Известный F11: expected summary не содержит SIGNING/SIGNED |
| Nest build / TypeScript / ESLint без fix | — | — | Exit 0 у каждого |
| Existing migrations / schema diff | — | — | Применение успешно; No difference detected, exit 0 |
| git diff --check | — | — | Exit 0 |

Один промежуточный общий прогон: 115 passed / 1 failed из-за `read ECONNRESET` в существующем HTTP test консультаций. Повтор того же набора без изменения теста: **116 passed / 0 failed**. Ранее две ошибки нового fault-injection harness исправлены в самом механизме принудительного сбоя; rollback assertions сохранены и проходят. Не выдаём эти промежуточные прогоны за успешные.

Команды (DATABASE_URL — только disposable local `*_test`, Redis — отдельный локальный тестовый instance):

```sh
./node_modules/.bin/nest build
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint '{src,apps,libs,test}/**/*.ts'
./node_modules/.bin/jest --runInBand --watch=false
node --import tsx --test --test-concurrency=1 \
  test/phase1-contract-security.test.ts \
  test/manual-contract-http.test.ts \
  test/sales-expert-v2-http.test.ts \
  test/sales-contract-reliability.test.ts \
  test/expert-lead-visibility-http.test.ts \
  test/sales-expert-v2-regression.test.ts \
  test/lead-call-notifications.test.ts \
  test/lead-status-migration.test.ts
node --import tsx test/sales-expert-v2-smoke.ts
./node_modules/.bin/prisma migrate diff \
  --from-config-datasource --to-schema src/prisma/schema.prisma --exit-code
```

Новый npm/yarn script: `test:phase1-security` (build + security suite). Для общего набора задаётся `SALES_V2_TEST_REDIS_URL`. Demo test требует другую, пустую мигрированную БД.

Локальные артефакты этой сессии: `/private/tmp/oxus-phase1-before-tests.log`, `oxus-phase1-verified-integration.log`, `oxus-phase1-unit.log`, `oxus-phase1-smoke.log`, `oxus-phase1-demo.log`, `oxus-phase1-schema-diff.log`, `oxus-phase1-duplicates-after.log`. Файлы после первого также находятся в `/private/tmp/`. Эти временные логи могут быть очищены системой; permanent evidence — regression tests и зафиксированные выше результаты.

## Security и ограничения проверки

Закрыты forged/failed/mismatched callback, repeated benefits, cross-order payment replay, non-CRM ownership bypass, обход transfer через исторический Lead, обход permission через generic endpoint и поддельный isAdmin. Проверена согласованность DB-эффектов при forced failure и настоящей PostgreSQL concurrency.

Сеть S3 в security tests заменена transport mock; авторизация, DB и HTTP реальные. SMTP/realtime transport также изолированы. Реальный callback FreedomPay и staging merchant не вызывались. Соответствие документированному flat provider contract доказано локально; staging E2E следует провести перед production rollout.

Конфигурация: `FREEDOM_RECEIVE_SECRET_KEY` — receiving secret, `FREEDOM_PAYMENT_SECRET_KEY` не используется для incoming receipts. `FREEDOM_TESTING_MODE=0` — production, `1` — тест; init и callback используют одно значение. Ранее init хардкодил test mode. `FREEDOM_RESULT_URL` должен указывать на фактический публичный `/api/v1/payment/freedompay-webhook`; последний segment участвует в подписи. Примеры env исправлены, реальные env не менялись.

## Remaining risks / Phase 2

- **F07:** currency reporting. Проверка currency конкретной Transaction исправлена в F01, агрегация отчётности не менялась.
- **F08:** analytics manual receipts/earnings.
- **F09:** согласованность summary/search filters.
- **F10:** единая ADMIN-policy, включая существующее ограничение CRM metadata.
- **F11:** CI/demo expectations. Повторно подтверждён красный demo test со старым summary; после его assertion остальные шаги этого test не исполняются. Создание 36 fixtures, включая договоры с общей блокировкой, прошло до assertion.
- **BUSINESS DECISIONS:** окончательное подтверждение директором равных долей и допустимого числа траншей; правила перерасчёта графика/частичной оплаты/переплаты/возврата/просрочки; сверка in-flight gateway receipts с manual ledger; будущая e-signature. Phase 1 сохраняет текущие правила и не вводит решения за владельца продукта.
- Исторические дубли и частично обработанные платежи требуют отдельной сверки. Исправление предотвращает новые нарушения через всех известных writers, но не очищает прошлые данные и не защищает от произвольного SQL в обход приложения.

**Вывод: F01–F06 полностью закрыты в проверенном объёме Phase 1; можно переходить к Phase 2. Это не заключение о полной production-ready готовности всей системы: F07–F11, сверка исторических данных и staging-проверка реального провайдера остаются отдельными работами.**
