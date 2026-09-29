# Phase 3 — production blockers R01 / R02 / R08

Дата проверки: 2026-09-28. Результат: **R01 PASS · R02 PASS · R08 PASS**.

Проверен текущий рабочий backend с baseline Phase 1 F01–F06, Phase 2 F07–F11 и исправлением создания ConsultantProfile для EXPERT. Исходное дерево уже содержало эти изменения; сравнение Phase 3 выполнено с отдельным SHA-256 snapshot перед началом работ, а не только с HEAD. Baseline не откатывался. Commit, push, deployment и работа с production-данными не выполнялись.

## Finding → evidence

| Finding | Before | Root cause | Fix | Regression | After |
|---|---|---|---|---|---|
| R01 | При requested `1` реальный backend service container получил `FREEDOM_TESTING_MODE=ABSENT`. Проверка обоих Compose: 8 ожидаемых неуспешных subcases. | В explicit environment map отсутствовала переменная; `.env` служит источником interpolation, а не автоматическим env_file контейнера. Service default — `0`. | Явная передача в обоих Compose, default только для отсутствующей переменной; deploy preflight отклоняет invalid/empty до operational changes. | Настоящие Compose-контейнеры: effective environment + compiled FreedomPay service, init/callback/opposite-mode; invalid/empty/default; deploy ordering. | **PASS**: 10 runtime subcases, оба стека; режим не теряется и не нормализуется молча. |
| R08 | HTTP `POST /contracts` с FREE + 1500000 KZT → 201; manual confirmation → 201 PAID, portrait FREE, packages=0. Permanent expectations также воспроизвели FREE + 750000, direct/ADMIN/CRM-draft обходы. | `paymentTerms` проверял сумму/валюту/транши, но не tariff. Отдельный FREE-check существовал только в CRM prepare. | Общий domain `commercialTerms` во всех 3 writers, CRM prepare/confirm, изменении коммерческих metadata и первом manual confirmation. | FREE на двух ценах, оба actor types, прямые вызовы, испорченный draft, metadata, valid tiers, Cambridge, concurrency/retry, demo. | **PASS**: FREE rejected 400 до commit; допустимые договоры/benefits и идемпотентность сохраняются. |
| R02 | Historical SIGNED без manualConfirmedAt и без benefits → manual confirmation 201 PAID; subscription FREE, packages=0. | SIGNED сам по себе считался доказательством ранее выданных benefits; branch не начислял и не проверял их. | Проверка согласованного observable entitlement внутри существующей Serializable transaction до любых записей. Неоднозначность → 409 с отдельным code. | Known valid/fully consumed, missing/mismatched/invalid balance/transferred/competing contracts, ADMIN, retries, no mutation, historical PAID, новый manual installment flow, SQL classification. | **PASS**: неоднозначный historical SIGNED не закрывается; доказуемое текущее согласованное состояние допускается без повторного начисления. |

### Порядок воспроизведения

До production edits повторены два исходных HTTP characterization-сценария: **2 passed / 0 failed**, где PASS означает именно воспроизведение дефекта. Лог содержит:

```text
AUDIT_LEGACY_SIGNED {"status":"PAID","subscription":"FREE","packages":0}
AUDIT_GENERIC_FREE {"paidAmount":1500000,"status":"PAID","subscription":"FREE","packages":0}
```

До исправлений запущены новые защитные expectations R02/R08: **5 passed / 11 failed / 0 skipped** из 16. После исправлений эти же 16 проходят; дополнительно добавлен SQL audit test, итог **17 passed / 0 failed / 0 skipped**. Тесты используют собранный backend с настоящими Nest guards/ValidationPipe и PostgreSQL, а не mock domain implementation.

Для R01 первоначальная проверка запускала реальный Compose service container и читала env внутри него: оба стека × 4 значения дали 8 ожидаемых failures. Итоговая проверка усилена исполнением настоящего service внутри контейнера и добавляет отсутствующую переменную: 10 успешных subcases. Внешние запросы FreedomPay заменены заглушкой; реальные merchant credentials не использовались.

## R01 — runtime configuration

Изменены [deployment Compose](compose.yaml), [local Compose](../compose.yaml):

```yaml
FREEDOM_TESTING_MODE: "${FREEDOM_TESTING_MODE-0}"
```

Именно `-0`, а не `:-0`: явная пустая строка остаётся некорректной строкой, а не превращается в production mode. Общий environment anchor передаёт значение backend и migrator. В обоих env examples сохранён безопасный `0` и добавлен комментарий о допустимых значениях.

Фактически проверено **внутри контейнера**, одинаково для обоих Compose:

| Requested | Effective env | Payment init | Callback verifier |
|---|---|---|---|
| `1` | `1` | pg_testing_mode=1 | 1 принят, подписанный 0 отклонён |
| `0` | `0` | pg_testing_mode=0 | 0 принят, подписанный 1 отклонён |
| `invalid` | `invalid` | отклонён до HTTP | invalid config отклонён |
| пустая строка | пустая строка | отклонён до HTTP | invalid config отклонён |
| отсутствует | `0` | pg_testing_mode=0 | 0 принят, 1 отклонён |

Постоянные тесты: [test_freedom_mode_runtime.py](tests/test_freedom_mode_runtime.py), [freedom-mode-probe.cjs](tests/freedom-mode-probe.cjs). Используется `docker compose run` настоящего backend service с изолированным project name; override меняет image/entrypoint, отключает зависимости/порты/healthcheck/рабочие volumes. Собранный код и зависимости монтируются read-only в Node 22 container. **Environment backend service не переопределяется тестовым override.** Service читает ConfigService и проверяет init/подписанный callback на этом effective mode. После теста probe containers и их networks удаляются.

Это проверка wiring и runtime service, а не загрузки всего application stack и не внешней merchant-интеграции. Test mode не привязан автоматически к STAGING; семантика 0/1 сохранена.

[deploy.sh](deploy.sh) проверяет rendered backend mode после `config --quiet`, до pull/stop/backup/migrations. Отсутствие, empty, invalid отклоняются. Deployment tests подтверждают отсутствие operational changes при invalid config и допустимость testing mode. App runtime уже использовал один `testingMode()` для init и callback; он не менялся. Некорректный mode не становится 0/1: init завершается ошибкой gateway, verifier — configuration error. Отдельного глобального startup validator не добавлено.

CI quality job теперь получает Node probe image и запускает runtime test через существующий `unittest discover`; оба существующих Compose config checks сохранены. Реальные env/secrets не печатались. R06 request method не исправлялся.

## R08 — commercial invariant

Единая функция [commercialTerms](../src/modules/contract/domain/manual-contract.ts) проверяет paid tier по фактическому `TIER_SLOTS`: `AI_ROADMAP` и `EXPERT_MENTORSHIP`. FREE и неизвестные значения отклоняются. Затем вызывается существующий `paymentTerms`.

Для нового договора остаются 1500000 или 750000 KZT; 750000 сохраняет существующий Cambridge case. Новая связь «конкретная цена → конкретный tier» не вводится: оба платных tier принимают обе подтверждённые цены. Default FULL, равные доли, rounding, Almaty schedule и limit 2–120 для INSTALLMENT не менялись. Для существующих договоров retained legacy mode сохраняет положительные исторические суммы и KZT/USD/EUR, **но не разрешает FREE**.

Глобальный поиск runtime Contract writers дал три места, все используют общий validator:

| Boundary | Проверка |
|---|---|
| `ContractRepository.create` / generic `POST /contracts` / прямой вызов | commercialTerms внутри существующей transaction; invalid не оставляет Contract |
| `LeadContractService.prepare` | валидирует draft до сохранения; прежний отдельный FREE-check заменён общим правилом |
| `LeadContractService.confirm` / CRM Contract writer | повторно валидирует сохранённые условия до createStudent; tampered/legacy invalid draft не создаёт account/invitation/contract |
| `sales-expert-demo.seed.ts` / paid demo writer | тот же validator для коммерческих полей; production creation lock сохранён |
| `ContractRepository.updateMeta` | при изменении price/currency/payment type/count валидирует merged values и сохранённый tier; historical amount compatibility сохранена |
| `confirmManualContract` / первая manual confirmation | валидирует сохранённые коммерческие условия; ранее записанный pending FREE не может стать новым PAID |

Metadata API не принимает subscriptionTier; попытка передать FREE через PATCH не изменяет tier. Прямой metadata update также формирует explicit field set, не распространяет произвольные поля DTO в Prisma. Signed/finalized restrictions, owner/ADMIN policy и existing idempotent responses сохранены. Historical PAID сохраняет свой 409; ambiguous historical SIGNED сначала получает R02 conflict.

Permanent coverage: HTTP FREE на обеих ценах для EXPERT/ADMIN, direct repository calls с конкурентными попытками, rollback stored FREE update/confirm, direct CRM prepare и повторная проверка испорченного draft, оба paid tiers и цены, metadata tier injection/invalid price, concurrent first confirmation с одним receipt и одним package. Unit cases дополнительно проверяют обе цены для каждого paid tier, FREE в legacy mode и неизвестные значения. Existing duplicate locks/number allocation/retries не менялись.

## R02 — historical benefits policy

Признак historical path: `status=SIGNED` и **отсутствующий `manualConfirmedAt`**. Новый manual SIGNED после первого транша уже имеет `manualConfirmedAt`: existing retry branch выполняется до historical guard. Последующие транши используют существующий `confirmInstallment`; его поведение не менялось.

Guard [assertHistoricalBenefits](../src/modules/contract/domain/historical-contract-benefits.ts) вызывается внутри общей Serializable transaction до schedule/receipts/journey/audit/contract mutations. Он проверяет текущее наблюдаемое состояние, а не пытается восстановить неизвестную историю начислений.

| Case | Классификация и действие |
|---|---|
| A — корректное наблюдаемое состояние | Tier платный; portrait.subscription точно совпадает; есть package текущего assigned expert; totalSlots не меньше положенных 3/10; 0 ≤ usedSlots ≤ totalSlots; нет другого Contract этого student. Confirmation разрешена; пакет/подписка повторно не начисляются. Полностью использованный пакет допустим. |
| B — доказано, что никогда не начислялось | Текущая модель не содержит immutable grant ledger; такое доказательство из отсутствия package получить нельзя. Автоматического начисления или отдельного repair rule не добавлено. |
| C — неоднозначность | FREE/несовпадение subscription/отсутствующий package текущего owner/недостаточная capacity/некорректный usage/несколько Contract → 409 review required. Пакет у прежнего owner после transfer не считается доказательством корректного текущего entitlement. |
| D — historical PAID | Existing 409 `This historical contract is already fully paid` сохранён. Уже manual-confirmed contracts сохраняют исходную идемпотентность. |

Наличие согласованных benefits — доказательство доступного/учтённого текущего entitlement, **не доказательство происхождения каждого historical grant**. Модель не связывает StudentPackage с Contract. Поэтому при нескольких договорах attribution неоднозначна и guard консервативно блокирует переход. Gateway SUCCESS сам по себе не доказывает выдачу услуг; отсутствие package не доказывает, что услуги никогда не выдавались. Балансы не восстанавливаются автоматически.

Пример ответа:

```json
{
  "statusCode": 409,
  "code": "HISTORICAL_BENEFITS_REVIEW_REQUIRED",
  "message": "Historical contract benefits require review before confirming payment",
  "contractId": "<contract id>"
}
```

ADMIN проходит тот же guard. Повторные и конкурентные заблокированные запросы оставляют Contract, installments, portrait, packages, journey и audit неизменными. Старые записи массово не обновлялись, не удалялись и не переводились в другой status. Разблокирование спорных данных требует отдельного подтверждённого решения по конкретному случаю; специальный force/bypass endpoint не добавлен.

### Read-only historical audit

Добавлен [phase3-historical-benefits.sql](audits/phase3-historical-benefits.sql). Он повторяет условия guard и выводит только review candidates: contract/student IDs, tier/status/manualConfirmedAt, текущую subscription/consultationBalance, package текущего owner и остальные packages, total/used/expected slots, competing-contract flag, gateway/manual evidence и массив причин. PII, подписи callback и секреты не выводятся.

Gateway evidence имеет student-level связь и не объявляется оплатой именно этого договора; наличие providerRef выводится как boolean. Отдельные raw historical callback payloads модель не хранит. Case A и PAID не включаются в R02 candidate list. Оба SQL выполняются в `REPEATABLE READ READ ONLY`, с timeouts; UPDATE/DELETE/DDL отсутствуют.

Постоянный 17-й Phase 3 test запускает **неизменённый** [final-release-historical.sql](audits/final-release-historical.sql) и новый R02 query на чистой final-schema synthetic DB. Он проверяет, что корректный fully consumed Case A и historical PAID исключены из списка, а synthetic SUCCESS без benefits остаётся кандидатом. Audit не изменяет snapshot проверяемого студента.

Результаты полного CI-equivalent runner на чистой БД:

| Query | Candidates | Значение в synthetic fixtures |
|---|---:|---|
| C01 | 1 | намеренно созданный competing Contract для проверки fail-closed |
| C04 | 2 | сценарии transfer, историческая attribution сохранена |
| P03 | 1 | synthetic SUCCESS при отсутствующих benefits |
| P04 | 6 | benefits без receipt: в том числе допустимый historical benefits-on-signature Case A |
| P05 | 1 | специально несовпадающие synthetic gateway amount/tier и Contract |
| M07 | 3 | широкий исходный фильтр отсутствия/несовпадения benefits |
| J06 | 4 | synthetic historical status без соответствующих journey milestones |
| Остальные 19 запросов исходного audit | 0 | всего исполнено 26 SELECT |
| Новый R02 query | 7 | missing + tier/capacity/usage/current-owner/competing-contract anomalies |

M07 и R02 имеют разные цели: новый запрос дополнительно проверяет capacity, usage и текущего owner, поэтому не обязан совпадать с M07. Эти counts описывают **тестовые fixtures**, не production. Candidates не объявляются автоматически corrupted records. До реального rollout необходима операционная сверка целевой historical выборки на копии final-schema DB; задача Phase 3 не давала доступа к production и не санкционировала data repair.

## Regression F01–F11

| Baseline | Повторная проверка | Результат |
|---|---|---|
| F01 | invalid signature/result/amount/currency/mode/merchant/capture, неизвестные и изменённые подписанные поля, valid ACK; container mode/init/verifier | PASS |
| F02 | duplicate/concurrent callbacks, cross-order providerRef, rollback, historical SUCCESS, manual ledger-only | PASS |
| F03 | CRM/non-CRM ownership, current/deleted users/roles, direct access | PASS |
| F04 | generic/CRM race, один договор, конфликт номера/unique allocation | PASS |
| F05 | transfer, новая ownership, scan read/write и следующие платежи, сохранённая attribution | PASS |
| F06 | permission revocation, direct domain calls, disabled profile/actor, ADMIN flag spoof | PASS |
| F07 | finance по currency, legacy/manual receipts, installment totals без double counting | PASS |
| F08 | атомарные journey milestones, occurredAt, rollback/retry, повторный migration backfill | PASS |
| F09 | одинаковые list/summary filters, search/source/owner/deletedAt/tabs | PASS |
| F10 | ADMIN policy/metadata matrix и business restrictions; новые R02/R08 также не обходятся ADMIN | PASS |
| F11 | demo fixtures, полный runner, чистые DB/migrations/schema diff/Redis, новые проверки подключены в quality gate | PASS |

Manual flow повторно доказан: draft/signature не создают account и не закрывают Lead; первый receipt + signature создают account/Contract/benefits; FULL → PAID; первый INSTALLMENT → SIGNED; следующие транши по порядку, последний → PAID. Проверены retry, concurrency, rollback, transfer, permissions, scan, journey и finance. Экспертные профили также прошли прежние 11 regressions.

## Test evidence

Финальные результаты, без суммирования повторных диагностических запусков:

| Check | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Unit: 38 suites | 268 | 0 | 0 |
| Phase 3 production blockers | 17 | 0 | 0 |
| Admin expert profile | 11 | 0 | 0 |
| Phase 1 security | 28 | 0 | 0 |
| Phase 2 reporting | 18 | 0 | 0 |
| Phase 2 journey migration | 1 | 0 | 0 |
| Manual HTTP | 11 | 0 | 0 |
| Sales contract reliability | 12 | 0 | 0 |
| Sales expert V2 HTTP | 9 | 0 | 0 |
| Expert lead visibility | 6 | 0 | 0 |
| Sales expert V2 regression | 40 | 0 | 0 |
| Lead call notifications | 9 | 0 | 0 |
| Lead status migration | 1 | 0 | 0 |
| Demo | 1 | 0 | 0 |
| **Integration subtotal** | **164** | **0** | **0** |
| Smoke scenarios, отдельный script | 11 | 0 | 0 |
| Deployment Python tests | 21 | 0 | 0 |

Итого **453 формальных теста + 11 smoke-сценариев**. Runtime matrix содержит 10 subcases внутри одного deployment test и не прибавляется повторно к 453.

Дополнительно PASS: Nest build; `tsc --noEmit`; полный ESLint **без --fix**, 0 warnings/errors; shell syntax deploy/ssh/install; оба Compose config checks; `git diff --check`. Integration runner создал **14 отдельных БД**, применил **42 миграции** на каждой, получил **14 × No difference detected** и удалил свои временные БД. Схема и миграции в Phase 3 не изменялись.

Основные команды (credentials задаются через локальный test env):

```sh
./node_modules/.bin/nest build
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint '{src,apps,libs,test}/**/*.ts'
./node_modules/.bin/jest --runInBand
node test/run-integration.mjs
docker pull node:22-alpine
python3 -m unittest discover -s deployment/tests -v
docker compose -f compose.yaml config --quiet
docker compose --env-file deployment/.env.example -f deployment/compose.yaml config --quiet
git diff --check
```

Локальные evidence logs: `/private/tmp/oxus-phase3-before-contracts.log`, `oxus-phase3-before-regression.log`, `oxus-phase3-before-mode.log`, `oxus-phase3-after-regression.log`, `oxus-phase3-build.log`, `oxus-phase3-types.log`, `oxus-phase3-lint.log`, `oxus-phase3-unit.log`, `oxus-phase3-integration.log`, `oxus-phase3-deployment.log`. Они относятся к этой рабочей сессии; постоянные доказательства воспроизводятся tests/SQL в repo.

Промежуточные implementation errors исправлены до финального gate: тип helper с omitted OTP fields сужен до нужных Pick-полей; исправлен относительный путь в новом runtime probe. Исходные expected red BEFORE tests отделены от финальных результатов. Hosted GitHub CI в этой сессии не запускался; локально выполнен его gate.

## Remaining findings / решение о следующей фазе

R03–R07 остаются **OPEN**, production code этих областей не менялся:

| Finding | Оставшаяся работа |
|---|---|
| R03 | lostLeads: paid users, dateTo и согласованность cohort/filter |
| R04 | SCHOOLBOY в analytics/journey reporting |
| R05 | Swagger response schemas и неверно представленный online OTP flow |
| R06 | FreedomPay request method / merchant interoperability |
| R07 | pagination/performance contracts и earnings |

Cambridge semantics, installment schedule/count limits, refund policy, e-signature и DIRECTOR permissions не изменены. Existing FreedomPay signature/settlement, finance/analytics, schema/migrations и исправление профилей экспертов сохранены по baseline hashes.

1. **R01 PASS** — environment доходит до контейнера и обеих payment boundaries; invalid fail closed.
2. **R02 PASS** — ambiguous historical SIGNED блокируется до mutations; новые installments не блокируются; автоматического ремонта истории нет.
3. **R08 PASS** — единый paid-tier invariant закрывает найденные writers/direct calls/коммерческие updates.
4. В проверенном scope этих трёх findings **незакрытых production-blocking technical defects не обнаружено**. Historical review остаётся обязательной операционной работой для затронутых записей; 409 является ожидаемой защитой, а не подтверждением исправленности данных.
5. **Можно переходить к Phase 4** — reporting/API/performance cleanup и оставшимся R03–R07. Это не разрешение на production release: целевые historical данные и внешняя gateway-интеграция здесь не проверялись, открытые findings не закрыты.
