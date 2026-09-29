# Final Candidate Gate Repeat — 2026-09-29

**CANDIDATE READY TO COMMIT**

Проверен именно текущий accumulated working tree после C01–C03. Обязательный текущий gate зелёный: **483 уникальных formal tests + 11 smoke, 0 failed / 0 skipped**. Новых technical candidate blockers не найдено. **REMOTE CI REQUIRED.** Это готовность repository candidate к commit, а не staging/production acceptance.

Единственное изменение этого gate — данный запрошенный отчёт. Production code, tests, migrations, CI, deployment configuration/scripts, OpenAPI source, прежние docs и fixtures не изменялись. Commit, push и deployment не выполнялись.

## A. Snapshot integrity

| Параметр | Зафиксировано |
|---|---|
| HEAD | `3b593656640f10faad792611b41e45b81dca1662` |
| Branch | `test` |
| До gate | 100 candidate paths: 51 modified, 49 untracked |
| Deleted / renamed | 0 / 0 |
| Staged changes | Нет; index diff пуст |
| Полный tracked/untracked file snapshot | 634 files |
| Candidate SHA-256 fingerprint | `68cf5a3678b1ed78180c5a9556d872f5001f5fa9e561ed1fdb500e9bb07d2d90` |
| Полный file-tree SHA-256 fingerprint | `855a78e5eedb615cfff7d83405732130f35e467fbcda950221dcf0dabc3e996a` |

Fingerprint candidate рассчитан по отсортированным UTF-8 строкам `git-status-code<TAB>path<TAB>SHA256(file-bytes)\n`, включая untracked files. Полный tree fingerprint использует `path<TAB>SHA256(file-bytes)\n` для всех tracked/untracked, без ignored build/dependency/secret files. Evidence: `/private/tmp/oxus-gate-repeat-before.json`, `oxus-gate-repeat-candidate-manifest.tsv`, `oxus-gate-repeat-status-before.txt`.

Сверка с `/private/tmp/oxus-fixes-final-integrity.json`: **все 634 hashes совпадают**, дополнительных/пропавших paths нет. Следовательно, предыдущие три green integration runs относятся к этому же source snapshot. HEAD/branch/index сохранены.

Сверка с предыдущим [Final Candidate Gate](final-candidate-gate.md) и [candidate-gate-fixes.md](candidate-gate-fixes.md): после первого gate изменены только 17 ожидаемых существовавших файлов и добавлены safe projection + fixes report. Это C01 listener lifecycle в девяти HTTP suites, C02 local Compose URL/runtime regression, C03 repository/manual omit/internal verifier и соответствующие tests. Остальные 615 файлов fixes-before snapshot идентичны. Новых изменений после принятого fixes snapshot до начала этого gate — **0**.

Финальная сверка: исходные 634 files неизменны; добавлен только этот отчёт. Итоговый commit inventory — **101 path (51 modified + 50 untracked)**. Fingerprint выше относится к проверенному входному candidate из 100 paths; manifest с новым отчётом и его hash хранится отдельно в `/private/tmp/oxus-gate-repeat-final-integrity.json`, чтобы не создавать self-referential hash отчёта.

## B. Candidate inventory

**Include:** все 101 paths ниже. M — modified относительно HEAD, U — untracked; «U» здесь не означает лишний файл. Необходимо включить связанные новые domain helpers, migrations, tests, OpenAPI и deployment/audit files вместе с tracked changes.

| № | Статус | Include path | Происхождение |
|---|---|---|---|
| 1 | M | `.env.example` | Accepted Phase 1–4 / previous audit baseline |
| 2 | M | `.github/workflows/ci.yml` | Accepted Phase 1–4 / previous audit baseline |
| 3 | M | `README.md` | Accepted Phase 1–4 / previous audit baseline |
| 4 | M | `compose.yaml` | C01–C03 / regression / fixes report |
| 5 | M | `deployment/.env.example` | Accepted Phase 1–4 / previous audit baseline |
| 6 | U | `deployment/audits/final-release-historical.sql` | Accepted Phase 1–4 / previous audit baseline |
| 7 | U | `deployment/audits/phase1-contract-duplicates.sql` | Accepted Phase 1–4 / previous audit baseline |
| 8 | U | `deployment/audits/phase2-currencies.sql` | Accepted Phase 1–4 / previous audit baseline |
| 9 | U | `deployment/audits/phase3-historical-benefits.sql` | Accepted Phase 1–4 / previous audit baseline |
| 10 | U | `deployment/candidate-gate-fixes.md` | C01–C03 / regression / fixes report |
| 11 | M | `deployment/compose.yaml` | Accepted Phase 1–4 / previous audit baseline |
| 12 | M | `deployment/deploy.sh` | Accepted Phase 1–4 / previous audit baseline |
| 13 | U | `deployment/final-candidate-gate.md` | Accepted Phase 1–4 / previous audit baseline |
| 14 | U | `deployment/final-release-readiness.md` | Accepted Phase 1–4 / previous audit baseline |
| 15 | U | `deployment/manual-contracts.md` | Accepted Phase 1–4 / previous audit baseline |
| 16 | U | `deployment/phase1-security-review.md` | Accepted Phase 1–4 / previous audit baseline |
| 17 | U | `deployment/phase2-review.md` | Accepted Phase 1–4 / previous audit baseline |
| 18 | U | `deployment/phase3-production-blockers.md` | Accepted Phase 1–4 / previous audit baseline |
| 19 | U | `deployment/phase4-reporting-api-performance.md` | Accepted Phase 1–4 / previous audit baseline |
| 20 | U | `deployment/tests/freedom-mode-probe.cjs` | C01–C03 / regression / fixes report |
| 21 | M | `deployment/tests/test_deploy.py` | Accepted Phase 1–4 / previous audit baseline |
| 22 | U | `deployment/tests/test_freedom_mode_runtime.py` | C01–C03 / regression / fixes report |
| 23 | M | `package.json` | Accepted Phase 1–4 / previous audit baseline |
| 24 | U | `src/common/dto/page-query.dto.ts` | Accepted Phase 1–4 / previous audit baseline |
| 25 | U | `src/common/openapi/flow-responses.ts` | Accepted Phase 1–4 / previous audit baseline |
| 26 | M | `src/modules/admin/admin.controller.ts` | Accepted Phase 1–4 / previous audit baseline |
| 27 | M | `src/modules/admin/admin.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 28 | M | `src/modules/admin/analytics.controller.ts` | Accepted Phase 1–4 / previous audit baseline |
| 29 | M | `src/modules/admin/analytics.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 30 | M | `src/modules/admin/api/dto/analytics-query.dto.ts` | Accepted Phase 1–4 / previous audit baseline |
| 31 | U | `src/modules/admin/finance-earnings.query.ts` | Accepted Phase 1–4 / previous audit baseline |
| 32 | M | `src/modules/admin/finance.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 33 | M | `src/modules/admin/users/repository/users.repository.ts` | Accepted Phase 1–4 / previous audit baseline |
| 34 | M | `src/modules/billing/api/payment.controller.ts` | Accepted Phase 1–4 / previous audit baseline |
| 35 | U | `src/modules/billing/domain/freedom-signature.ts` | Accepted Phase 1–4 / previous audit baseline |
| 36 | M | `src/modules/billing/repository/payment.repository.ts` | Accepted Phase 1–4 / previous audit baseline |
| 37 | U | `src/modules/billing/service/freedompay.service.spec.ts` | Accepted Phase 1–4 / previous audit baseline |
| 38 | M | `src/modules/billing/service/freedompay.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 39 | M | `src/modules/billing/service/payment.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 40 | U | `src/modules/contract/api/contract-scan.controller.ts` | Accepted Phase 1–4 / previous audit baseline |
| 41 | M | `src/modules/contract/api/contract.controller.ts` | Accepted Phase 1–4 / previous audit baseline |
| 42 | U | `src/modules/contract/api/dto/contract-schedule-preview.dto.ts` | Accepted Phase 1–4 / previous audit baseline |
| 43 | U | `src/modules/contract/api/dto/contracts-query.dto.ts` | Accepted Phase 1–4 / previous audit baseline |
| 44 | M | `src/modules/contract/api/dto/create-contract-for-student.dto.ts` | Accepted Phase 1–4 / previous audit baseline |
| 45 | U | `src/modules/contract/api/dto/manual-contract.dto.ts` | Accepted Phase 1–4 / previous audit baseline |
| 46 | M | `src/modules/contract/api/dto/update-contract-meta.dto.ts` | Accepted Phase 1–4 / previous audit baseline |
| 47 | M | `src/modules/contract/api/expert-contract.controller.ts` | Accepted Phase 1–4 / previous audit baseline |
| 48 | U | `src/modules/contract/api/manual-contract.controller.ts` | Accepted Phase 1–4 / previous audit baseline |
| 49 | U | `src/modules/contract/api/online-signing-disabled.guard.ts` | Accepted Phase 1–4 / previous audit baseline |
| 50 | M | `src/modules/contract/contract.module.ts` | Accepted Phase 1–4 / previous audit baseline |
| 51 | U | `src/modules/contract/domain/contract-access.ts` | Accepted Phase 1–4 / previous audit baseline |
| 52 | U | `src/modules/contract/domain/contract-creation.ts` | Accepted Phase 1–4 / previous audit baseline |
| 53 | M | `src/modules/contract/domain/contract-emails.ts` | C01–C03 / regression / fixes report |
| 54 | U | `src/modules/contract/domain/contract-journey.ts` | Accepted Phase 1–4 / previous audit baseline |
| 55 | U | `src/modules/contract/domain/contract-read.ts` | C01–C03 / regression / fixes report |
| 56 | U | `src/modules/contract/domain/historical-contract-benefits.ts` | Accepted Phase 1–4 / previous audit baseline |
| 57 | U | `src/modules/contract/domain/manual-contract-confirmation.ts` | C01–C03 / regression / fixes report |
| 58 | U | `src/modules/contract/domain/manual-contract.spec.ts` | Accepted Phase 1–4 / previous audit baseline |
| 59 | U | `src/modules/contract/domain/manual-contract.ts` | Accepted Phase 1–4 / previous audit baseline |
| 60 | M | `src/modules/contract/repository/contract.repository.ts` | C01–C03 / regression / fixes report |
| 61 | M | `src/modules/contract/service/contract-notification.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 62 | U | `src/modules/contract/service/contract-scan.service.spec.ts` | Accepted Phase 1–4 / previous audit baseline |
| 63 | U | `src/modules/contract/service/contract-scan.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 64 | M | `src/modules/contract/service/contract.service.ts` | C01–C03 / regression / fixes report |
| 65 | U | `src/modules/contract/service/manual-contract.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 66 | M | `src/modules/lead/api/dto/sales/expert-lead-query.dto.ts` | Accepted Phase 1–4 / previous audit baseline |
| 67 | M | `src/modules/lead/api/dto/sales/prepare-lead-contract.dto.ts` | Accepted Phase 1–4 / previous audit baseline |
| 68 | M | `src/modules/lead/api/expert-lead.controller.ts` | Accepted Phase 1–4 / previous audit baseline |
| 69 | M | `src/modules/lead/domain/lead-transaction.spec.ts` | Accepted Phase 1–4 / previous audit baseline |
| 70 | M | `src/modules/lead/domain/lead-transaction.ts` | Accepted Phase 1–4 / previous audit baseline |
| 71 | M | `src/modules/lead/repository/sales-lead.repository.ts` | Accepted Phase 1–4 / previous audit baseline |
| 72 | M | `src/modules/lead/service/expert-lead.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 73 | M | `src/modules/lead/service/lead-contract.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 74 | M | `src/modules/lead/service/lead-expert-call.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 75 | M | `src/modules/lead/service/lead-notification.service.spec.ts` | Accepted Phase 1–4 / previous audit baseline |
| 76 | M | `src/modules/lead/service/lead-student-invitation.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 77 | M | `src/modules/lead/service/manual-lead-v2.service.ts` | Accepted Phase 1–4 / previous audit baseline |
| 78 | M | `src/modules/user-journey/user-journey.constants.ts` | Accepted Phase 1–4 / previous audit baseline |
| 79 | U | `src/prisma/migrations/20260928130000_manual_contracts/migration.sql` | Accepted Phase 1–4 / previous audit baseline |
| 80 | U | `src/prisma/migrations/20260928150000_journey_occurred_at/migration.sql` | Accepted Phase 1–4 / previous audit baseline |
| 81 | U | `src/prisma/migrations/20260928151000_backfill_manual_journey/migration.sql` | Accepted Phase 1–4 / previous audit baseline |
| 82 | M | `src/prisma/schema.prisma` | Accepted Phase 1–4 / previous audit baseline |
| 83 | M | `src/prisma/seed/sales-expert-demo.plan.ts` | Accepted Phase 1–4 / previous audit baseline |
| 84 | M | `src/prisma/seed/sales-expert-demo.seed.ts` | Accepted Phase 1–4 / previous audit baseline |
| 85 | U | `test/admin-expert-profile.test.ts` | C01–C03 / regression / fixes report |
| 86 | M | `test/expert-lead-visibility-http.test.ts` | C01–C03 / regression / fixes report |
| 87 | U | `test/manual-contract-http.test.ts` | C01–C03 / regression / fixes report |
| 88 | U | `test/openapi-contract.test.ts` | C01–C03 / regression / fixes report |
| 89 | U | `test/performance/phase4-performance.cjs` | Accepted Phase 1–4 / previous audit baseline |
| 90 | U | `test/phase1-contract-security.test.ts` | C01–C03 / regression / fixes report |
| 91 | U | `test/phase2-journey-migration.test.ts` | Accepted Phase 1–4 / previous audit baseline |
| 92 | U | `test/phase2-reporting.test.ts` | C01–C03 / regression / fixes report |
| 93 | U | `test/phase3-production-blockers.test.ts` | C01–C03 / regression / fixes report |
| 94 | U | `test/phase4-reporting.test.ts` | C01–C03 / regression / fixes report |
| 95 | U | `test/run-integration.mjs` | Accepted Phase 1–4 / previous audit baseline |
| 96 | M | `test/sales-contract-reliability.test.ts` | C01–C03 / regression / fixes report |
| 97 | M | `test/sales-expert-demo.test.ts` | Accepted Phase 1–4 / previous audit baseline |
| 98 | M | `test/sales-expert-v2-http.test.ts` | C01–C03 / regression / fixes report |
| 99 | M | `test/sales-expert-v2-regression.test.ts` | Accepted Phase 1–4 / previous audit baseline |
| 100 | M | `test/sales-expert-v2-smoke.ts` | Accepted Phase 1–4 / previous audit baseline |
| 101 | U | `deployment/final-candidate-gate-repeat.md` | Единственный новый файл этого gate |

**Exclude:** реальные `.env`/environment overrides, private/SSH keys, credentials, `dist`, `node_modules`, generated Prisma client, coverage/caches/`__pycache__`, logs, DB dumps/backups, local data exports, `/private/tmp` diagnostics и generated OpenAPI JSON. `.env.example` и `deployment/.env.example` из Include — безопасные шаблоны, их исключать не нужно. Ничего из Exclude не обнаружено среди candidate paths.

## C. Secret/artifact scan

**PASS.** Заново проверены содержимое всех 100 входных candidate files, включая untracked, полный tracked diff относительно HEAD, template environment assignments и новый отчёт. Проверялись private-key headers, AWS/GitHub/Slack token formats, JWT literals, password/secret/token assignments, DB/SMTP/FreedomPay/AWS/MinIO настройки и подозрительные artifact paths/extensions. Реальные значения секретов не выводились.

| Категория | Результат |
|---|---|
| Real `.env`, private keys, dumps, logs, build output, caches, exports в candidate | Не обнаружены |
| Private-key / access-token / JWT / AWS key signatures | 0 hits |
| Credential-like quoted assignments | 37 reviewed: synthetic test fixtures, env references и placeholders; unresolved — 0 |
| DB/JWT/FreedomPay/SMTP/AWS/MinIO env templates | Empty/placeholders/reference values; SMTP port/secure — обычные numeric/boolean settings |
| Runtime C03 data leakage | Отдельно проверено runtime JSON в F; public OTP keys отсутствуют |
| Ignored local `.env`, `dist`, `node_modules` | Ignore rules подтверждены; в commit inventory не входят |
| `/private/tmp` и generated OpenAPI artifact | Только внешнее локальное evidence, не repository artifacts |

Исходные credentials вне candidate не читались/не публиковались для отчёта. Scope scan — текущий change set; вся Git history и реальные server env не аудировались. Evidence: `/private/tmp/oxus-gate-repeat-scan.json`, `oxus-gate-repeat-ignored.txt`, `oxus-gate-repeat-full-diff.patch`.

## D. C01 verification

**PASS.** Текущий harness проверен по source и execution:

- Девять HTTP suites делают `await app.listen(0, "127.0.0.1")` один раз в suite setup, передают уже слушающий server в Supertest; `await app?.close()` остаётся в teardown.
- Permanent regression проверяет открытый listener, реальные последовательные и параллельные requests, неизменный address и отсутствие `close` между requests.
- Отдельный свежий запуск этой regression: **1/1 PASS**, затем она повторно прошла внутри полного admin suite **12/12 PASS**. Диагностический `--test-name-pattern` не заменяет полный запуск suite в обязательном runner.
- В runner/проверяемых HTTP tests нет retry/catch для `ECONNRESET`, нового timeout увеличения или ослабления assertions. Изменения listener и добавленные regressions обратимо исключены в памяти при hash-сверке: оставшийся source всех девяти HTTP suites **побайтно совпадает** с pre-fixes baseline. Файлы при этой проверке не редактировались.
- Текущий обязательный full runner завершился exit 0; `ECONNRESET`/`socket hang up` не возникли. Повторов до зелёного результата в этом gate не было.

| Evidence run | Formal passed / failed / skipped | Smoke | Source snapshot |
|---|---|---|---|
| Предыдущий final run 1 | 191 / 0 / 0 | 11/11 | Тот же source; tracing включён |
| Предыдущий final run 2 | 191 / 0 / 0 | 11/11 | Тот же source; без tracing |
| Предыдущий final run 3 | 191 / 0 / 0 | 11/11 | Тот же source; без tracing |
| Текущий обязательный run | 191 / 0 / 0 | 11/11 | Hash-verified current snapshot; без tracing |

Предыдущие логи: `/private/tmp/oxus-fixes-final-integration-{1,2,3}.log`; текущие: `/private/tmp/oxus-gate-repeat-lifecycle.log`, `oxus-gate-repeat-integration.log`. Hash review: `oxus-gate-repeat-harness-review.json`. Исторические pre-fix failures остаются в fixes report; этот gate не пересчитывает их задним числом в PASS. Граница старого расследования сохранена: exact address исторического socket не записан, но HTTP-only reproduction и исправленный listener lifecycle подтверждены ранее; текущая повторная regression зелёная.

## E. C02 verification

**PASS.** Rendered configuration заново проверена:

| Stack / case | Rendered `FREEDOM_RESULT_URL` |
|---|---|
| Local example | `http://localhost:4000/api/v1/payment/freedompay-webhook` |
| Local default без env value | `http://localhost:4000/api/v1/payment/freedompay-webhook` |
| Local override | `https://example.test/api/v1/payment/freedompay-webhook` |
| Server example | `https://test.oxusedu.com/api/v1/payment/freedompay-webhook` |
| Server override | `https://example.test/api/v1/payment/freedompay-webhook` |

Цепочка согласована: `main.ts` global prefix `api/v1` → `PaymentController("payment")` → POST `freedompay-webhook` → generated OpenAPI → FreedomPay `pg_result_url` из effective environment и `pg_request_method=POST`. Runtime probe использует metadata настоящего compiled controller и проверяет фактически сформированную init form. 10 mode cases (local/server × 1, 0, invalid, empty, unset) и 5 rendered URL cases прошли внутри deployment tests. HTTP axios замокан, **реального merchant call не было**. Evidence: `/private/tmp/oxus-gate-repeat-deployment.log`.

## F. C03 verification

**PASS.** В текущем полном runner прошли все шесть C03 runtime tests и отдельная OpenAPI regression. Assertions проверяют recursive `Object.hasOwn` после `JSON.stringify/parse`, а не только TypeScript type. Fixtures содержат ненулевые hash/expiry; create также проверяет отсутствие ключей при исходном null.

| Public path / consumer | Runtime evidence и результат |
|---|---|
| `GET /contracts/my` | Student HTTP JSON, id/price присутствуют, 4 internal keys отсутствуют; DB markers не удалены — PASS |
| `GET /contracts`, EXPERT / ADMIN | Paginated HTTP lists, найден ожидаемый договор, internal keys отсутствуют — PASS |
| `GET /contracts/student/:studentId`, EXPERT / ADMIN | Оба role-specific HTTP reads — PASS |
| Generic create / metadata update | `POST /contracts`, `PATCH /contracts/:id/meta`, null и populated OTP — PASS |
| Manual signature | Первый `POST /contracts/:id/manual-signature` и repeat — PASS |
| Manual confirmation | Lead initial/repeated confirmation, ADMIN `confirm-manual`, direct manual service — PASS |
| Installment confirmation | Следующий receipt и idempotent repeat, paid installment count проверен — PASS |
| Expert lead nested contract | Detail и prepare-existing responses с populated OTP в DB — PASS |
| Admin CRM / finance / expert earnings | Direct real service serialization через существующие allowlist mappers — PASS; это service JSON проверки, а не дополнительный browser E2E |
| Public repository/service usage | `findById`, `findByStudentId`, `findPendingStudent`, list и ContractService reads — PASS |
| Internal legacy verifier | Узкая projection сохраняет student hash/expiry; real verification path получает hash и подписывает synthetic contract — PASS |
| OpenAPI | 4 internal поля не объявлены в public properties — PASS |

Проверены `contractInternalOmit`, его применение в generic repository и `manualContractRead`, отдельный `findStudentSigningCredentials` с `id/studentId/status/studentOtpHash/studentOtpExpiry`. Legacy storage не удалён; online OTP HTTP routes по-прежнему отключены. Остальные read paths из fixes report сверены по неизменным hashes: lead detail explicit select, admin/finance allowlists, nested student/event status-only projections, scan metadata/binary и внутренний PDF/notification flow. Нового необработанного public Contract serializer не обнаружено.

## G. Full test gate

На текущем snapshot заново выполнены `nest build`, `tsc --noEmit`, ESLint **без --fix**, Jest, один full integration runner, deployment Python tests, обе Compose validations, shell syntax и `git diff --check`. Build завершён до integration; во время runner dist не пересобирался. Installed dependencies не обновлялись.

**Уникальные permanent tests:**

| Gate | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Jest, 39 suites | 270 | 0 | 0 |
| Full integration, 15 formal suites (включая OpenAPI) | 191 | 0 | 0 |
| Deployment Python unittest | 22 | 0 | 0 |
| **Всего уникальных formal tests** | **483** | **0** | **0** |

**Разбивка integration, уже включённая в 191:**

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `phase4-reporting.test.ts` | 12 | 0 | 0 |
| `openapi-contract.test.ts` | 8 | 0 | 0 |
| `phase3-production-blockers.test.ts` | 17 | 0 | 0 |
| `admin-expert-profile.test.ts` | 12 | 0 | 0 |
| `phase1-contract-security.test.ts` | 34 | 0 | 0 |
| `phase2-reporting.test.ts` | 18 | 0 | 0 |
| `phase2-journey-migration.test.ts` | 1 | 0 | 0 |
| `manual-contract-http.test.ts` | 11 | 0 | 0 |
| `sales-contract-reliability.test.ts` | 12 | 0 | 0 |
| `sales-expert-v2-http.test.ts` | 9 | 0 | 0 |
| `expert-lead-visibility-http.test.ts` | 6 | 0 | 0 |
| `sales-expert-v2-regression.test.ts` | 40 | 0 | 0 |
| `lead-call-notifications.test.ts` | 9 | 0 | 0 |
| `lead-status-migration.test.ts` | 1 | 0 | 0 |
| `sales-expert-demo.test.ts` | 1 | 0 | 0 |

**Smoke, migration cycles и остальные checks считаются отдельно:**

| Gate / единица учёта | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Smoke scenarios | 11 | 0 | 0 |
| Дополнительное исполнение permanent C01 test; уже включён в unique 191 | 1 | 0 | 0 |
| Nest build, command | 1 | 0 | 0 |
| TypeScript, command | 1 | 0 | 0 |
| ESLint, command | 1 | 0 | 0 |
| Clean migration deploy cycles: 16 full runner + 1 isolated lifecycle | 17 | 0 | 0 |
| Schema diff cycles, exit 0 / no difference | 17 | 0 | 0 |
| Applied migration checksum comparisons в независимой fresh DB | 42 | 0 | 0 |
| Compose configurations | 2 | 0 | 0 |
| Deployment shell scripts, `bash -n` | 3 | 0 | 0 |
| `git diff --check`, command | 1 | 0 | 0 |

Текущие cancelled/todo formal tests — 0; неожиданно не достигнутых suites нет. Negative-case logs/ожидаемые ошибки failure injection не являются failed tests. Существующий pg deprecation warning не новый finding: он присутствовал в baseline, версии dependencies не изменены.

Evidence вне repo: `/private/tmp/oxus-gate-repeat-{build,tsc,eslint,jest,integration,deployment,lifecycle}.log`; parsed totals — `oxus-gate-repeat-tests.json`. OpenAPI 8 tests входят в full runner и не прибавляются повторно к formal total. Три предыдущих runner используются как дополнительное evidence устойчивости, а не как замена обязательного текущего run.

## H. Regression matrix

| Invariant | Статус | Текущий evidence |
|---|---|---|
| Draft-first, no account before first receipt, signature alone не закрывает lead | PASS | `manual-contract-http`: draft/signature leave no account/contract/invitation/payment; invalid receipt/signature negative cases |
| FULL/INSTALLMENT statuses, receipts и финальный PAID | PASS | manual suite: actual receipts / last tranche; Phase2 FULL/INSTALLMENT confirmations |
| Idempotency, concurrent account/contract creation | PASS | manual concurrent confirmation; Phase1 F04 generic/CRM shared student invariant |
| Transaction rollback, включая поздние side effects | PASS | Phase1 late failure rolls back User/contract/schedule/benefits/invitation; Phase2 F08 event insertion rollback |
| FreedomPay signature/raw fields/context | PASS | Phase1 F01 callback matrix; FreedomPay unit tests; mode/runtime probes |
| Exactly-once payment/benefits, duplicate provider reference | PASS | Phase1 F02 duplicate/concurrent callbacks, reference uniqueness, rollback/retry |
| Ownership, transfer, historical attribution | PASS | Phase1 F03/F05; Phase2 F10 owner/foreign/ADMIN matrix |
| Permission checks, disabled/spoofed actor | PASS | Phase1 F06 both HTTP paths + direct domain boundary; visibility/reliability suites |
| FREE rejected | PASS | Phase3 R08 at both prices, expert/ADMIN/direct/concurrent cases |
| Historical SIGNED fail-closed, no regrant | PASS | Phase3 R02 missing/ambiguous benefits; existing fully consumed benefits; read-only audit fixtures |
| Public OTP redaction, internal verifier intact | PASS | C03 runtime/OpenAPI tests, раздел F |
| Currency-aware reporting | PASS | Phase2 F07 mixed/single currencies; Phase4 earnings pagination totals |
| occurredAt / storage time / historical chronology | PASS | Phase2 F08 milestones/rollback; journey migration replay test |
| Summary/list filters | PASS | Phase2 F09 every tab + source/search/owner/deleted filters |
| SCHOOLBOY | PASS | Phase4 R04 reuse/manual/gateway analytics; unsupported/deleted exclusions |
| lostLeads | PASS | Phase4 R03 cohorts, backdated receipts, boundary, concurrent payment |
| Pagination и bounded DB reporting | PASS | Phase4 R07 validated deterministic pages, totals across pages; 40k contracts / 60k installments fixture |
| OpenAPI API contract | PASS | 8 generated-document tests, раздел J |
| Durable delivery / Redis / multi-instance local harness | PASS в локальном scope | Reliability + regression suites, real Redis outage/recovery, two-server socket revocation |
| Deployment/release identity safety | PASS в локальном scope | 22 deployment tests, immutable digest/receipt and release matching checks; workflow static review |

Business semantic changes в этом gate отсутствуют. Live SMTP/storage/merchant/production topology остаются внешними acceptance conditions, а не неподтверждёнными утверждениями этого matrix.

## I. Migration state

**PASS.** `src/prisma/schema.prisma` и все **42 SQL migrations** побайтно совпадают с original post-Phase4 candidate snapshot и snapshot после C01–C03. Исторические 39 SQL migrations + `migration_lock.toml` совпадают с HEAD; новых candidate migrations по-прежнему только три из inventory B. Existing SQL не редактировались.

В независимой свежей DB для lifecycle gate выполнены clean deploy, schema diff и чтение `_prisma_migrations`: ровно 42 migration names, каждый finished, rolled_back отсутствует, каждый stored checksum равен SHA-256 соответствующего SQL. Эти 42 checksum также совпадают с прежним accepted snapshot. Дополнительно все 16 full-runner DB прошли clean deploy/schema diff.

Checksum manifest SHA-256 (`migration_name<TAB>checksum\n`, ordered): `e554f640dda8209deb784e341f95d3b16ca1331f009820551702f14e62407a6f`. Evidence: `/private/tmp/oxus-gate-repeat-migrations.json`, `oxus-gate-repeat-lifecycle.log`, `oxus-gate-repeat-integration.log`. Drift/migration history discrepancy в проверенных fresh DB не найден. Реальная production migration history здесь не читалась; её сверка относится к production rollout conditions.

## J. OpenAPI

**PASS.** Документ заново собран из current built production controllers, 8 contract tests прошли. **223 paths, 102 schemas, 136 refs, 0 unresolved refs**; 417830 bytes. Public properties `studentOtpHash/studentOtpExpiry/expertOtpHash/expertOtpExpiry` отсутствуют.

SHA-256 generated document: `a9ab4b993d1824534d4dee825cd271464a90bf2e9d34504786feea58716f59f4` — совпадает с предыдущим gate/fixes evidence. Callback POST, XML response, manual/finance/analytics schemas, disabled OTP routes, bearer declarations, pagination и scan upload/download contract проверены. Generated JSON находится в system temp (`oxus-phase4-openapi.json`), не в candidate; summary — `/private/tmp/oxus-gate-repeat-openapi.json`. Это подтверждает Swagger generation/contract, но не является browser check deployed Swagger UI.

## K. Remote CI note

**REMOTE CI REQUIRED.** `.github/workflows/ci.yml` перечитан без изменений:

- PR в `test` запускает quality и Docker build; `push` image выключен для `pull_request`, `deploy-test` не проходит условие `event_name != pull_request`. Следовательно, отдельная candidate branch → PR в `test` позволяет получить remote quality/build без test deployment.
- Прямой push в `test` запускает quality → Docker publish → deploy-test → public health → tested-release artifact. Это deployment chain, не quality-only проверка.
- PR в `main` имеет отдельное ограничение source `test`; production promotion привязан к push `main` и matching tested artifact. Current gate не меняет этих правил.

В этом gate не выполнялись remote CI, push, workflow_dispatch, merge или deploy. Локальное совпадение hashes не подменяет remote Node/Linux/PostgreSQL/image build checks.

## L. External release conditions

Они **не понижают readiness repository candidate**, поскольку не являются новыми technical blockers snapshot.

**До staging acceptance:** совместимый frontend manual-flow/API; remote CI quality и image build; immutable image digest; актуальный deployment bundle; изолированные DB/Redis/storage и корректный environment; FreedomPay test mode и реальные test merchant credentials/callback; SMTP/activation и object storage configuration. Затем обязательны реальные frontend/manual/merchant E2E, SMTP delivery, scan upload/download и Redis/multi-instance проверки в целевой topology.

**До production:** зелёная staging acceptance; production-copy historical audits и явные R02 manual dispositions; сверка production migration history/checksums; restore rehearsal и backup; exact tested immutable image + совместимый frontend; live FreedomPay/SMTP/storage/environment settings; бизнес/технический sign-off, согласованные rollout/rollback, smoke/reconciliation/monitoring. Локальные synthetic tests не заменяют эти процедуры.

## M. New findings

**Новых findings G01/G02/... не обнаружено.** Snapshot integrity, secrets/artifacts, C01–C03, обязательные tests и migrations/checksums прошли. Никаких исправлений или скрытых test retries во время этого gate не выполнялось.

## N. Final verdict

**CANDIDATE READY TO COMMIT**

1. **Можно ли сейчас commit? Да**, текущий проверенный candidate готов. Команда commit не выполнялась.
2. **Сколько файлов включить? 101 path:** 100 входных candidate paths + этот отчёт; полный список в B.
3. **Есть ли что нельзя добавлять? Да:** реальные env/keys/credentials, dist/dependencies/caches, logs, tmp/OpenAPI artifacts, dumps/exports. Среди Include их нет.
4. **Новые technical blockers? Нет** в проверенном repository/local gate scope.
5. **После commit можно отдельную candidate branch / PR в test для remote CI? Да.** Это корректный следующий путь для quality/build без test deployment. **REMOTE CI REQUIRED.**
6. **Можно прямой push в test? Не как шаг только для CI:** он запускает deployment chain. Для текущего намерения использовать отдельную ветку/PR; прямой push не выполнялся и этим gate не разрешён как deployment.
7. **До staging:** совместимый frontend, remote CI, immutable digest, deployment/env prerequisites, test merchant/SMTP/storage/Redis configuration; затем реальные staging E2E/acceptance из L.
8. **До production:** staging acceptance, production-copy historical/R02 audit dispositions, migration/checksum/restore rehearsal/backup, exact tested release, production integrations и business/technical sign-off из L.

После проверок временные gate DB удалены, использованные PostgreSQL/Redis test containers возвращены в исходное остановленное состояние. Финальная сверка неизменности 634 входных files, HEAD/index и manifest: `/private/tmp/oxus-gate-repeat-final-integrity.json`. Commit, push, remote CI и deployment не выполнялись.
