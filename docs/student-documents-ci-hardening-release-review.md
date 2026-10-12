# Student Documents CI Hardening — Independent Release Review

Дата: 2026-10-09. Baseline: `0e676bb770df52c345d65858e3c5f7f6fcc6d354`.
Final Release Gate: **PASS WITH NOTES**.

## 1. Executive Summary

F-CI-01 закрыт для main integration runner, standalone Document runner и прямого migration entrypoint. После настоящей загрузки неизменённого `prisma.config.ts` datasource совпадает с разрешённым disposable URL. Это подтверждено повторными тестами patch и отдельным независимым probe через установленный Prisma config loader, без подключения к синтетическому remote host.

Новых P0/P1 нет. Пройдено **760 уникальных тестов: 412 Jest + 348 node:test**. Document HTTP, Document migration и все 47 runner/security checks обязательны в штатном CI. Отдельный CI Hardening commit можно создавать; этот аудит commit не создаёт. Неблокирующее замечание: штатный lint не охватывает MJS, хотя отдельная локальная проверка этих файлов прошла.

Предыдущий final review со статусом NOT READY и remediation report изучены как исторические доказательства. Они не редактировались; решение о закрытии P1 основано на текущем исходном коде и независимых проверках.

## 2. Git Diff Inventory

Branch: `release/manual-contract-candidate`. HEAD точно соответствует baseline. Проверены accumulated tracked diff, staged/unstaged состояние, все untracked файлы и относящиеся к CI Hardening ignored reports. Index пуст.

| Файл | Состояние относительно baseline / содержание |
| --- | --- |
| `.github/workflows/ci.yml` | Modified; только название существующего integration step. |
| `test/run-integration.mjs` | Modified; обязательные suites, validation, prepared environment и lifecycle. |
| `test/run-document-security.mjs` | Modified; shared helper, prepared environment, own disposable DB. |
| `test/document-schema-migration.test.ts` | Modified; prepared environment, CREATE ownership, spawn/signal errors и cleanup. |
| `test/runner-utils.mjs` | Untracked; новый общий helper, прочитан полностью. |
| `test/test-runner.test.mjs` | Untracked; 47 checks, прочитаны полностью. |
| `docs/student-documents-ci-hardening-report.md` | Ignored; implementation report, без изменений аудитом. |
| `docs/student-documents-ci-hardening-final-review.md` | Ignored; предыдущий независимый review, без изменений аудитом. |
| `docs/student-documents-ci-hardening-remediation-report.md` | Ignored; remediation report, без изменений аудитом. |
| `docs/student-documents-ci-hardening-release-review.md` | Ignored; единственный новый файл этого аудита в репозитории. |

Согласованный source scope — ровно 6 файлов: 4 modified tracked и 2 новых untracked. С четырьмя относящимися к задаче отчётами inventory составляет 10 файлов; выбор отчётов для будущего commit требует явного staging, который здесь не выполнялся. Другие исторические ignored reports в scope не включены.

Нет изменений application code, Prisma schema, SQL migrations (включая исторические), application `prisma.config.ts`, package.json/lockfile, MinIO/storage, contracts/payments/Lead application code или deployment. Полный tracked diff проверен, новые файлы проверены отдельно. Проверка SHA-256 всех 657 существующих tracked/scope файлов подтверждает, что аудит их не изменил. Credentials и персональные данные в patch/report не обнаружены; фикстуры синтетические, credentials штатных локальных CI services не являются credentials Production/Test.

## 3. F-CI-01 Security Verification

### Validation и фактическое подключение

`test/runner-utils.mjs:6–24` разбирает URL через WHATWG URL и разрешает только PostgreSQL protocol, literal `localhost`/`127.0.0.1`, ASCII database path с `_test`. Непустые query/fragment отвергаются: установленный pg действительно допускает override host/port через query. Remote hostname, IPv6/mapped IPv6, альтернативные IPv4/hostname формы, encoded path и SQL punctuation не проходят guard. IPv6 здесь намеренно не поддерживается.

Если URL не содержит порт, helper добавляет **5432** (`:23`), поэтому унаследованный PGPORT не выбирает иной endpoint. Проверка выполняется до создания pg clients: main `test/run-integration.mjs:5–7,31`, standalone `test/run-document-security.mjs:5–7`, direct migration `test/document-schema-migration.test.ts:14–20`. Missing DATABASE_URL заканчивается guard error до connections/commands во всех трёх entrypoint.

Изучены реальные установленные реализации pg/pg-connection-string, dotenv и Prisma config loader. Фактические pg host/port/database при явных параметрах URL совпадают с approved URL. Parent admin/client создаются с проверенным connectionString; child environment очищен от всех PG-prefixed keys. Parent credentials/TLS/startup settings могут зависеть от внешнего окружения при отсутствии соответствующих явных параметров; это ограничение среды, не возврат datasource override.

### Child environment и настоящий config loader

`test/runner-utils.mjs:27–38` клонирует окружение, удаляет все `DOTENV_CONFIG_*`, `PG*`, `DOTENV_KEY`, `NODE_OPTIONS`, затем устанавливает проверенный DATABASE_URL, DOTENV_CONFIG_PATH на `devNull`, DOTENV_CONFIG_OVERRIDE в **пустую строку**, QUIET=true. Parent environment не мутируется. Это принципиально: установленный dotenv 17.4.2 преобразует override через Boolean, поэтому непустые строки `false` и `0` включают override.

Неизменённый `prisma.config.ts:1,11` импортирует `dotenv/config` и затем читает DATABASE_URL. Проверялся реальный `@prisma/config.loadConfigFromFile`, а не только helper или mock config: результат загрузки содержит тот же canonical disposable URL. Vault key и пользовательский dotenv path не передаются; synthetic NODE_OPTIONS preload не исполняется.

Подготовленное окружение реально передаётся в main migrate deploy и migrate diff (`test/run-integration.mjs:38–42`), standalone migrate deploy (`test/run-document-security.mjs:11–16`), все Prisma commands direct migration (`test/document-schema-migration.test.ts:21,28–31`). Временный baseline config direct suite также содержит собственный UUID URL явно (`:59–65`); последующие deploy/diff используют обычный application config с защищённым environment.

### Независимая матрица

- Повторены 47 runner tests, включая реальный Prisma loader и true/false для всех трёх entrypoint; direct/main/standalone fault probes используют mock pg lifecycle, не внешнюю БД.
- Отдельный временный probe этого аудита выполнил **16 actual-loader cases**: восемь значений override (unset, empty, true, false, 0, unexpected, FALSE, yes), каждое с явным и отсутствующим портом.
- Во всех 16 случаях унаследованы DOTENV_CONFIG_PATH с существующим synthetic remote dotenv file, DOTENV_KEY/config vault key, дополнительные dotenv options, PGHOST/PGPORT/PGDATABASE и другие PG settings, NODE_OPTIONS с canary preload.
- Проверены точное равенство loaded datasource approved URL и фактические pg connection parameters без `connect()`. Сетевые функции probe инструментированы на отказ при попытке соединения: **0 connections**, canary не создан.
- Полный real-DB main run выполнен с inherited override=false, synthetic path/key/PG defaults; standalone — true; direct migration — unexpected. Защиту выполнял сам entrypoint, а не предварительная ручная очистка окружения.

F-CI-01 считается закрытым в проверенном scope. Отдельные 16 probes не добавляются к числу уникальных framework tests.

## 4. PostgreSQL/Migration Harness

`test/runner-utils.mjs:73–80` создаёт UUID database только с фиксированным проверенным prefix; action/DROP начинаются после успешного CREATE. Нет DROP caller-supplied database или массового удаления по prefix. Имена текущих трёх entrypoint укладываются в PostgreSQL limit 63 bytes. UUID изолирует параллельные invocations; cleanup владеет только созданной этим запуском БД.

Direct migration выставляет `created=true` только после успешного CREATE (`test/document-schema-migration.test.ts:52–53`), и DROP разрешён только при этом флаге (`:110`). Неуспешный CREATE не удаляет существующую БД. Вложенный cleanup (`:104–121`) пытается закрыть client, удалить own DB, закрыть admin и удалить own temporary directory, сохраняя ошибки каждого уровня. У установленного pg `end()` для никогда не подключённого клиента — безопасный no-op.

`runCommand` сохраняет original spawn error и отвергает non-zero status/signal (`test/runner-utils.mjs:47–50`). `withCleanup` возвращает исходную ошибку или AggregateError с primary/cleanup errors и primary cause (`:53–70`). Direct Prisma wrapper явно проверяет spawn error и сигнал (`test/document-schema-migration.test.ts:28–31`). Top-level runner errors дают non-zero exit. Node test runner сохраняет before/hook и cleanup failures; TAP может сокращать nested diagnostics, поэтому fault probes проверяют их через spec reporter.

Повторены 14 entrypoint failure scenarios: main deploy/drift/HTTP/migration/spawn/signal/cleanup-only/two-errors/three-errors; standalone HTTP; direct CREATE failure без DROP, spawn, signal, одновременные child/DROP/admin-close failures. Все ожидаемые причины и ownership проверены; произвольный non-zero не считается достаточным доказательством. Отказы при migration не превращаются в успешный gate, cleanup errors не скрывают primary failure.

**Четыре существующих SQL/data test bodies начиная с `test/document-schema-migration.test.ts:123` совпадают с baseline побайтно; `assertPreserved` также не ослаблен.** Проверки additive SQL, nullable NULL fields, исторических значений/дат/связей, PK/FK/index, повторного deploy и migration history/schema drift сохранены.

После real runs SQL подтвердил 0 оставшихся suite DB и 0 public tables в bootstrap DB. PostgreSQL/Redis containers этого аудита удалены по двум зафиксированным собственным container IDs вместе с их volumes; пользовательские resources не удалялись.

## 5. CI Integration

`.github/workflows/ci.yml:90–91` безусловно вызывает `yarn test:integration` в quality job. `package.json:33` разрешает его в `node test/run-integration.mjs`. Job имеет timeout 20 minutes (`ci.yml:27`), disposable PostgreSQL 17/Redis 7 services и Node 22; triggers сохранены. Quality job и integration step не имеют optional condition или continue-on-error. Условия release/deployment steps за пределами этого gate не делают тесты необязательными.

Main runner обязательно запускает 47 checks (`:35`), прежние 20 entries в неизменённом порядке плюс Document HTTP один раз (`:8–30,36–43`), затем direct Document migration один раз (`:47`). На каждой обычной suite DB выполняются реальный migrate deploy и schema diff с `--exit-code`. Document migration владеет своим baseline-before/after lifecycle; лишнего outer migrated DB нет. Standalone wrapper отдельно внутри CI не вызывается. Нет `|| true`, silent skipping или suppression exit codes. При ранней ошибке последующие suites могут не запускаться, но job тогда non-zero.

Полный локальный entrypoint занял **153.94 s**, то есть около 2m34s при job budget 20m. Это даёт локальный запас для integration части, но не доказывает runtime всего GitHub Actions job: install/build/прочие шаги также входят в timeout, а удалённый Actions run здесь не выполнялся.

## 6. Independent Test Results

Использованы новые собственные PostgreSQL 17/Redis 7 containers, привязанные только к loopback ports 55450/56450. Bootstrap DB — disposable `oxus_document_release_test`; suites получают новые UUID DB. Production/Test/MinIO не использовались. Синтетический remote host не подключался. Dependency reinstall не выполнялся.

| Проверка этого аудита | Результат |
| --- | --- |
| Полный Jest, `node node_modules/jest/bin/jest.js --runInBand` | PASS: 46 suites, 412 tests. |
| Package script `npm run test -- --runInBand` | PASS: те же 412 tests, повтор не учитывается. |
| Package script `npm run test:integration` | PASS: 348 node:test tests, 22 test files и один plain smoke script; 23 уникальных invocations. Это тот же package script, который CI вызывает через yarn. |
| Targeted `node --test test/test-runner.test.mjs` | PASS: 47, повтор не учитывается. |
| Main Document HTTP / migration | PASS: 80 / 4; включены в 348. |
| Прежние integration/contract/security suites | PASS: 217 node:test tests и 11 smoke scenarios. |
| Standalone Document HTTP | PASS: 80, повтор не учитывается. |
| Direct migration suite | PASS: 4, повтор не учитывается; настоящий Prisma Migrate. |
| Prisma validate через prepared child environment | PASS, application config действительно загружен. |
| Nest build / TypeScript `--noEmit` | PASS / PASS. |
| Штатный TypeScript lint без fix | PASS. |
| ESLint recommended JS с Node globals для четырёх MJS | PASS. |
| `node --check` для четырёх MJS | PASS. |
| Дополнительный independent actual Prisma loader probe | PASS: 16 cases, 0 connections, preload не исполнен. |
| `git diff --check`, новые файлы, scope/index/hash verification | PASS. |

**Уникальный итог: 760 = 412 Jest + 348 node:test.** Повторные прогоны, вложенные simulated fault probes, 16 audit cases и 11 plain smoke scenarios не увеличивают этот итог. В обязательных framework suites: failed/skipped/cancelled/todo — 0.

Локальные evidence logs: `/private/tmp/oxus-doc-release-{jest,test-script,integration,targeted,standalone-http,direct-migration,validate,build,typescript,lint,mjs-lint,config-probe}.txt`. Parsed inventory: `/private/tmp/oxus-doc-release-results.json`. Это временные артефакты текущего аудита, не файлы будущего commit.

## 7. Findings

**P0: нет. P1: нет. F-CI-01: CLOSED. Новых blocking fixes до commit не требуется.**

| Finding | Severity | Файл / доказательство / минимальное решение |
| --- | --- | --- |
| F-CI-02 — MJS lint coverage | P2, non-blocking, известное замечание | `package.json:17` включает только TS glob; `.github/workflows/ci.yml:79` вызывает этот lint. Поэтому CI не повторяет локальный дополнительный MJS lint для четырёх изменённых JS files. Runtime/safety tests обязательны и все прошли. Минимальное улучшение отдельной задачей: явный MJS lint script/step с соответствующими Node globals. |

В предыдущих отчётах F-CI-02 обозначался P3. Здесь использована заданная заказчиком классификация: validation coverage gap — неблокирующая P2, а не чисто косметическая P3. Это не новый дефект remediation и не препятствие текущему commit. Косметических P3, требующих исправления, не обнаружено. Риски среды ниже отделены от findings patch.

## 8. Remaining Risks

- Loopback hostname/port не доказывает физическую локальность сервера: за ними может стоять tunnel/proxy или изменённый resolver. Disposable ownership инфраструктуры должен быть известен оператору. Этот аудит использовал только созданные им containers.
- Runner не является sandbox всего external environment. Arbitrary parent NODE_OPTIONS/code выполняется до validation; child NODE_OPTIONS очищается. Parent PG auth/TLS/startup options, иные runtime/module settings и raw Prisma CLI вне защищённых entrypoint остаются ответственностью окружения. F-CI-01 не требует переписывать application Prisma config.
- Bootstrap database должна существовать на disposable service, а role должна иметь CREATE/DROP права. Суффикс `_test` сам по себе не подтверждает отсутствие ценных данных; bootstrap не мигрируется и не удаляется runner.
- Redis guard закрепляет loopback URL, но сам Redis не получает UUID server на каждую suite. Он должен принадлежать disposable запуску, как service текущего аудита/CI. Полная изоляция произвольной shared Redis не заявляется.
- SIGKILL/остановка host могут прервать обычный JS cleanup; graceful failures проверены. Test/mock ownership не защищает от злонамеренного другого администратора БД, заменяющего resource между CREATE/DROP.
- Remote GitHub Actions run и время всего quality job не подтверждены. Штатный MJS lint gap остаётся F-CI-02.

## 9. Final Release Gate

**PASS WITH NOTES.** F-CI-01 окончательно закрыт в трёх проверенных entrypoint; bypass через реальный Prisma config loader не воспроизводится. Новых P0/P1 нет. Оба runner и direct migration entrypoint безопасны для управляемой disposable localhost инфраструктуры с указанными ограничениями среды. Пройдено 760 уникальных тестов, обязательность CI gates и сохранность migration assertions подтверждены.

Можно создавать отдельный CI Hardening commit в согласованном source/report scope. Этот аудит изменил только данный release review report в репозитории. Index остался пустым; git add/commit/push, deploy, migrations на Production/Test и операции MinIO не выполнялись.
