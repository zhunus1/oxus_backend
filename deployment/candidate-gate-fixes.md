# Candidate gate fixes — 2026-09-29

Scope: **только C01–C03**, относительно snapshot из [Final Candidate Gate](final-candidate-gate.md). F01–F11 и R01–R08 сохранены как baseline. Commit, push, deployment и реальные merchant calls не выполнялись.

**C01 / C02 / C03: PASS в проверенном локальном scope.** HTTP lifecycle исправлен после воспроизведения вне backend; callback URL и Contract redaction исправлены. Три последовательных full integration runners после последней code change зелёные. Candidate готов к повторному Final Candidate Gate; commit-ready оценивается по его результату.

| Finding | Before | Root cause | Fix / disposition | Regression | After |
|---|---|---|---|---|---|
| C01 | Исторический admin test `read ECONNRESET`; третья новая full-series попытка: Phase2 `socket hang up` | Supertest per-request listen/close в harness; аналогичный reset воспроизведён HTTP-only без backend/DB/Redis | Один listener на suite в девяти HTTP harnesses; awaited teardown сохранён | Red/green lifecycle regression + controlled 5000/5000 experiment + новые полные runners | **PASS**, в scope HTTP lifecycle runner; границы причинного вывода описаны ниже |
| C02 | Local Compose принудительно задавал несуществующий `/api/v1/billing/result` | Устаревшая hardcoded настройка перекрывала корректный `.env` | `${FREEDOM_RESULT_URL:-http://localhost:4000/api/v1/payment/freedompay-webhook}` | Render local/server examples, override, local fallback; compiled runtime probe сверяет route metadata, реально отправляемый `pg_result_url` и POST; OpenAPI callback test | **PASS** |
| C03 | Реальный ContractService/repository сериализовал четыре внутренних OTP-поля | Prisma `include` добавляет relations, но не исключает scalar credentials; общий repository возвращал полный Contract | Общий `contractInternalOmit` для generic и manual reads/write responses; отдельная узкая внутренняя projection для legacy student OTP verification | 6 новых permanent integration tests + OpenAPI key-absence test; JSON serialization, populated/null keys, nested/manual/retry/direct reads | **PASS** |

## C01: reproduction и диагностика

Исходное evidence сохранено: `/private/tmp/oxus-candidate-integration.log:871–880`. Последующий старый diagnostic PASS не отменён и не подменяет исходный failed run.

Перед production changes выполнены на исходном compiled baseline:

| Изолированный запуск | Чистая DB | Passed | Failed / skipped | Evidence |
|---|---|---:|---|---|
| Suite 1 | Отдельная | 11 | 0 / 0 | `/private/tmp/oxus-fixes-c01-suite-1.log` |
| Suite 2 | Отдельная | 11 | 0 / 0 | `/private/tmp/oxus-fixes-c01-suite-2.log` |
| Suite 3 | Отдельная | 11 | 0 / 0 | `/private/tmp/oxus-fixes-c01-suite-3.log` |
| Suite 4 | Отдельная | 11 | 0 / 0 | `/private/tmp/oxus-fixes-c01-suite-4.log` |
| Suite 5 | Отдельная | 11 | 0 / 0 | `/private/tmp/oxus-fixes-c01-suite-5.log` |
| Suite 6 | Отдельная | 11 | 0 / 0 | `/private/tmp/oxus-fixes-c01-suite-6.log` |
| Suite 7 | Отдельная | 11 | 0 / 0 | `/private/tmp/oxus-fixes-c01-suite-7.log` |
| Suite 8 | Отдельная | 11 | 0 / 0 | `/private/tmp/oxus-fixes-c01-suite-8.log` |
| Suite 9 | Отдельная | 11 | 0 / 0 | `/private/tmp/oxus-fixes-c01-suite-9.log` |
| Suite 10 | Отдельная | 11 | 0 / 0 | `/private/tmp/oxus-fixes-c01-suite-10.log` |
| Exact test 1 | Отдельная | 1 | 0 / 0 | `/private/tmp/oxus-fixes-c01-target-1.log` |
| Exact test 2 | Отдельная | 1 | 0 / 0 | `/private/tmp/oxus-fixes-c01-target-2.log` |
| Exact test 3 | Отдельная | 1 | 0 / 0 | `/private/tmp/oxus-fixes-c01-target-3.log` |
| Exact test 4 | Отдельная | 1 | 0 / 0 | `/private/tmp/oxus-fixes-c01-target-4.log` |
| Exact test 5 | Отдельная | 1 | 0 / 0 | `/private/tmp/oxus-fixes-c01-target-5.log` |
| Exact test 6 | Отдельная | 1 | 0 / 0 | `/private/tmp/oxus-fixes-c01-target-6.log` |
| Exact test 7 | Отдельная | 1 | 0 / 0 | `/private/tmp/oxus-fixes-c01-target-7.log` |
| Exact test 8 | Отдельная | 1 | 0 / 0 | `/private/tmp/oxus-fixes-c01-target-8.log` |
| Exact test 9 | Отдельная | 1 | 0 / 0 | `/private/tmp/oxus-fixes-c01-target-9.log` |
| Exact test 10 | Отдельная | 1 | 0 / 0 | `/private/tmp/oxus-fixes-c01-target-10.log` |

Каждый isolated запуск сначала применял 42 migrations в новой disposable PostgreSQL DB, затем удалял только эту DB. Exact runs используют `--test-name-pattern` для указанного сценария; это диагностический отбор, а не удаление остальных permanent tests. Полные isolated suites выполняли все 11 tests. Скрипт выполнял фиксированное число прогонов, не останавливался на первом зелёном результате и сохранял каждый exit code.

После C02/C03 первая серия full runners дала **PASS / PASS / FAIL**. В третьем runner упал `phase2-reporting.test.ts`, `F09: every tab shares search/source, owner and soft-delete filtering with summary`: `socket hang up`, `ECONNRESET`, `Socket.socketOnEnd (node:_http_client:542:25)`. Это уже **подтверждённый client HTTP socket**, а не ошибка SQL transaction или Redis. Остальные Phase2 tests завершились; runner остановил дальнейшие suites согласно прежнему fail-fast. Полный лог: `/private/tmp/oxus-fixes-integration-3.log:1585–1598`.

Дополнительно выполнены 10 isolated Phase2 suites на fresh DB до lifecycle fix: runs 1–10 по 18/18 PASS, failures/skips 0 (`/private/tmp/oxus-fixes-c01-phase2-phase2-{1..10}.log`). Это подчёркивает, почему один зелёный повтор не был принят как fix.

### Выделение источника и минимальный reproduction

Изучены `test/admin-expert-profile.test.ts`, `test/phase2-reporting.test.ts`, runner, Prisma lifecycle, `AdminService.updateAdminUser` и установленный Supertest/Superagent:

- Harness вызывал `app.init()`, но не запускал постоянный HTTP listener. В `Supertest.serverAddress()` каждый `request(server)` при `server.address() === null` делал `listen(0)`; `Test.end()` затем закрывал этот listener перед завершением request promise.
- В target admin-сценарии все операции awaited; в Phase2 F09 последовательно выполняется до 168 HTTP requests. Каждый request создавал новый цикл listen/close и новый ephemeral port.
- Более поздний admin concurrency test выполнял три PATCH через awaited `Promise.all`. В первоначальной трассировке полных isolated suites был один close с другими активными запросами; это ещё одна причина передать владение listener всему suite. Она не объявляется доказанным событием исходного исторического failure.
- Superagent использует `_agent=false`. Гипотеза про reused default global keep-alive socket не подтвердилась. Port collision/конкретный дефект TCP kernel также не заявляются: таких evidence нет.
- DB connect/disconnect awaited; Prisma shutdown hooks и явный disconnect выполняются при teardown после tests. HTTP response ожидает завершения transaction. Runner через синхронный spawn ждёт завершения child process, только затем удаляет его уникальную DB. Между suites shared DB teardown отсутствует.
- Redis не участвует в проблемном admin harness: realtime/journey stubs не создают сетевого фонового work. Отдельная regression намеренно моделирует Redis outage и имеет собственный recovery test.

Контролируемый experiment **без Nest, Prisma, PostgreSQL, Redis, auth и бизнес-кода**: один `node:http.createServer`, `res.end('ok')`, установленный Supertest, последовательные GET с тем же API `request(server)`. Две заранее заданные серии, без retry-until-green:

| Listener lifecycle | Запросы | Listen calls | Ошибки |
|---|---:|---:|---|
| Прежний: listener открывает/закрывает Supertest на каждый request | 5000 | 5000 | **1 `read ECONNRESET`**, request index 4498, `TCP.onStreamRead` — тот же вид stack, что у C01 |
| Listener открыт один раз до запросов, закрыт после всех | 5000 | 1 | **0** |

Evidence: `/private/tmp/oxus-fixes-http-lifecycle.cjs`, `.json`, `.log`. Все ошибки первой серии сохранены, а не подавлены ради зелёного результата. Первоначальный historical reset нельзя ретроспективно привязать к конкретному socket address: в старом логе его нет. Однако такой же сбой воспроизведён в HTTP-only experiment, и новый failure полного runner прямо указывает на HTTP-client. Обоснованный fix относится к **нестабильному per-request HTTP server lifecycle тестового harness**, без заявления о доказанном kernel bug или бездоказательной environment-only классификации.

### Исправление и permanent regression

Девять HTTP suites runner теперь делают `await app.listen(0, "127.0.0.1")` в setup. `app.listen` выполняет Nest initialization; listener живёт на протяжении suite. Supertest получает уже слушающий server, поэтому не становится владельцем его close. Существующий awaited `app.close()` в teardown сохранён. Request assertions, timeout, ordering, DB lifecycle, production code и runner не ослаблены. Никаких retry/catch на `ECONNRESET` в permanent tests нет.

Добавлен admin test `C01: HTTP listener survives sequential and concurrent requests until suite teardown`: проверяет listener до запросов, выполняет последовательные и параллельные реальные HTTP GET, проверяет неизменный address и отсутствие `close` между ними. **На старом setup test детерминированно упал** (`The suite must own a persistent HTTP listener`, 11 passed / 1 expected failure); после исправления admin suite 12/12 и Phase2 suite 18/18 прошли с tracing. Логи: `/private/tmp/oxus-fixes-c01-lifecycle-before-1.log`, `/private/tmp/oxus-fixes-c01-lifecycle-after.log`.

После fix в admin/Phase2 tracing: соответственно **48/48 и 260/260 HTTP request/finish**, по **1 listen / 1 close**, **0 close с активными requests**; адрес каждого listener сохранялся. Первый финальный full runner: **645/645 request/finish, 0 ECONNRESET, 0 active HTTP при выходе, 0 close с активными requests**. Его `ENOENT` относятся к служебным tsx IPC pipes; один `ECONNREFUSED` — намеренный Redis outage test. Evidence: `/private/tmp/oxus-fixes-c01-lifecycle-after-transport.json`, `/private/tmp/oxus-fixes-final-transport-summary.json`.

Далее выполнена новая фиксированная серия из трёх full runners на исправленном snapshot. Первый с диагностическим preload, следующие два без него. Диагностика находится только в `/private/tmp`, не входит в backend или permanent runner. Старые результаты PASS/PASS/FAIL и red-regression сохранены отдельно. Это новая проверка после изменения причины, а не повтор неизменного кода до первого зелёного результата.


## C02: Compose → route → runtime

| Источник / режим | Rendered callback URL |
|---|---|
| Local `.env.example` | `http://localhost:4000/api/v1/payment/freedompay-webhook` |
| Local без `FREEDOM_RESULT_URL` | `http://localhost:4000/api/v1/payment/freedompay-webhook` |
| Server `deployment/.env.example` | `https://test.oxusedu.com/api/v1/payment/freedompay-webhook` |
| Explicit override, обе конфигурации | `https://example.test/api/v1/payment/freedompay-webhook` |

Server Compose и оба example-файла уже корректны, поэтому не изменены. Local Compose теперь уважает override. Это сохраняет существующую env-механику; произвольное неверное операторское значение URL не «исправляется» кодом незаметно.

`PaymentController`: prefix `payment`, POST handler `freedompay-webhook`, глобальный prefix приложения `api/v1`. Generated OpenAPI содержит `POST /api/v1/payment/freedompay-webhook` с raw form/multipart callback и XML response. Runtime mode probe читает **эффективный Compose environment**, сверяет pathname с metadata настоящего compiled controller, проверяет `pg_result_url` и `pg_request_method=POST`. Подпись callback использует basename реального route.

22 deployment tests прошли, включая 5 rendered callback cases и прежние 10 runtime mode cases (local/server × `1`, `0`, invalid, empty, unset). Runtime matrix использует синтетический env из server example для обоих stacks; local default/fallback отдельно проверены rendering test. HTTP gateway замокан в probe: **реальных merchant calls нет**. Callback/OpenAPI/HTTP security regressions входят в полный integration runner.

## C03: единая redaction и инвентаризация read paths

Исходное reproduction выполнено до изменения: реальный compiled `ContractService.getMyContract` + repository + Prisma, синтетические ненулевые маркеры в rollback-транзакции. После `JSON.stringify/parse` присутствовали все четыре ключа; student/expert markers совпали. Evidence: `/private/tmp/oxus-fixes-c03-before.log`. Изменения fixture откатились.

Новый [contract-read.ts](../src/modules/contract/domain/contract-read.ts) содержит типизированный `contractInternalOmit`. Он применяется к результатам generic repository и через `manualContractRead` ко всем manual ответам. Исключение выполняется Prisma во время выборки, а не только TypeScript-типом или controller interceptor. Поля отсутствуют даже при исходном `null`.

`findStudentSigningCredentials` — отдельная узкая **внутренняя** projection, используемая только `ContractService.signByStudent`, с `id/studentId/status/studentOtpHash/studentOtpExpiry`. HTTP OTP routes остаются отключены. Prisma schema/OTP storage не изменены; permanent test проверяет, что внутренняя legacy verification ещё получает hash и подписывает договор. `recordContractEmails` принимает только реально необходимые поля через `Pick`; email flow не изменён.

| API / read path | Защита / проверка |
|---|---|
| `GET /contracts/my` | `findByStudentId` → общий omit; student HTTP regression с четырьмя ненулевыми полями и проверкой сохранности DB |
| `GET /contracts/student/:studentId`, EXPERT / ADMIN | Тот же safe repository; оба role-specific HTTP cases, прежние ownership guards сохранены |
| `GET /contracts`, EXPERT / ADMIN | `findAllByStatus` → общий omit на каждом элементе; HTTP paginated list и прямые service/repository calls |
| Repository `findById`, `findByStudentId`, `findPendingStudent` | Общий omit; реальная JSON serialization после direct invocation |
| `ContractService.getMyContract/getContractByStudentId/getAllContracts` | Safe repository results; прямые JSON regressions |
| `POST /contracts`, `PATCH /contracts/:id/meta` | Общий omit на create/update result; regression с null и populated OTP fields |
| `POST /contracts/:id/manual-signature` | Общий omit через `manualContractRead`; первая запись и idempotent repeat; DB markers сохранены |
| `POST /contracts/:id/confirm-manual` | Общий omit на update и already-confirmed read; ADMIN HTTP + direct manual service regression |
| `POST /contracts/:id/installments/:number/confirm` | Общий omit; запись очередного транша и повтор; число оплаченных траншей проверено |
| `POST /expert/leads/:id/contract`, `/signature`, `/confirm` | Draft-only returns не содержат Contract; existing/confirmed Contract использует `manualContractRead`; prepare existing + confirmation/repeat проверены |
| `GET /expert/leads/:id` nested Contract | Существующий явный `select` без OTP; regression с ненулевыми DB markers |
| `GET /admin/crm/students/:id` nested contracts | Существующий allowlist mapper в `AdminService.getCrmStudentById`; прямой service JSON regression с проверкой наличия нужного договора |
| `GET /admin/finance/contracts`, `/admin/finance/experts/:id/earnings` | Существующий allowlist `mapContract`; direct service JSON regressions; currency/finance flow не изменён |
| Student portrait / Event nested `studentContracts` | Явный `select: { status: true }`, внутренних полей нет; static read-path review |
| Expert dashboard / admin analytics | Contract используется в `where`/aggregates, не выдаётся полным объектом; static review |
| Invitation resend | Внутренняя projection Contract `id/studentId`; Contract не сериализуется в API |
| Contract scan upload/download | Внутренний read для access/key; возвращается metadata `{contractId, hasScan}` или binary stream, не Contract |
| Internal notification/PDF, access checks, create/settlement helpers | Полный объект местами нужен только внутренней логике; PDF строится из явных полей, generic JSON Contract не возвращается. Raw Prisma persistence не является публичным serializer |
| Internal `expertSign` / `studentSign` repository results | Общий omit также на возвращаемом update; внутренние transaction reads для state/OTP checks сохранены |

6 новых C03 tests проверяют recursive key absence на реально сериализованном JSON, непустые ожидаемые результаты и сохранность нужных бизнес-полей. Это не пустая проверка отсутствующего договора. Добавлен отдельный обход всех OpenAPI `properties`, включая inline и component schemas: четыре внутренних имени отсутствуют. Существующая документация этих полей уже не объявляла, её schemas не менялись. Generated OpenAPI: 223 paths, 102 schemas, 136 refs, 0 unresolved; SHA-256 `a9ab4b993d1824534d4dee825cd271464a90bf2e9d34504786feea58716f59f4` совпадает с предыдущим gate. Swagger generation работает; browser UI на deployed server в этой локальной проверке не проверялся.

## Полная regression и последовательные runners

Проверки выполнены на одном неизменном source/dist после исправлений. Build во время integration не перезапускался. Команды использовали локальные `node_modules/.bin`; внешние dependencies не обновлялись.

| Проверка | Результат | Evidence |
|---|---|---|
| Nest build | PASS, exit 0 | `/private/tmp/oxus-fixes-final-build.log` |
| `tsc --noEmit` | PASS, exit 0 | `/private/tmp/oxus-fixes-final-tsc.log` |
| ESLint `{src,apps,libs,test}/**/*.ts` | PASS, exit 0 | `/private/tmp/oxus-fixes-final-eslint.log` |
| Jest `--runInBand` | 39 suites / 270 tests PASS | `/private/tmp/oxus-fixes-final-jest.log` |
| Focused Phase1 + OpenAPI до C01 harness fix | 34 + 8 tests PASS, две fresh DB | `/private/tmp/oxus-fixes-focused.log` |
| Focused admin + Phase2 после C01 fix | 12 + 18 tests PASS, две fresh DB | `/private/tmp/oxus-fixes-c01-lifecycle-after.log` |
| Deployment Python unittest | 22 tests PASS | `/private/tmp/oxus-fixes-final-deployment.log` |
| Both Compose `config --quiet` с соответствующим example | PASS | Выполнено отдельно и в rendering regression |
| Shell syntax: deploy/install-ci/ssh-deploy | PASS | `bash -n` |
| Изменённый Python / probe JS syntax | PASS | `py_compile`, `node --check` |
| Git whitespace | PASS | `git diff --check` |

| Серия / run | Exit | Passed / failed / skipped formal | Smoke | Fresh migration + schema-diff DB | Время | Tracing | Evidence |
|---|---:|---|---|---:|---:|---|---|
| До C01 fix, 1 | 0 | 190 / 0 / 0 | 11/11 | 16 | 112.79 s | Да | `/private/tmp/oxus-fixes-integration-1.log` |
| До C01 fix, 2 | 0 | 190 / 0 / 0 | 11/11 | 16 | 112.61 s | Нет | `/private/tmp/oxus-fixes-integration-2.log` |
| До C01 fix, 3 | 1 | 99 / 1 / 0 | не достигнут | 6 | 44.85 s | Нет | `/private/tmp/oxus-fixes-integration-3.log` |
| После C01 fix, 1 | 0 | 191 / 0 / 0 | 11/11 | 16 | 112.8 s | Да | `/private/tmp/oxus-fixes-final-integration-1.log` |
| После C01 fix, 2 | 0 | 191 / 0 / 0 | 11/11 | 16 | 111.09 s | Нет | `/private/tmp/oxus-fixes-final-integration-2.log` |
| После C01 fix, 3 | 0 | 191 / 0 / 0 | 11/11 | 16 | 112.38 s | Нет | `/private/tmp/oxus-fixes-final-integration-3.log` |

До C01 fix run 3: 90 оставшихся formal tests и 11 smoke не достигнуты из-за fail-fast; они не выдаются за skipped или passed. Ожидаемый red-regression отдельно: 11 passed / 1 failed до fix, затем 12/12 admin PASS. Все pre-fix ошибки сохранены в этом отчёте.

В каждом успешном full runner: все Phase 1–4, admin EXPERT profile, OpenAPI, manual/legacy reliability, visibility, real Redis, migrations/backfill, demo seed и smoke suites. На каждую из 16 suites создаётся новая DB, применяются 42 migrations, выполняется `prisma migrate diff --exit-code`, затем запускаются tests и DB удаляется. Всего за три полных runner — **48 fresh migration/schema-diff cycles**. Тесты не запускались против production/staging DB.

Уникальный formal набор после fixes: **483 = 270 Jest + 191 integration + 22 deployment**, отдельно **11 smoke**. Повторные исполнения не увеличивают уникальное число tests. В финальной серии failed/skipped/cancelled/todo permanent tests: **0**. До C01 fix зафиксированы один неожиданный HTTP failure в третьем runner и один ожидаемый red-regression failure. Исторический failed C01 test также не удалён из evidence и не объявлен задним числом успешным.

После последней code change заново выполнен полный build/types/lint/Jest/deployment набор. Три full integration runners — не три самостоятельных повторения всех разделов прежнего Final Candidate Gate.

## Candidate integrity и review

База сравнения: `/private/tmp/oxus-fixes-before.json`, 632 file hashes, включая предыдущий `deployment/final-candidate-gate.md`; исходные 631 hash сначала сверены с предыдущим candidate snapshot. HEAD остаётся `3b593656640f10faad792611b41e45b81dca1662`, branch `test`; index не менялся.

Относительно этой базы изменены ровно 17 существовавших файлов:

| Файл | Причина |
|---|---|
| `compose.yaml` | C02 env interpolation/default |
| `deployment/tests/freedom-mode-probe.cjs` | C02 rendered runtime URL / controller route / posted form |
| `deployment/tests/test_freedom_mode_runtime.py` | C02 default/override/fallback regression |
| `src/modules/contract/domain/contract-emails.ts` | C03 узкий тип входа для safe result, без runtime change |
| `src/modules/contract/domain/manual-contract-confirmation.ts` | C03 reuse общего omit |
| `src/modules/contract/repository/contract.repository.ts` | C03 safe API-facing results + внутренний credential read |
| `src/modules/contract/service/contract.service.ts` | C03 legacy verifier использует внутренний credential read |
| `test/phase1-contract-security.test.ts` | C03 шесть regression tests + C01 listener lifecycle |
| `test/openapi-contract.test.ts` | C03 public property key absence |
| `test/admin-expert-profile.test.ts` | C01 listener lifecycle + permanent regression |
| `test/expert-lead-visibility-http.test.ts` | C01 listener lifecycle |
| `test/manual-contract-http.test.ts` | C01 listener lifecycle |
| `test/phase2-reporting.test.ts` | C01 listener lifecycle |
| `test/phase3-production-blockers.test.ts` | C01 listener lifecycle |
| `test/phase4-reporting.test.ts` | C01 listener lifecycle |
| `test/sales-contract-reliability.test.ts` | C01 listener lifecycle |
| `test/sales-expert-v2-http.test.ts` | C01 listener lifecycle |

Добавлены только `src/modules/contract/domain/contract-read.ts` и этот отчёт. Остальные **615 baseline files идентичны**, удалённых нет. Старый Final Candidate Gate оставлен неизменным. Schema, все 42 SQL migrations, lockfiles, installment/Cambridge logic, permissions и runner идентичны baseline; прежние assertions во всех тестах сохранены.

Финальный accumulated git inventory: **100 paths (51 modified, 49 untracked)**. Это включает изменения Phase 1–4, предыдущий отчёт и текущие fixes; baseline inventory из предыдущего отчёта не следует путать с новым delta из 19 файлов. Все временные диагностические scripts/logs/snapshots находятся в `/private/tmp`, в candidate они не включены.

Secret/artifact scan выполнен для всех candidate paths, включая untracked: private-key headers, AWS/GitHub/Slack token formats, JWT literals; отдельно просмотрены новые credential-like literals. Новые OTP markers/код — явно синтетические test fixtures; значения FreedomPay secret в probe уже синтетические baseline. Реальных secrets и неожиданных log/dump/key/build artifacts среди candidate paths не обнаружено. Локальные `.env` и ignored dependencies/build output не включаются. Это scan данного change set, не обещание отсутствия секретов во всей истории Git.

Diff review: в production delta только исключение четырёх OTP keys, типизация внутреннего email input и выбор внутреннего credential projection; local deployment delta только callback URL. API status/permissions, договорные суммы/транши, даты, conversion и account creation не менялись. Все существовавшие regression assertions сохранены; C01 не маскируется catch/retry.

Финальная машинная сверка: `/private/tmp/oxus-fixes-final-integrity.json`. Два использованных локальных PostgreSQL/Redis test containers возвращены в исходное остановленное состояние после тестов.

## Ответы на release-вопросы

1. **C01: PASS в локальном runner scope.** HTTP-only reproduction, исправление listener lifecycle, red/green regression и три финальных full runs подтверждены. Это не бездоказательная классификация environment-only; точный адрес исторического socket из старого stack восстановить нельзя.
2. **C02: PASS.** Rendered URL local/server соответствует route; default/override/runtime/OpenAPI checks зелёные.
3. **C03: PASS.** Internal keys исключены из публичных Contract результатов; сохранены внутренние OTP data/verification.
4. **3 последовательных полных integration runs прошли после последней code change**, каждый отдельно зафиксирован в таблице; полный build/types/lint/Jest/deployment набор повторён после C01 fix.
5. **В финальной серии failed/skipped permanent tests: 0.** До fix были один неожиданный HTTP failure и ожидаемый failure новой red-regression; они, как и исторический C01, сохранены в evidence.
6. **Повторный Final Candidate Gate запускать можно.** Исправления и evidence готовы к повторной оценке.
7. **Да, candidate можно признать готовым к commit, если повторный Final Candidate Gate зелёный** и проверяет именно этот полный snapshot с C01–C03 fixes и regression coverage. Текущая работа подготовила candidate к этому gate; commit сейчас не выполнялся и не объявляется уже разрешённым deployment.

Commit, push, deployment не выполнялись. Данный отчёт не является staging/production acceptance.
