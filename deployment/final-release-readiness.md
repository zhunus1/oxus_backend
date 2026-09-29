# Final Release Readiness Audit

Дата: 2026-09-28. Объект: текущее рабочее дерево `oxus_backend` после Phase 1 и Phase 2, включая незакоммиченные изменения. Это NestJS / Prisma / PostgreSQL / BullMQ backend. Проверялось рабочее дерево, а не опубликованный release image.

Изменены только новые артефакты аудита: этот отчёт и [read-only SQL](audits/final-release-historical.sql). Production code, существующие документы, env, migrations, tests, fixtures и CI не исправлялись. Контроль SHA-256 всех 598 исходных файлов не обнаружил изменений. Commit, push, deployment и обращения к реальному merchant не выполнялись.

## A. Executive verdict

**READY WITH CONDITIONS. Production release сейчас не разрешён результатами этого аудита.**

Исправления исходных F01–F11 присутствуют и подтверждаются повторным локальным gate: **417 постоянных тестов, 0 failures, 0 skipped**, отдельно **11 smoke-сценариев**. Дополнительно выполнены 11 временных независимых проверок, включая сквозные FULL/INSTALLMENT и воспроизведения новых проблем. Зелёные characterization-проверки подтверждают наличие описанных дефектов, а не их исправление.

1. **Frontend integration:** начинать можно по фактическому контракту из раздела K. Автогенерация клиента только по текущему Swagger недостаточна: R05. Совместимость самого frontend не проверена.
2. **Staging:** можно проводить изолированную интеграцию manual-flow на синтетических данных с отключёнными gateway credentials. Полная staging-приёмка, включая FreedomPay, не завершена; сначала R01/R06 и реальная проверка окружения.
3. **Production:** блокируют как минимум R01, R08, отсутствие решения по потенциально неполным historical benefits R02, совместимого frontend, production historical audit, реального merchant E2E и подтверждённого remote CI. Reporting/API findings R03–R05 также требуют решения перед приёмкой соответствующих функций. R07 требует проверки предельных объёмов целевого окружения.
4. **Непосредственно перед production:** исправленный immutable candidate → remote CI → совместимый frontend → test merchant E2E → восстановленная копия production + SQL/миграционный rehearsal → backup и остановка всех writers → migrations/backfill → согласованный rollout → smoke/monitoring. Подробности P–R.

Новые findings:

| ID | Severity | Тип | Проверенное отклонение | Release consequence |
|---|---|---|---|---|
| R01 | High | Technical / environment wiring | `FREEDOM_TESTING_MODE` из env не передаётся серверным Compose в backend | Test mode нельзя считать включённым; блокер gateway staging и production конфигурации |
| R02 | High, data-dependent | Technical / historical data | Manual confirmation исторического SIGNED с отсутствующими benefits закрывает оплату, сохраняя FREE / отсутствие package | Нужна сверка и отдельное решение для затронутых записей; массовое доначисление недопустимо |
| R03 | Medium | Reporting | `lostLeads` включает оплативших и игнорирует `dateTo`/общий education filter | Сводка имеет несовместимые когорты и ложные потери |
| R04 | Medium | Reporting | SCHOOLBOY принимается контрактным workflow, но исключается из analytics | Оплаченный ученик и milestones исчезают из отчётности |
| R05 | Medium | API / frontend | Реальный OpenAPI не описывает новые response shapes и рекламирует работающий OTP | Нельзя принимать интеграцию только по Swagger |
| R06 | Medium | Gateway interoperability | Init передаёт `Pg_result_url_method`, а документированный параметр — `pg_request_method` | Фактический метод callback зависит от merchant configuration; требуется исправление/подтверждение провайдера |
| R07 | Medium | Performance | Непагинированные contracts/earnings дают 20–32 MiB JSON, до ~351 MiB прироста heap при 40k contracts | Проверить production cardinality, лимиты и параллельную нагрузку до открытия этих экранов |
| R08 | High | Business invariant / API | Generic `POST /contracts` принимает FREE за 1 500 000 KZT; confirmation возвращает PAID без платных услуг | Обязательное закрытие альтернативного пути создания некорректного договора |

Critical findings с доказанным обходом подписи или повторным начислением в проверенных callback-сценариях не обнаружены. Это не заключение о безопасности всей платформы вне заданного scope.

## B. F01–F11 verification matrix

Предыдущие phase reports и исходные формулировки findings использованы как карта требований. Отдельного исходного final-audit файла с полным отчётом в доступном репозитории/вложениях нет: исходное вложение содержит запрос аудита. Поэтому прежние выводы не приняты как доказательство; код и тесты проверены заново.

| Finding | Current status | Evidence | Regression |
|---|---|---|---|
| F01 signature/context | PASS в проверенном callback scope | `freedom-signature.ts`, `freedompay.service.ts`; invalid/missing sig, сумма, валюта, capture/result/merchant/mode, extension fields, unknown order | Permanent `phase1-contract-security.test.ts`, дополнительные JSON/multipart проверки; deployment/init имеют отдельные R01/R06 |
| F02 exactly-once settlement | PASS для одного order/provider receipt | Serializable transaction, row lock Transaction, advisory lock provider reference; amount/currency до SUCCESS shortcut; все benefits и SUCCESS в одной транзакции | Повторы, конкуренция, replay ref на другой order, поздний failure, rollback/retry; historical SUCCESS не доначисляется автоматически |
| F03 ownership | PASS | Общий `contract-access.ts`; current portrait assignment и pending-lead fallback; нет отсутствующего Lead как разрешения | CRM/non-CRM create/read/list/meta/signature/confirm/installment/scans; foreign/deleted/no-owner |
| F04 uniqueness | PASS у всех найденных runtime writers | Generic repository, CRM confirmation, demo seed вызывают `lockStudentWithoutContract` в Serializable; autonumber advisory lock + UNIQUE number | Generic/generic, generic/CRM, CRM/CRM confirm, autonumber collision/race, concurrent demo |
| F05 transfer | PASS | Current assignment управляет доступом; historical Lead/signedBy не переписываются | Настоящий transfer в permanent F05; B читает/платит/работает со scan, A запрещён; attribution сохраняется |
| F06 permission | PASS у действующих contract operations | Активные actor/role/profile и permission проверяются внутри domain; `isAdmin` аргумент не источник authority | Revoked/deleted permission, deleted role/user, inactive profile, direct service calls; read имеет отдельную policy |
| F07 currency | PASS | Decimal receipts, grouping by currency, null mixed scalars, manual receipt aggregation до join | KZT/USD/EUR, legacy SIGNED/PAID, manual partial/final, single/empty currency, exact decimals, no double count |
| F08 manual milestones | PASS исходного дефекта; не всей analytics | 3 first milestones внутри transaction; subsequent installment event; effective occurredAt и backfill | FULL/INSTALLMENT, repeat/concurrent, backdate, rollback, replay backfill; дополнительные R03/R04 |
| F09 summary filters | PASS | Общий filter builder для source/search/ownership/deletedAt и всех 6 tabs | 24 комбинации filters × 6 tabs, `summary[tab] === list.meta.total`; CONTRACTS overlap |
| F10 ADMIN policy | PASS заявленной матрицы | Общая contract policy разрешает unsigned CRM meta, не приписывает ADMIN владельцем | CRM/non-CRM owner/foreign/ADMIN, deleted account/lead, signed metadata, sequencing, duplicate create |
| F11 demo/CI | PASS локальной конфигурации и runner | Demo соответствует draft-first/payment-before-account; services/health checks/runner присутствуют в workflow | Demo и все 12 runner entries выполнены; remote run не подтверждён |

Между Phase 1 и Phase 2 не воспроизведены исходные security-дефекты F01–F06. R02/R08 — дополнительные пробелы бизнес-валидации; R03/R04 — оставшаяся неполнота аналитики, а не потеря добавленных F08 milestones.

## C. End-to-end workflow

Фактическая цепочка: Sales lead/назначение и консультация → эксперт NEW (`CALL_SCHEDULED`/`OFFICE_INVITED`) либо FOLLOW_UP (`RECALL`) → prepare → `CONTRACT_PENDING`, tab SIGNING → подпись draft → первый receipt → атомарные User/portrait/Contract/installments/benefits/invitation intent/Lead.CONVERTED/journey → дальнейшие receipts → Contract.PAID.

`POST /expert/leads/:id/contract` возвращает `{lead, contract:null, draft, invitationRequired:false}`. User/Contract при этом отсутствуют. При чтении карточки имя поля — `contractDraft`. Parent lead требует отдельный `parent`; исходные контакты Lead и questionnaire сохраняются. Для student lead parent опционален. Отчество не извлекается эвристически из строки ФИО.

| Этап | FULL | INSTALLMENT |
|---|---|---|
| Prepare/signature | Draft; аккаунта, договора, receipt и invitation ещё нет | То же |
| Первый платёж | Точная полная сумма, новый Contract.PAID | Точный первый транш, Contract.SIGNED с задолженностью |
| Одна transaction | Account/portrait/contract/first receipt/package/assignment/Lead.CONVERTED/3 milestones/invitation intent | То же, плюс полный будущий schedule |
| Benefits | Для EXPERT_MENTORSHIP package=10 slots; AI_ROADMAP=3 | Начисляются после первого receipt, дальнейшие транши не увеличивают package |
| Финансы после первого платежа | paid=1 500 000; remaining=0 | При 3 траншах paid=500 000; remaining=1 000 000 |
| Финальный транш | Неприменимо | PAID; paidAt=факт последнего receipt; Lead остаётся CONVERTED |
| Journey | CONTRACT_SIGNED, PAYMENT_COMPLETED, LEAD_CONVERTED | Те же 3 + отдельный CONTRACT_INSTALLMENT_PAID на каждый следующий receipt |

Дополнительные сквозные HTTP-проверки прошли весь участок prepare → signature → два concurrent confirms → account/invitation/package → finance → передача operational assignment → scan → final payment → finance/journey. FULL: 3 события; INSTALLMENT/3: 5 событий. В обоих случаях один Contract, одна invitation, 10 package slots, итог paid=1 500 000 KZT и сохранён historical expert. Дополнительная проверка задаёт конечное assignment transfer непосредственно в synthetic DB; реальный transfer repository отдельно исполняется permanent F05 suite.

Постоянные тесты также проверяют Sales intake/booking/expert work, activation одноразовым invitation token, durable outbox/recovery, offline consultation. Внешние SMTP, MinIO и FreedomPay заменены transport mocks; реальная доставка и приватность bucket проверяются только на staging.

Негативные сценарии подтверждены: payment без signature отклонён; signature без payment оставляет lead открытым; неправильная сумма, future dates, преждевременный installment, отличающийся retry timestamp, foreign actor и revoked permission отклонены. Concurrent confirms не размножают сущности. Ошибка после создания User/Contract/benefits/event откатывает всю transaction. Идентичный retry возвращает сохранённый результат.

`statusChangedAt` меняется при настоящем изменении Lead.status. Повтор prepare, изменение draft, signature и последующие payments не перезапускают время этапа. Возврат в рабочую стадию и повторный вход получают новую дату. Исторический backfill statusChangedAt=createdAt является приближением; точная история прежних переходов этой миграцией не восстанавливается.

**R08 — generic FREE.** В `create-contract-for-student.dto.ts:15` enum содержит FREE. В `contract.repository.ts:59` нет запрета, аналогичного `LeadContractService.prepare`. HTTP-воспроизведение: создать договор assigned student с `subscriptionTier:FREE, price:1500000, currency:KZT`; подтвердить signature/full receipt. Оба POST дают 201; итог PAID, portrait.subscription=FREE, packages=0. Это доступно обычному owner EXPERT через действующий generic endpoint. Permanent regression отсутствует; временное воспроизведение есть. Необходимо одинаково валидировать допустимый платный тариф на обоих путях и не обрабатывать такой input как успешную продажу.

## D. Security

Callback receipt проверяется до бизнес-мутаций: MD5 по basename script + отсортированным raw scalar fields кроме pg_sig + receiving secret; timing-safe сравнение; запрещены вложенные структуры/arrays и неподдерживаемые типы. Валидация проверяет успешность, capture, mode, опционально переданный merchant, формат order/payment/amount/currency/salt. Отсутствие критической конфигурации verifier даёт 503, неправильная подпись — 403.

| Атака / вариант | Результат локальной проверки |
|---|---|
| Missing/invalid signature | 403; Transaction/benefits/contract не меняются |
| Wrong amount/currency при корректной подписи | 400; stored order остаётся неизменным |
| Failed result, failure/error fields, bankcard captured=0/нет capture | Reject без mutation |
| Wrong merchant / testing mode | 403 без mutation |
| Unknown signed scalar field | При подлинной подписи принят; изменение поля ломает подпись |
| Duplicate form field | Parser даёт array, validator отклоняет |
| Unknown order | 404 после signature verification; никаких benefits |
| Один providerRef на два orders | Только один settlement; другой получает conflict, включая concurrency |
| JSON корректные raw scalar/numeric значения | Проверены; signed extensions сохраняются |
| Multipart/form-data и urlencoded | Проверены на фактическом Nest HTTP controller |
| Raw JSON duplicate key | Last-key-wins в JSON parser: несовпадающее с подписью итоговое значение → 403; совпадающее → 200 |

Последний случай — ограничение строгости входного формата: backend не обнаруживает сам факт повторного JSON key до parsing. Воспроизведение не обошло подпись/сумму: применено только корректно подписанное последнее значение. Нельзя заявлять, что любые duplicate raw fields отвергаются. FreedomPay integration должна использовать согласованный form transport; если требуется запрет любого duplicate JSON key, это отдельное hardening требование.

После invalid callbacks сверялись Transaction status/providerRef, contract status, package, portrait и journey. SUCCESS нельзя понизить late failed callback. Предоставленный `isAdmin=true` не заменяет роль из БД.

Все четыре публичных OTP/signing route закрыты `OnlineSigningDisabledGuard` с 409 MANUAL_SIGNATURE_REQUIRED. Старые internal OTP methods остаются в коде и вызываются legacy reliability tests; действующего HTTP-пути мимо guard не найдено. Новые вызовы этих методов из workers/services потребовали бы отдельной проверки.

## E. Payments

Manual receipts и FreedomPay ledger — разные источники. Новый manual contract не допускает gateway initiation. Уже летящий valid gateway callback записывает Transaction.SUCCESS, но не закрывает manual installments и не выдаёт benefits повторно: нужна отдельная reconciliation. Исторические SUCCESS с неизвестными прежними side effects также не доначисляются автоматически.

**R02 — incomplete historical benefits.** `manual-contract-confirmation.ts:63` пропускает весь entitlement grant, если начальный status=SIGNED. На synthetic historical non-CRM SIGNED с portrait FREE и без package confirmation полной суммы возвращает PAID, но FREE/package=0 сохраняются. Такое состояние нельзя исключить только по status: legacy `ContractService.signByStudent` сначала коммитит SIGNED через repository, затем отдельно вызывает `activateContractBenefits` (`contract.service.ts:88,113`), который мог завершиться ошибкой. Нормальный успешно завершённый legacy flow benefits выдавал; finding не утверждает обратного и не доказывает наличие таких записей в production.

Для R02 нельзя просто повторно выдавать пакет всем SIGNED: это повторит уже использованные benefits. Gate — аудит исторических SIGNED/PAID, восстановление фактов выдачи/оплаты и согласованная адресная обработка либо явный отказ вместо ложного успешного завершения. SQL M07 выявляет как подтверждённые manual anomalies, так и historical SIGNED без наблюдаемых benefits до confirmation; P03/P04 дополняют инвентаризацию. Постоянного теста этой неполной historical-state ветки нет.

**R06 — callback request method.** Фактический init-request, перехваченный без сети, содержит `Pg_result_url_method=POST`, но не `pg_request_method`. В [официальном Merchant API](https://freedompay.kz/docs/merchant-api/pay) метод вызова Check/Result URL задаёт `pg_request_method`. На backend существует POST callback. Поэтому код не гарантирует настройку нужного метода; неизвестное поле может лишь возвращаться как merchant extension. Не доказано, что конкретный merchant сейчас использует неправильный метод: это проверяется реальным staging E2E. Исправление не выполнялось.

**FreedomPay configuration contract:** `FREEDOM_RECEIVE_SECRET_KEY` — receiving secret; payout `FREEDOM_PAYMENT_SECRET_KEY` не применяется к receipts. `FREEDOM_MERCHANT_ID` должен соответствовать merchant; result URL — публичный HTTPS `/api/v1/payment/freedompay-webhook`. Basename для подписи сейчас `freedompay-webhook`, без query string, а не `init_payment.php`. Proxy не должен переписывать тело/подписанные поля. Merchant id может отсутствовать в callback; тогда доверие обеспечивается receiving secret/configured merchant. Один receiving merchant предполагается схемой providerRef. [Правила подписи и transport](https://docs.freedompay.kz/doc-741636).

`ENVIRONMENT VALIDATION REQUIRED` — merchant account/ключи/public URL не проверялись и реальных платежей не было.

Staging checklist:

1. После устранения R01 проверить effective env внутри выбранного container: test merchant и mode=1; не выводить secret. Проверить внешний HTTPS POST route и basename.
2. Создать настоящий provider test payment через init для разрешённого legacy test-account flow; manual contract должен отклонять gateway initiation.
3. Получить настоящий FreedomPay callback; подтвердить signature acceptance и signed XML acknowledgement. Сопоставить order, payment id, merchant, mode, captured, amount/currency.
4. Проверить один SUCCESS и ровно одну выдачу положенных benefits/journey; сохранить обезличенное доказательство в release artifacts.
5. Повторить тот же callback через provider resend; убедиться, что package, journey и receipt не изменились повторно.
6. Выполнить test payment с failure; callback не создаёт SUCCESS/benefits и не понижает ранее успешный order. Текущая обработка failure отклоняет callback, а не переводит PENDING в FAILED — согласовать это с операционной обработкой провайдера.
7. Проверить mode mismatch и неверную подпись без mutation. Проверить доставку callback после краткого outage и reconciliation in-flight manual ledger.
8. Перед production независимо проверить mode=0 и production merchant. Не выполнять destructive real-money сценарий для доказательства этой настройки. Локальная подпись фиктивным ключом не заменяет пункты 2–6.

## F. Ownership / permissions

| Operation | EXPERT owner | EXPERT foreign | ADMIN |
|---|---|---|---|
| Read/get/list | Да, только operational scope | Read 403; чужие строки отсутствуют в list | Да, live student/lead |
| Create for existing student | Да, активное назначение + manage permission | 403 | Да; один Contract на student |
| Update unsigned metadata | Да + permission | 403 | Да, включая CRM |
| Manual signature | Да + permission | 403 | Да |
| First payment | Да + permission | 403 | Да |
| Later installment | Да + permission | 403 | Да |
| Scan upload | Да + permission; только SIGNED/PAID | 403 | Да; тот же business status |
| Scan download | Да | 403 | Да |

Read не требует manage permission, но требует live role/account и active expert profile. Student может прочитать свой договор/scan; чужой student — нет. ADMIN не обходит deleted student/lead, chronology/order/amount, frozen terms и uniqueness. ADMIN не становится экспертом/историческим signer только из-за административного подтверждения. Lead-specific `/expert/leads/...` routes остаются EXPERT-only; ADMIN работает через generic contract API и не получает права вести чужой CRM draft.

Operational owner — portrait.assignedExpert; pending CRM Lead используется только когда portrait assignment отсутствует. `signedByUserId` и Lead assignment сохраняют историческую атрибуцию. После transfer B выполняет installments/scans, A теряет contract access, но может сохранять историю своей сделки/lead list. Finance относится к историческому signer A.

Повторный поиск всех Contract writers дал три production locations:

| Writer | Creation invariant | Concurrency proof |
|---|---|---|
| `contract.repository.ts:59` | Serializable → live owner → lock User → absence check; automatic number advisory lock | Generic/generic и automatic numbers |
| `lead-contract.service.ts:127` | Serializable → account matching/reuse → shared lock → create | CRM/CRM и generic/CRM |
| `sales-expert-demo.seed.ts:442` | Serializable + batch/booking locks + shared student lock | Demo concurrent apply/idempotency/rollback |

`contractNumber` имеет DB UNIQUE. `studentId` пока имеет обычный index, не UNIQUE: исторические дубли сохранены. Поэтому гарантия одного договора относится к найденным cooperating writers, не к произвольному SQL/старому release worker. При cutover нельзя оставлять writers старого образа.

## G. Finance

F07 подтверждён permanent suite на KZT/USD/EUR: scalar totals null при смешении, `byCurrency` с раздельными точными суммами; counts числовые; single-currency totals числовые; empty set — 0/null currency/пустой массив. Пример исходного reproduction: 500 000 KZT + 100 USD + 200 EUR больше не превращаются в 500 300 без валюты.

Manual SIGNED учитывает реально подтверждённые installments, не всю price. После последнего receipt Contract.PAID не добавляет полную price второй раз. Legacy PAID без schedule учитывает historical face price. Legacy SIGNED без receipts остаётся debt. На EUR 100.03 с receipts 33.35+33.34 получены paid=66.69, remaining=33.34; final receipt даёт 100.03 без double count.

Contract rows всегда содержат собственную currency. Исторический signer определяет earnings независимо от current assignment. `byCurrency` не выполняет FX conversion. Finance отражает сохранённые факты системы; неподтверждённые исторические gateway side effects, refunds и внешняя бухгалтерия не восстанавливаются этим отчётом.

Обнаружен R07 по объёму ответа expert earnings, а не по точности валютной агрегации. SQL summary при 40k contracts/60k installments укладывается в локальный sanity budget раздела O.

## H. Analytics

При manual confirm milestones создаются атомарно: CONTRACT_SIGNED.occurredAt=фактическая подпись, PAYMENT_COMPLETED.occurredAt=первый receipt, LEAD_CONVERTED.occurredAt=фактический переход в системе. createdAt остаётся временем записи. Subsequent installment имеет свой тип и business timestamp; payment conversion считает уникальных students, не количество траншей.

Повторы/concurrency сохраняют один первый milestone; injected event error откатывает весь flow. `occurredAt ?? createdAt` обеспечивает legacy fallback. Backdated payment перед созданием аккаунта даёт undefined/null registration duration, а не отрицательное значение и не искусственный ноль. Event-list date filters относятся к effective occurrence; summary/funnel — к registration cohort. Сортировка events по-прежнему по createdAt; frontend не должен считать её business chronology.

**R03:** `analytics.service.ts:244` строит lostCreated отдельно: игнорирует dateTo и не применяет общий educationLevel filter; DISCOVERY/NONE старше 7 дней признаётся lost даже после manual payment. Проверено: один подтверждённый FULL account после синтетического старения на >7 дней увеличивает одновременно paymentsCompletedCount и lostLeads на 1. Фильтр dateTo до появления всех пользователей даёт totalStudents=0, но lostLeads>0. New CRM portraits действительно создаются с DISCOVERY/NONE. Нужно согласованное определение lost и одинаковая когорта; это не дефект записи F08 events.

**R04:** `analytics.service.ts:24,44,141` фильтрует только STUDENT; общая contract policy допускает STUDENT/SCHOOLBOY. Проверено: SCHOOLBOY через owner generic contract + manual payment получает PAID и PAYMENT_COMPLETED в БД, но отсутствует в events/summary, а getStudentJourney возвращает NotFound (HTTP 404). Если SCHOOLBOY остаётся поддерживаемой ролью, контрактная и аналитическая популяции должны совпадать. Новые CRM accounts создаются STUDENT, поэтому issue затрагивает прежде всего существующие/reused accounts.

## I. Migrations

Чистый `prisma migrate deploy` и последующий schema diff прошли для каждой из 12 suite databases; дополнительно создана отдельная audit DB. На volume DB выполнены исходные неизменённые migration SQL в лексикографическом порядке с вставкой synthetic data непосредственно перед проверяемыми migrations. Это отдельный replay эксперимент; Prisma migration bookkeeping проверялся clean runner. Финальный `prisma migrate diff --from-config-datasource --to-schema src/prisma/schema.prisma --exit-code`: **No difference detected**.

Volume environment: Node 22.15.1, Docker PostgreSQL **16.15 aarch64 Alpine**, локальный Mac; не production hardware. Dataset: **100 000 Lead, 40 000 Contract/40 000 student portraits, 20 000 historical manual contracts, 60 000 installments, 300 000 исходных journey events**, legacy USD/EUR. После backfill **390 000 events**, DB ~184 MB до дополнительной загрузки 120 000 gateway transactions. Один expert владеет всеми contracts — специально тяжёлый skew для earnings/list. Это значимый synthetic workload, но не распределение, concurrency и объём целевой production БД.

| Migration / действие | Wall time локально | Строки/результат | Locks / риск |
|---|---:|---|---|
| `20260915130000_lead_status_changed_at` | 1 448.90 ms | UPDATE 100 000 Lead; затем default/NOT NULL/index | ACCESS EXCLUSIVE на Lead, UPDATE всей таблицы, обычный index; lock держится до COMMIT |
| `20260916160000_add_user_middlename` | 0.93 ms | Nullable column | Короткий ALTER lock, ожидание активных transactions возможно |
| `20260928130000_manual_contracts` | 9.09 ms | Nullable Contract columns, enum, новые tables/indexes/FKs; старые contracts не переписаны | ALTER Contract lock; FK связаны с существующими tables; новые дочерние tables пусты |
| `20260928150000_journey_occurred_at` | 53.25 ms | Nullable field + index на 300k events | Index не CONCURRENTLY; DDL/write blocking возможен |
| `20260928151000_backfill_manual_journey` | 1 792.75 ms | INSERT 60 000 milestones + 30 000 subsequent events | INSERT + чтение historical tables; WAL/индексы и transaction duration |
| Backfill повтор до обновления статистики | 20 123.71 ms | 0 + 0 inserted | Семантически идемпотентно; plan чувствителен к статистике |
| Backfill повтор после ANALYZE, EXPLAIN ANALYZE | 349.90 + 48.16 ms | 0 + 0 inserted | Подтверждает planner sensitivity, не гарантирует production latency |

Проверка locks: отдельная transaction держала ACCESS SHARE на Lead; исходная status migration с `lock_timeout=200ms` получила SQLSTATE **55P03**. После освобождения reader полный неизменённый SQL применился успешно. Это ожидаемое искусственное прерывание, не неуспешный штатный migration run. Приложению нужен maintenance window и контроль долгих transactions.

В этих четырёх целевых migrations нет DROP/DELETE/TRUNCATE и конвертации historical currency/price. Manual table FKs: LeadDraft→Lead CASCADE, installment→Contract RESTRICT, confirmedBy→User SET NULL. CASCADE — поведение будущего удаления, сама миграция строки не удаляет. Nullable→NOT NULL используется только statusChangedAt после полного заполнения. Его UPDATE создаёт WAL/dead tuples; учитывать свободный диск, replication lag, vacuum/analyze.

Backfill выбирает первый user/type milestone и не создаёт повтор, если historical event уже существует; существующее неверное событие не исправляет. createdAt новых backfill rows — время миграции. У later events dedupe по user/contractId/installmentNumber. Полной DB UNIQUE-защиты этих semantic keys нет; нельзя параллельно запускать standalone backfill и старые writers. Миграционные файлы DDL не предназначены для ручного многократного применения; повторяемость deploy обеспечивается `_prisma_migrations`, standalone повтор проверялся только для backfill.

До cutover измерить время, locks и планы на свежей восстановленной копии целевой БД с теми же major versions/extensions/resources. Локальные 1–2 секунды не являются обещанием production времени.

## J. Historical-data audits

Создан [final-release-historical.sql](audits/final-release-historical.sql): **26 SELECT-проверок**, одна REPEATABLE READ READ ONLY transaction, statement_timeout=120s, lock_timeout=5s. Без DDL/UPDATE/DELETE и без автоматического исправления. Скрипт рассчитан на финальную схему; до cutover запускать на копии, на которую уже применены candidate migrations. Старые [duplicate audit](audits/phase1-contract-duplicates.sql) и [currency audit](audits/phase2-currencies.sql) оставлены без изменений.

| Группа | Покрытие |
|---|---|
| C01–C04 | Duplicate student contracts/contractNumber; invalid/deleted student/role; current-vs-historical owner и inactive/unassigned owner |
| P01–P06 | SUCCESS без providerRef; duplicate ref; SUCCESS без наблюдаемых benefits; benefits без receipt; amount/currency/tier reconciliation; schedule total/count |
| M01–M08 | Converted без contract; manualConfirmed без первого receipt; receipt без signature; PAID с долгом; SIGNED без долга; account-before-payment; missing manual benefits; order chronology |
| J01–J08 | Duplicate first milestones; missing milestones; occurredAt anomalies/date mismatch; negative chronology; duplicate/missing later installment events |

Скрипт успешно выполнен на volume data за ~1 032 ms без SQL ошибок. Invariant queries по contracts/schedules/milestones вернули 0 anomalies. REVIEW-запросы намеренно вернули candidates: P03=40k, P05=40k, M06=40k, M07=30k — synthetic volume fixture не создаёт service packages, использует legacy subscriptions и accounts-before-payment. Это не свидетельство загрязнения production и не утверждение, что synthetic volume set бухгалтерски чист.

Также проверен на маленькой audit DB с воспроизведениями R02/R08, transfer и backdating: M07 нашёл cases missing benefits, C04 — смену владельца, J06 — ожидаемые оплаты до регистрации. Результаты candidates не нужно «исправлять» только ради пустого SQL output. Transfer A→B с разными historical/current owners допустим; старый account reuse допустим; account-after-payment и отрицательная registration lag допустимы по новому процессу.

Исторический callback payload/подписанная currency/amount отдельно не сохраняются. P05 сравнивает внутренние ledger/contract и лишь выявляет кандидатов: exact provider reconciliation требует merchant export, order id/payment id, валюту/amount/capture и банковский факт. Разные legacy tier purchases могут не равняться contract face value.

**Production historical audit не выполнялся.** Release owner должен зафиксировать snapshot, число findings каждого запроса, решение для каждой категории и проверку benefits по R02. Новый SQL не восстанавливает исчезнувшие historical receipts и не доказывает, что старые SUCCESS были криптографически проверены.

## K. Frontend compatibility

Все URL ниже имеют prefix `/api/v1`. Backend готов к разработке интеграции, но старый UI несовместим с изменённым timing account creation и mixed-money nulls. Frontend repository/сборка/E2E в этой сессии отсутствовали.

| Backend change | Required frontend action | Breaking? | Release blocker? |
|---|---|---|---|
| NEW/FOLLOW_UP/SIGNING/SIGNED | Четыре tabs, корректные русские labels, отдельная SIGNING dashboard card | Да для старой логики tabs | Да |
| CONTRACTS overlap | Не складывать CONTRACTS с SIGNING/SIGNED; ARCHIVE отдельный фильтр | Семантическое | Да для корректных counters |
| statusChangedAt | Колонка времени и сортировка по входу на стадию; не createdAt/update/signature | Семантическое | Да |
| Summary filters | Посылать те же search/source, что list; одинаковые refresh/realtime invalidations | Нет, additive filters | Да |
| Prepare `contract:null` | Хранить `draft` из prepare; `contractDraft` из detail; не открывать несуществующего student | Да | Да |
| Separate identity | firstname/lastname/middlename ученика; отдельный parent; учитывать Lead.role parent/student | Да для старой общей формы | Да |
| Prices | 1 500 000 KZT, 750 000 KZT означает Cambridge Line; никакого FX для новых contracts | Да для произвольной старой цены | Да |
| FULL / INSTALLMENT | Director-approved integer count; FULL=1, INSTALLMENT=2..120; preview API | Да | Да |
| Decimal schedule | Использовать server amount strings/dueDate, не делить/округлять сумму в браузере | Additive | Да |
| Manual signature | `/expert/leads/:id/contract/signature`; signature сама не закрывает lead | Да | Да |
| First receipt | `/expert/leads/:id/contract/confirm`; timezone timestamp, точная сумма; можно signedAt в том же body | Да | Да |
| Existing student 409 | Явное подтверждение EXISTING_STUDENT_CONFIRMATION_REQUIRED; повтор с existingStudentId | Additive interaction | Да |
| Idempotent retry | Сохранить исходный paidAt/signedAt при сетевом повторе; не подставлять новое now | Семантическое | Да |
| SIGNED ≠ PAID | Показывать schedule, paid/remaining; later `/contracts/:id/installments/:number/confirm` | Да | Да |
| Finance null scalars | `byCurrency`, отдельная валюта у каждой суммы; null не превращать в 0 | Да для numeric-only consumers | Да |
| Analytics timestamps | Отличать business occurredAt от recorded createdAt; поддержать 4 новых/актуальных типа событий | Additive, semantics | Да для analytics screens; R03/R04 |
| Disabled OTP | Убрать sign-by-OTP actions; 409 MANUAL_SIGNATURE_REQUIRED трактовать как manual workflow | Да | Да |
| Private scans | Multipart `file` ≤10MiB PDF/JPEG/PNG; authenticated blob download; никакого public URL из scanFileKey | Additive | Да для сканов |
| Transfer / permissions | После 403 обновлять operational scope; не считать historical signer владельцем | Да для старых assumptions | Да |
| R05 OpenAPI omissions | До исправления использовать проверенные response examples/manual docs; не выпускать непроверенный generated client | Да для schema-driven клиента | Да |

Frontend integration tests должны покрыть new parent lead, student lead, existing account reuse, FULL, Cambridge 750k, monthly 31→28/29→31 schedule, partial payment, transfer и mixed currency nulls. Не считать integration complete только потому, что endpoint отдаёт 2xx.

## L. OpenAPI/docs

OpenAPI действительно сгенерирован через **SwaggerModule.createDocument** из текущих 53 скомпилированных controller classes: **223 paths, 103 schemas**, prefix `/api/v1`, bearer scheme. Для генерации service dependencies заменены inert DI mocks; использованы настоящие decorators/DTO metadata после успешного build. Это проверка schema generation, не live bootstrap всего AppModule и не deployed `/api-json`.

**R05 — observed mismatches:**

| Area | Generated OpenAPI | Реальный implementation |
|---|---|---|
| Finance summary/earnings | `200: {description:""}`, без response schema | Nullable scalars, currency, byCurrency и structured totals |
| Prepare/draft/manual confirmation | Input DTO видны; response schema отсутствует | Разные draft-only и confirmed response shapes, contract nullable |
| Analytics | Response schema отсутствует; eventType arbitrary string | occurredAt/createdAt, 4 relevant types, null duration semantics |
| OTP student/expert | 200 OTP sent / Contract signed; нет deprecated/409 replacement | Всегда guard 409 MANUAL_SIGNATURE_REQUIRED |
| Scan upload | Нет requestBody `file` binary schema | Multipart field file, size/MIME restrictions |
| Scan download | Пустое 200; не описан binary/auth contract | Authenticated StreamableFile, content type, attachment, private/no-store |
| FreedomPay | JSON FreedomPaymentDto с legacy required properties; пустое 200 | Raw signed scalar fields, form/multipart, extensions; signed XML response |
| Generic create example | price=150000, currencies KZT/USD/EUR | Для нового договора только 1500000/750000 KZT |
| Authentication | Bearer component существует, но у проверенных protected operations нет `security` declaration | HTTP требует auth guards |

SIGNING/SIGNED enum и summary search/source параметры отражены input metadata. Наличие правильных input DTO не компенсирует отсутствие response schemas. Required поля legacy FreedomPaymentDto не являются точным описанием реально принимаемых callback fields.

`deployment/manual-contracts.md` правильно объясняет draft response, manual endpoints, schedule, private scan и frozen terms; README/phase2 report описывают currency/occurredAt. Но эти тексты не делают Swagger соответствующим runtime. Плюс local `compose.yaml` всё ещё содержит result URL `/api/v1/billing/result`, которого нет у PaymentController; в `.env.example`/deployment example route уже актуален. Этот local-only drift не доказывает неверный server URL, но мешает воспроизводимой интеграции.

Необходимо обновить машинный API contract и убрать обещания OTP success до frontend acceptance. Документация в рамках этого аудита не исправлялась.

## M. Environment readiness

Реальные secret values не читались для отчёта и не выводились. Проверены код, env templates, Compose и deploy scripts. Глобальной production validation schema для env нет; отсутствие общего fail-fast не равно автоматическому security bypass, но healthcheck не доказывает работоспособность каждой внешней интеграции.

| Variables | Runtime requirement / defaults | Missing / unsafe config behavior | Gate |
|---|---|---|---|
| DATABASE_URL / POSTGRES_* | Явный target DB, отдельные доступы/backup; PrismaPg из DATABASE_URL; server compose собирает URL | Некорректное подключение ломает database bootstrap/queries; нет app-level обязательной schema | Проверить actual target, migrations, restore и соединения |
| REDIS_URL / REDIS_PASSWORD | BullMQ, realtime adapter и invitation/outbox delivery; server URL содержит пароль | Redis failure не теряет durable DB intents, но задерживает delivery; Socket.IO bootstrap может перейти на in-memory | Обязательны shared Redis и multi-instance reconnect/delivery smoke |
| JWT_SECRET / JWT_REFRESH_SECRET | Независимые сильные runtime secrets; приглашения derive signing key из JWT_SECRET | В коде нет test-secret fallback; без ключа sign/verify не работают. Placeholder из env template автоматически не запрещён | Проверить provisioning/rotation; default template values недопустимы |
| FREEDOM_RECEIVE_SECRET_KEY / MERCHANT_ID / RESULT_URL | Receiving secret, правильный merchant, HTTPS public POST callback/basename | Verifier при отсутствии — 503; mismatched signature/context — reject | ENVIRONMENT VALIDATION REQUIRED |
| FREEDOM_TESTING_MODE | Только 0/1; код default=0; staging test требует 1 | Invalid value reject; отсутствующий даёт 0. **R01: server compose не передаёт переменную** | Проверить effective container value, не только .env |
| FREEDOM_API_URL / SUCCESS_URL / FAILURE_URL | Полные URL для init/redirect; provider result method отдельно R06 | Некорректный init завершается error; startup не доказывает readiness | Реальный test init/callback |
| FREEDOM_PAYMENT_SECRET_KEY | Для payout; callback не использует | Не заменяет receiving secret | Не перепутать назначение ключей |
| SMTP_SERVER / SMTP_PORT / SMTP_SECURE / SENDER_EMAIL / SENDER_PASSWORD | SMTP credentials, корректный TLS/порт; defaults 587/false | Transport создаётся без startup verify; ошибка проявляется при отправке, outbox остаётся для retry | Доставка invitation и recovery при SMTP outage |
| AWS_BUCKET_NAME / AWS_MINIO_ENDPOINT / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY | ContractScanService getOrThrow; отдельный `${AWS_BUCKET_NAME}-contracts` | Missing значения обычно fail startup; empty strings/права требуют проверки. Private bucket создаётся lazy | Create/read/write permissions, anonymous GET denied, backup |
| AWS_MINIO_PUBLIC_URL | Public assets only; default в MinioService localhost:9000 | Неверный URL даёт неработающие public assets; contract scans не используют public URL | Проверить external URL и изоляцию private bucket |
| FRONTEND_URL / APP_URL / EXPERT_DASHBOARD_URL / CORS_ORIGINS | Точные origin/activation/meeting links | Invitation/call code имеет fallback oxusedu.com; missing staging URL может отправить в другой frontend | Явно задать target URLs, browser CORS/cookies smoke |
| NODE_ENV / STAGING | production container; STAGING=true разрешает demo seed | Deploy проверяет STAGING против среды; STAGING не переключает FreedomPay testing mode | Production=false для STAGING; никогда не запускать demo на production |
| CHROME_WS_URL / JITSI_* | Нужны для legacy PDF/online meetings, которые остаются в приложении | Проверки manual-flow не доказывают доступность этих сервисов | Target runtime startup + применимые smoke |

**R01 reproduction:** `FREEDOM_TESTING_MODE=1 docker compose --env-file deployment/.env.example -f deployment/compose.yaml config --format json` с выводом только проверяемого ключа дал `{requested_mode:"1", container_mode:"ABSENT", has_env_file:false}`. Файл `.env` используется Compose для interpolation; он не инжектируется целиком в container. В `deployment/compose.yaml:54` перечислены остальные FreedomPay keys, но testing mode отсутствует. Service поэтому берёт 0: test callbacks отвергаются, init не запрашивает test mode. Реального списания не делалось; риск зависит от доступов merchant. Добавление ключа в env template само по себе проблему не решило.

Server deploy templates имеют placeholders, local Compose имеет явные dev credentials/NODE_ENV=development. Код не запрещает случайно перенести placeholder secret в production. Нельзя объявлять environment readiness, основываясь только на `compose config --quiet` или HTTP health.

## N. CI / test gate

**CI CONFIGURATION VERIFIED LOCALLY**

**REMOTE CI NOT YET VERIFIED**

Workflow YAML распарсен и прочитан: quality job включает PostgreSQL 17-alpine и Redis 7-alpine, порты и health checks; immutable dependency install, Prisma generate, ESLint, Jest, build, tsc, integration runner, deployment tests/shell syntax, Compose validation. Docker/promotion jobs зависят от quality; Test deploy зависит от docker. Runner требует Redis URL и отдельную local `_test` DB, создаёт уникальную DB на suite, делает migrate deploy + schema diff, запускает suite и удаляет только созданную DB. Nonzero child process завершает runner ошибкой; ошибок не подавляет.

| Gate | Результат текущего запуска |
|---|---|
| Nest build | PASS, exit 0 |
| tsc --noEmit | PASS, exit 0 |
| ESLint без --fix | PASS, exit 0 |
| Jest | 38 suites, 263 passed / 0 failed; skipped нет |
| Phase 1 security | 28 / 28; skipped 0 |
| Phase 2 reporting | 18 / 18; skipped 0 |
| Phase 2 migration/backfill | 1 / 1; skipped 0 |
| Manual HTTP | 11 / 11; skipped 0 |
| Sales contract reliability | 12 / 12; skipped 0 |
| Sales V2 HTTP | 9 / 9; skipped 0 |
| Expert lead visibility | 6 / 6; skipped 0 |
| Sales V2 regression | 40 / 40; skipped 0; реальный Redis outage/recovery |
| Lead call notifications | 9 / 9; skipped 0 |
| Lead status migration | 1 / 1; skipped 0 |
| Demo | 1 / 1; skipped 0; 36 fixtures, repeat/concurrent/rollback внутри suite |
| Integration smoke | 11 сценариев, 11 PASS |
| Deployment Python unittest | 18 / 18, 0 skipped |
| Shell syntax / both Compose configs | PASS |
| Clean migration/schema diff | PASS во всех 12 runner entries; отдельный volume diff PASS |
| git diff --check | PASS |
| Дополнительные временные audit checks | 11 / 11, skipped 0; включая characterization R02/R03/R04/R06/R08 |

Итого постоянных formal tests: **263 + 136 + 18 = 417**; дополнительные 11 дают **428 executed formal checks**, плюс 11 smoke scenarios. `0 skipped` относится к реально выполненным наборам. Реальные merchant/SMTP/S3/frontend acceptance и remote workflow не выполнялись, и не обозначены как passed или «0 skipped интеграции». Отдельный шаблонный `test:e2e` с полным AppModule и сторонние production import smoke scripts не входят в CI runner и здесь не запускались. Полный deployment image build/start на staging также не имитируется локальными Nest harnesses.

Локальные PostgreSQL 16.15/Redis audit containers отличаются от CI PG17/Redis7 и server template PG16.0/Redis8. Поэтому локальный runner не заменяет remote execution и target-container smoke. Повторная установка зависимостей не выполнялась; проверялись установленные workspace dependencies. Не замечено failures permanent suites. Начальные ошибки временного harness (неверный URL confirm и неполный fake init config) устранены только в `/private/tmp`; финальный дополнительный run зелёный.

Основные локальные evidence: `/private/tmp/oxus-release-{unit,integration,deployment,build,tsc,lint,additional-final,volume,performance,volume-schema}.log`; generated OpenAPI и JSON plans — `/private/tmp/oxus-release-audit/`. Эти временные файлы не являются постоянной regression coverage. Для нового candidate после fixes потребуется добавить настоящие regression tests отдельно.

## O. Performance sanity

После загрузки synthetic data выполнен ANALYZE и EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON). Для finance использован тот же SQL aggregate, что в сервисе; для ownership/analytics — SQL эквиваленты predicates/joins, поэтому времена не означают полную HTTP latency.

| Query | Execution time | Rows / наблюдение |
|---|---:|---|
| Finance byCurrency + receipts aggregate | 58.889 ms | 4 expert/currency/status groups; одна агрегация receipts, без N+1 |
| Analytics effective occurredAt date range + page | 5.212 ms | 20 rows, date indexes доступны |
| Analytics all PAYMENT_COMPLETED milestones | 23.534 ms | 20 000 rows затем обрабатываются в JS |
| Ownership contract/student/role/portrait/expert/lead lookup | 0.165 ms | 1 row; indexed lookup |
| Expert contracts unpaged select | 34.701 ms | 40 000 rows, sort всех подходящих contracts |
| Lead list CONVERTED + statusChangedAt limit20 | 13.926 ms | 20 rows; большое смещение распределения статусов |
| Student journey history | 0.032 ms | 11 rows; userId/createdAt index |
| ProviderRef lookup на 120k Transaction | 11.737 ms | Seq scan: providerRef не индексирован |
| Backfill no-op после ANALYZE | 349.895 / 48.156 ms | Две INSERT-select части; 0 новых rows |

Дополнительно вызваны **существующие compiled services с реальным Prisma** и сериализован результат:

| Service | Wall time | Heap delta до JSON stringify | JSON size |
|---|---:|---:|---:|
| Finance getSummary | 122.98 ms | 1.12 MiB | <0.01 MiB |
| Finance getExpertEarnings, 40k contracts | 1 143.31 ms | 351.46 MiB | 19.72 MiB |
| Analytics getSummary, 390k events | 202.33 ms | 40.66 MiB | <0.01 MiB |
| ContractRepository.findAllByStatus, 40k contracts | 663.20 ms | 146.75 MiB | 31.95 MiB |

**R07 evidence:** `finance.service.ts:217` загружает весь список contracts + installments + student/signer, затем строит второй mapped список; `contract.repository.ts:49` также не ограничивает list. Одиночный запрос ещё завершается, но response size и heap не ограничены API; несколько одновременных запросов могут исчерпать heap/container memory. JSON stringify требует дополнительной памяти сверх таблицы. Heap delta — одно измерение JS allocation с GC перед вызовом, не peak RSS и не p95. Нельзя объявлять доказанный production OOM либо acceptable production throughput на основании этого замера.

Для current summary/point ownership локальная sanity-проверка удовлетворительна. Для R07 определить максимальное число contracts на expert/admin, размеры history и request concurrency; нужна пагинация/ограничение или подтверждённый operational cap до большого rollout. Analytics summary/history также непагинированно загружают milestones/history; требуется наблюдение роста. Отсутствие providerRef index и чувствительность backfill к статистике — конкретные дальнейшие точки проверки, без оптимизаций в этом аудите.

## P. Rollout plan

1. Отдельной работой закрыть R01/R08 и согласовать обработку R02; решить reporting/API blockers, подготовить постоянные tests. Зафиксировать candidate commit и immutable image digest. Нынешнее dirty tree не является promoteable artifact.
2. Получить успешный remote CI именно этого candidate. Довести frontend по K и принять общие E2E на staging.
3. Проверить effective runtime env, test merchant E2E по E, SMTP invitation/retry, MinIO private bucket/anonymous denial, public URLs/CORS/cookies, realtime across replicas.
4. Сделать свежую production copy. Выполнить кандидатные migrations, read-only historical audits, reconciliation; замерить locks/WAL/free disk/replica lag и длительность backfill, сохранить результаты. Неразобранные дубли student contracts/providerRef и receipt/benefit anomalies — stop gate.
5. Объявить maintenance window: остановить поступление expert mutations, подготовить buffering/retry callback delivery; сохранить in-flight provider orders для последующей reconciliation. Не считать клиентский timeout отменой платежа.
6. Создать и проверить восстановление DB backup + backups обеих object-storage областей, включая private contracts; сохранить previous image/config/migration state. `deploy.sh` делает production pg_dump и pg_restore --list, но это не полноценный restore rehearsal и не backup MinIO.
7. Остановить **все** backend replicas/workers/cron/seed writers старого релиза. `deploy.sh` останавливает предыдущий backend container; внешние/дополнительные workers он сам не обнаруживает. Проверить active transactions и отсутствие старых consumers.
8. Один migrator применяет pending migrations в порядке I, включая backfill. При lock timeout/ошибке приложение не запускать частично; изучить migration state и завершить/восстановить согласованно. Не редактировать checksum существующих migrations.
9. После успешного schema diff/audit включить только новый backend image; убедиться в version/digest и health, затем совместимый frontend. При отсутствии feature flag удерживать maintenance до готовности обоих.
10. Выполнить smoke R. Проверить число invitations/outbox retries, очереди, failed callbacks, unexpected 403/409/500, actual receipts/finance и latency/heap. Не запускать demo seed на production.
11. Возобновить traffic; отдельно reconcile callbacks/orders, поступившие в maintenance. Платёжная retry policy провайдера ограничена, поэтому нельзя полагаться на бесконечную доставку.

Критическое окно: если старый worker создаст manual payment после backfill и до нового приложения, его events могут остаться отсутствующими. Повторный `migrate deploy` уже выполненную migration не повторит. Нужны отсутствие mixed writers и post-cutover SQL audit; обнаруженные пробелы закрываются отдельно согласованным idempotent forward backfill, не повторным редактированием migration.

## Q. Rollback plan

| Boundary | Допустимый rollback |
|---|---|
| До начала migrations | Вернуть предыдущий образ/config; deploy script автоматически пытается запустить прежний backend при раннем failure |
| Additive schema применена, новых business writes ещё нет | Технически старый image может игнорировать columns/tables; совместимость старого workflow проверять отдельно. Оставить maintenance и additive schema; не делать DROP для косметического совпадения |
| Backfill выполнен | События уже являются данными. Старый analytics может игнорировать occurredAt и трактовать createdAt неверно; application rollback не возвращает прежнюю отчётность |
| Созданы drafts/new accounts/receipts/installments/events/scans | Старый account-before-payment/OTP release не умеет новый workflow. Приоритет forward fix; заморозить затронутые mutations, не включать старых workers |
| Реальный payment/выданные credentials/отправленные invitations/загруженные scans | Эти внешние эффекты не откатываются восстановлением DB. Нужна reconciliation и отдельное решение, не автоматический refund/delete |
| Катастрофическое восстановление snapshot | Только с принятым RPO и остановкой writers; сверить все последующие платежи, события, credentials и object storage, затем восстановить согласованное состояние |

Миграции additive, но Prisma down scripts не предоставлены. Удаление новых tables/columns уничтожит реальные факты и не является безопасным обратным ходом. `deploy.sh` после старта migration не делает автоматический DB rollback и оставляет диагностику; это правильная граница для ручного решения.

## R. Production smoke checklist

Данные для изменяющего smoke заранее согласовать как synthetic/canary и исключить из реальной отчётности либо выполнять полный business сценарий в staging clone. Не создавать фиктивный финансовый факт на настоящем клиенте и не проводить реальные списания ради теста.

| Проверка | Acceptance |
|---|---|
| Health/login EXPERT | Правильный image, auth, live role/profile, refresh/cookies |
| Lead list + summary | Одинаковые filters, все tabs, SIGNING card, statusChangedAt; CONTRACTS не суммируется |
| Draft parent/student | contract=null, отдельные identity; отсутствие User/Contract до первого receipt |
| Signature | Lead остаётся SIGNING; нет invitation/payment benefits |
| Manual first receipt | Точная сумма, один account/contract/package/invitation intent, lead CONVERTED |
| Retry | Повтор того же body не меняет counts/slots; другой timestamp даёт conflict |
| Invitation | Реальное письмо, правильный frontend URL, one-use activation; queue/SMTP recovery |
| Finance | Partial/final paid/remaining, mixed byCurrency/null, historical signer |
| Analytics | Первый milestone один, later events отдельные, корректные business dates; R03/R04 устранены/учтены |
| Transfer A→B | B продолжает операцию, A получает запрет; история остаётся A |
| Subsequent installment | Нельзя пропустить порядок/подменить сумму; последний делает PAID |
| Scan | Upload/download owner/admin/student; foreign/anonymous denied; private bucket недоступен anonymous URL |
| ADMIN | Unsigned metadata, payment, scan разрешены; business validation и live account ограничения сохраняются |
| OTP | Четыре routes возвращают MANUAL_SIGNATURE_REQUIRED |
| Invalid FreedomPay callback | 403/400, никаких mutations; безопасный synthetic order |
| Valid gateway callback | Только настоящий test merchant на staging; signature/XML/one SUCCESS/exactly-once benefits |
| Production gateway config | Mode=0, correct merchant/URL, canary observability; реальные платежи только по согласованному бизнес-процессу |

## S. Remaining business decisions

Это решения бизнеса, не автоматически технические ошибки:

1. Подтвердить у директора равные доли и правило распределения копеечного остатка. Сейчас разница до 0.01 KZT, сумма schedule точно равна price; первые транши получают остаток. Число 2..120 — технический предел, не утверждённая коммерческая линейка.
2. Подтвердить, что цена 750 000 сама определяет Cambridge Line; отдельной проверки membership по текущему требованию нет.
3. Определить допустимость предоплаты до даты подписи. Код требует оба факта к confirmation, запрещает future timestamps, но не требует `paidAt >= signedAt`; это не названо нарушением без business правила.
4. Утвердить доступный tariff/package для продажи за 1 500 000 / 750 000. FREE на paid generic contract — R08; выбор AI_ROADMAP против EXPERT_MENTORSHIP требует бизнес-ясности.
5. Утвердить treatment legacy SIGNED benefits и in-flight gateway receipts после перевода на manual. Не доначислять/не учитывать платёж дважды без reconciliation.
6. Уточнить аналитическое определение «потерянного лида» и population SCHOOLBOY. Несогласованный dateTo в R03 остаётся технической ошибкой независимо от выбранного определения.
7. Подтвердить operational policy ADMIN-confirmation для non-CRM student без assigned expert: текущая policy сохраняет unassigned и не создаёт package для несуществующего эксперта. Назначение и выдача услуг должны иметь ответственного.
8. Зафиксировать, что scans прикрепляются позже; сейчас они не обязательны для confirmation. Напоминания/блокировка за просрочку, исправление ошибочного receipt, refund и онлайн-подпись находятся вне текущей реализации и не должны обещаться UI.

До закрытия перечисленных технических и внешних gates статус **READY FOR PRODUCTION** не подтверждён.
