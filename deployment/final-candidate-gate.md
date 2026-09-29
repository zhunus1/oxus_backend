# Final Candidate Gate — 2026-09-29

Проверен accumulated working tree после Phase 1–4, а не только HEAD. **Вердикт: CANDIDATE NOT READY.** Первый обязательный integration run завершился с permanent-test failure `ECONNRESET` (C01). Один диагностический повтор прошёл полностью, но не отменяет правило этого gate: неожиданный failed test не позволяет признать candidate готовым. Дополнительно подтверждены C02/C03. Исправлений не выполнялось.

Это локальный аудит candidate. Он не подтверждает GitHub CI, работоспособность развёрнутого Swagger UI, реальные merchant/SMTP/storage credentials, состояние production data или production readiness.

## A. Candidate inventory

- HEAD: `3b593656640f10faad792611b41e45b81dca1662`; текущая ветка: `test`.
- На входе: **49 modified + 46 untracked files = 95**. Staged changes, deleted и renamed files отсутствуют.
- После gate добавлен только этот отчёт: **49 modified + 47 untracked = 96** файлов предполагаемого будущего change set.
- Fingerprint входного состава: SHA-256 `1d38f749380e61783d9e71f0e886ff23acadbfaa7d6b9eb4cbb0913d46f1b978`. Алгоритм: отсортированные 95 путей, каждая строка `path<TAB>sha256(file)<LF>`. Сам этот отчёт в fingerprint не входит.
- До проверок сохранены hashes всех 631 tracked/untracked файлов исходного snapshot. Финальная сверка подтвердила: все 631 файла неизменны, добавлен только этот отчёт; HEAD прежний, index пуст. Generated/ignored файлы в fingerprint не входят.
- `M`/`U` ниже — исходный Git status. «Да» означает принадлежность согласованному составу будущего candidate, **не разрешение продвигать текущий failed gate**.

| File | Category | Phase / reason | Expected in candidate? |
|---|---|---|---|
| `.env.example` (M) | deployment | Phase 1/3: callback URL и явный payment mode; только example | Да |
| `.github/workflows/ci.yml` (M) | CI | Phase 2/3: PG/Redis integration gate, types и deployment runtime probe | Да |
| `README.md` (M) | OpenAPI/docs | Manual workflow: draft/account-after-payment и ссылка на integration contract | Да |
| `compose.yaml` (M) | deployment | Phase 3 R01: payment mode propagation; C02 остаётся | Да |
| `deployment/.env.example` (M) | deployment | Phase 1/3: receiving secret semantics, result URL, mode example | Да |
| `deployment/audits/final-release-historical.sql` (U) | audits | Release audit/Phase 3: read-only historical invariants и R02 review | Да |
| `deployment/audits/phase1-contract-duplicates.sql` (U) | audits | Phase 1: read-only student/provider duplicates | Да |
| `deployment/audits/phase2-currencies.sql` (U) | audits | Phase 2: read-only currency totals | Да |
| `deployment/audits/phase3-historical-benefits.sql` (U) | audits | Phase 3 R02: read-only ambiguous historical benefits | Да |
| `deployment/compose.yaml` (M) | deployment | Phase 3 R01: payment mode в backend/migrator env | Да |
| `deployment/deploy.sh` (M) | deployment | Phase 3 R01: validation mode до operational changes | Да |
| `deployment/final-release-readiness.md` (U) | OpenAPI/docs | Предыдущий audit: historical F/R findings и scope | Да |
| `deployment/manual-contracts.md` (U) | OpenAPI/docs | Manual workflow API, deployment и frontend documentation | Да |
| `deployment/phase1-security-review.md` (U) | OpenAPI/docs | Phase 1 F01–F06 evidence/report | Да |
| `deployment/phase2-review.md` (U) | OpenAPI/docs | Phase 2 F07–F11 evidence/report | Да |
| `deployment/phase3-production-blockers.md` (U) | OpenAPI/docs | Phase 3 R01/R02/R08 evidence/report | Да |
| `deployment/phase4-reporting-api-performance.md` (U) | OpenAPI/docs | Phase 4 R03–R07 evidence/report | Да |
| `deployment/tests/freedom-mode-probe.cjs` (U) | tests | Phase 3: isolated compiled-service mode probe, mocked HTTP | Да |
| `deployment/tests/test_deploy.py` (M) | tests | Phase 3: mode preflight regression | Да |
| `deployment/tests/test_freedom_mode_runtime.py` (U) | tests | Phase 3: real Compose/container mode tests | Да |
| `package.json` (M) | production code | Manual/Phase 1/2: permanent suite scripts и full runner entry | Да |
| `src/common/dto/page-query.dto.ts` (U) | production code | Phase 4 R07: reusable max100 bounds для HTTP/direct calls | Да |
| `src/common/openapi/flow-responses.ts` (U) | OpenAPI/docs | Phase 4 R05: inline OpenAPI response schemas | Да |
| `src/modules/admin/admin.controller.ts` (M) | production code | Phase 4 R05/R07: finance schemas и earnings pagination | Да |
| `src/modules/admin/admin.service.ts` (M) | production code | Согласованная EXPERT profile create/repair правка | Да |
| `src/modules/admin/analytics.controller.ts` (M) | production code | Phase 4 R05: response schemas и bearer | Да |
| `src/modules/admin/analytics.service.ts` (M) | production code | Phase 2/4 F08/R03/R04: occurredAt, cohort/lost/SCHOOLBOY/snapshot | Да |
| `src/modules/admin/api/dto/analytics-query.dto.ts` (M) | production code | Phase 4 R05: registration vs event date semantics | Да |
| `src/modules/admin/finance-earnings.query.ts` (U) | production code | Phase 4 R07: SQL currency aggregation ограниченного expert scope | Да |
| `src/modules/admin/finance.service.ts` (M) | production code | Phase 2/4 F07/R07: currency receipts, SQL totals, bounded earnings | Да |
| `src/modules/admin/users/repository/users.repository.ts` (M) | production code | Согласованная EXPERT profile creation через legacy users writer | Да |
| `src/modules/billing/api/payment.controller.ts` (M) | production code | Phase 1/4 F01/R05: raw signed callback, XML ACK, documentation | Да |
| `src/modules/billing/domain/freedom-signature.ts` (U) | production code | Phase 1 F01: raw scalar provider signature helper | Да |
| `src/modules/billing/repository/payment.repository.ts` (M) | production code | Phase 1 F02: atomic exactly-once settlement/providerRef | Да |
| `src/modules/billing/service/freedompay.service.spec.ts` (U) | tests | Phase 4 R06: init POST/mode signature test | Да |
| `src/modules/billing/service/freedompay.service.ts` (M) | production code | Phase 1/3/4 F01/R01/R06: verification, mode и POST parameter | Да |
| `src/modules/billing/service/payment.service.ts` (M) | production code | Phase 1: verified atomic settlement, запрет online init для manual contracts | Да |
| `src/modules/contract/api/contract-scan.controller.ts` (U) | production code | Manual/Phase 1/4: authenticated multipart/binary scan API | Да |
| `src/modules/contract/api/contract.controller.ts` (M) | production code | Manual/Phase 1/4: OTP guard и response/bearer schemas | Да |
| `src/modules/contract/api/dto/contract-schedule-preview.dto.ts` (U) | production code | Manual workflow: preview terms и timezone validation | Да |
| `src/modules/contract/api/dto/contracts-query.dto.ts` (U) | production code | Phase 4 R07: list status и page bounds | Да |
| `src/modules/contract/api/dto/create-contract-for-student.dto.ts` (M) | production code | Manual workflow: payment terms DTO reuse | Да |
| `src/modules/contract/api/dto/manual-contract.dto.ts` (U) | production code | Manual workflow: signature/receipt/terms request validation | Да |
| `src/modules/contract/api/dto/update-contract-meta.dto.ts` (M) | production code | Manual workflow: editable unsigned payment terms | Да |
| `src/modules/contract/api/expert-contract.controller.ts` (M) | production code | Phase 1/4: actor propagation, OTP guard, pagination/docs | Да |
| `src/modules/contract/api/manual-contract.controller.ts` (U) | production code | Manual/Phase 1/4: preview/signature/confirm/installment API | Да |
| `src/modules/contract/api/online-signing-disabled.guard.ts` (U) | production code | Manual workflow: fail-closed 409 для legacy OTP routes | Да |
| `src/modules/contract/contract.module.ts` (M) | production code | Manual workflow: registration manual/scan controllers/services | Да |
| `src/modules/contract/domain/contract-access.ts` (U) | production code | Phase 1/2: shared current-owner/live-account/ADMIN policy | Да |
| `src/modules/contract/domain/contract-creation.ts` (U) | production code | Phase 1 F04: student lock и collision-safe numbering | Да |
| `src/modules/contract/domain/contract-journey.ts` (U) | production code | Phase 2 F08: first business milestones внутри transaction | Да |
| `src/modules/contract/domain/historical-contract-benefits.ts` (U) | production code | Phase 3 R02: ambiguity guard, no implicit regrant | Да |
| `src/modules/contract/domain/manual-contract-confirmation.ts` (U) | production code | Manual/Phase 1/2/3: atomic receipts/benefits/conversion/events | Да |
| `src/modules/contract/domain/manual-contract.spec.ts` (U) | tests | Manual/Phase 3: schedule, rounding, dates и commercial terms tests | Да |
| `src/modules/contract/domain/manual-contract.ts` (U) | production code | Manual/Phase 3: shared paid terms, exact monthly schedule | Да |
| `src/modules/contract/repository/contract.repository.ts` (M) | production code | Phase 1/3/4: ownership, locks/terms, bounded list; C03 remains | Да |
| `src/modules/contract/service/contract-notification.service.ts` (M) | production code | Manual workflow: бумажная подпись в legacy email copy | Да |
| `src/modules/contract/service/contract-scan.service.spec.ts` (U) | tests | Manual/Phase 1: file validation, storage privacy и auth tests | Да |
| `src/modules/contract/service/contract-scan.service.ts` (U) | production code | Manual/Phase 1: private bucket, content validation, owner recheck | Да |
| `src/modules/contract/service/contract.service.ts` (M) | production code | Phase 1/4: ownership API и pagination/manual-payment gate | Да |
| `src/modules/contract/service/manual-contract.service.ts` (U) | production code | Manual/Phase 1/2: signature и ordered idempotent installment receipts | Да |
| `src/modules/lead/api/dto/sales/expert-lead-query.dto.ts` (M) | production code | Manual/Phase 2 F09: SIGNING/SIGNED и общие filters | Да |
| `src/modules/lead/api/dto/sales/prepare-lead-contract.dto.ts` (M) | production code | Manual workflow: отдельная parent identity и pre-account draft | Да |
| `src/modules/lead/api/expert-lead.controller.ts` (M) | production code | Manual/Phase 2/4: draft/signature/confirm routes и summary/docs | Да |
| `src/modules/lead/domain/lead-transaction.spec.ts` (M) | tests | Phase 1: raw PostgreSQL conflict retry regression | Да |
| `src/modules/lead/domain/lead-transaction.ts` (M) | production code | Phase 1: retry Serializable/deadlock driver errors | Да |
| `src/modules/lead/repository/sales-lead.repository.ts` (M) | production code | Manual workflow: freeze CONTRACT_PENDING без contractId | Да |
| `src/modules/lead/service/expert-lead.service.ts` (M) | production code | Manual/Phase 1/2: tabs, shared filters, stage sort и detail ownership | Да |
| `src/modules/lead/service/lead-contract.service.ts` (M) | production code | Manual/Phase 1/3: draft-first, first-receipt conversion, shared guards | Да |
| `src/modules/lead/service/lead-expert-call.service.ts` (M) | production code | Manual workflow: booking blocked во время signing | Да |
| `src/modules/lead/service/lead-notification.service.spec.ts` (M) | tests | Regression: явный unreadOnly в existing DTO fixtures | Да |
| `src/modules/lead/service/lead-student-invitation.service.ts` (M) | production code | Phase 1 F05: resend current-owner authorization | Да |
| `src/modules/lead/service/manual-lead-v2.service.ts` (M) | production code | Manual workflow: freeze questionnaire по signing status | Да |
| `src/modules/user-journey/user-journey.constants.ts` (M) | production code | Phase 2 F08: manual conversion/installment event types | Да |
| `src/prisma/migrations/20260928130000_manual_contracts/migration.sql` (U) | database migration | Manual schema | Да |
| `src/prisma/migrations/20260928150000_journey_occurred_at/migration.sql` (U) | database migration | Phase 2 F08: occurredAt column/index | Да |
| `src/prisma/migrations/20260928151000_backfill_manual_journey/migration.sql` (U) | database migration | Phase 2 F08: подтверждённые historical manual milestones | Да |
| `src/prisma/schema.prisma` (M) | production code | Manual/Phase 2: draft/installments/payment fields и occurredAt | Да |
| `src/prisma/seed/sales-expert-demo.plan.ts` (M) | production code | Phase 2 F11: demo descriptions соответствуют manual stages | Да |
| `src/prisma/seed/sales-expert-demo.seed.ts` (M) | production code | Phase 1/2/3: coherent synthetic manual demo; shared terms/student lock | Да |
| `test/admin-expert-profile.test.ts` (U) | tests | Согласованная EXPERT repair regression; C01 observed | Да |
| `test/expert-lead-visibility-http.test.ts` (M) | tests | Manual workflow: stage-entry ordering assertions | Да |
| `test/manual-contract-http.test.ts` (U) | tests | Manual workflow: real auth/HTTP/DB acceptance tests | Да |
| `test/openapi-contract.test.ts` (U) | tests | Phase 4 R05: generated document contract gate | Да |
| `test/performance/phase4-performance.cjs` (U) | tests | Phase 4 R07: permanent read-only local benchmark utility | Да |
| `test/phase1-contract-security.test.ts` (U) | tests | Phase 1 F01–F06 permanent security/concurrency/rollback gate | Да |
| `test/phase2-journey-migration.test.ts` (U) | tests | Phase 2 F08: historical backfill replay/no corruption | Да |
| `test/phase2-reporting.test.ts` (U) | tests | Phase 2 F07–F10: finance, journey, filters, ADMIN policy | Да |
| `test/phase3-production-blockers.test.ts` (U) | tests | Phase 3 R02/R08: historical benefits/commercial invariants | Да |
| `test/phase4-reporting.test.ts` (U) | tests | Phase 4 R03/R04/R07: analytics/pagination/40k volume | Да |
| `test/run-integration.mjs` (U) | tests | Phase 2–4 F11: isolated migrated DB per suite, fail-fast full gate | Да |
| `test/sales-contract-reliability.test.ts` (M) | tests | Manual/Phase 1: guarded legacy ownership, disabled OTP и retry reliability | Да |
| `test/sales-expert-demo.test.ts` (M) | tests | Phase 2 F11: draft/no account, paid demo, tab assertions | Да |
| `test/sales-expert-v2-regression.test.ts` (M) | tests | Manual/Phase 1/4: first-receipt fixture, Redis readiness, pagination | Да |
| `test/sales-expert-v2-smoke.ts` (M) | tests | Manual workflow: 11 retained smoke scenarios с first-receipt confirmation | Да |
| `deployment/final-candidate-gate.md` (U, этот gate) | OpenAPI/docs | Final Candidate Gate: единственный новый deliverable этого этапа | Да |

Случайных unrelated additions в этих 95 файлах не обнаружено. Исправление создания `ConsultantProfile` для EXPERT — отдельная ранее согласованная правка пользователя, поэтому включено вместе с её regression test. Исторические phase reports сохраняются как история; прежние вердикты не заменяют этот gate.

Файлы вне будущего commit:

| Artifact | Наблюдение / решение |
|---|---|
| `.env`, `src/assets/jitsi-private-key.pk` | Существуют локально, ignored. Содержимое не выводилось и не включается в candidate; не применять `git add -f` |
| `dist/`, `generated/`, `node_modules/`, `.yarn/install-state.gz` | Ignored build/dependency output; build мог обновить их локально |
| `.DS_Store`, `docs/.DS_Store`, `.ruff_cache/`, `deployment/**/__pycache__/` | Ignored OS/cache/Python output |
| Ignored `docs/postman/*`, локальные simulation/review docs и calculator JSON | Не часть согласованного 95-file diff; не добавлять вместе с release |
| `/private/tmp/oxus-candidate-*`, предыдущие `/private/tmp/oxus-phase4-*`, `/private/tmp/oxus-release-audit/*` | Диагностические artifacts вне repo; не переносить в production source/commit |
| `$TMPDIR/oxus-phase4-openapi.json` | Generated OpenAPI вне repo; hash приведён в H, сам JSON не добавляется |
| DB dumps, SQLite/DB files, logs, credentials, generated OpenAPI внутри change set | В 95 candidate paths не обнаружены |

## B. Diff review

Reviewed surface: полный tracked diff относительно HEAD, новые production/domain/OpenAPI файлы, migrations, test runner/fixtures/assertions, deployment probes, SQL audits и phase reports. `git diff` сам по себе не показывает untracked; они включены отдельным inventory и scan.

| Change group | Связь с требованиями / оценка |
|---|---|
| Draft-first manual contracts, separate student/parent identity, signatures, receipts, installments, scans | Согласованный основной workflow; account/benefits не создаются подготовкой или отдельной отметкой подписи |
| Shared ownership, student lock/number allocation, payment settlement/signature verification | Phase 1 F01–F06; проверки работают и на domain boundary, не только через HTTP guards |
| Currency grouping, occurredAt/events/backfill, summary filters, ADMIN metadata, demo, integration CI | Phase 2 F07–F11; breaking API последствия собраны в I |
| Effective FreedomPay mode, historical benefits guard, FREE validation | Phase 3 R01/R02/R08; historical guard fail-closed, без автоматического восстановления benefits |
| Corrected analytics cohort/lostLeads/SCHOOLBOY, bounded contracts/earnings, OpenAPI, POST parameter | Phase 4 R03–R07; bounded Node response и SQL aggregation подтверждены volume regression |
| EXPERT profile create/repair | Отдельная согласованная правка; `upsert update:{}` сохраняет isActive и настройки, transactional rollback проверяется; текущий suite имеет C01 |
| Изменённые старые tests | Assertions переведены на manual confirmation, новую цену и pagination; HTTP OTP assertions требуют 409. Отдельные legacy repository tests сохраняют проверку старых внутренних методов |

Added TODO/FIXME/debugger: **0**. Production test-only authorization bypass, hardcoded test gateway keys, temporary audit imports и новое temporary logging не обнаружены. Fixture credentials, injected DB failures и HTTP/S3/SMTP mocks находятся в tests. `src/modules/test` — существующий продуктовый модуль тестирования учеников, не integration harness.

`test/run-integration.mjs`, `test/performance/phase4-performance.cjs`, deployment probes не импортируются runtime-модулями; `tsconfig.build.json` исключает `test`/`*.spec.ts`, `.dockerignore` исключает `test`/`deployment`, runner image копирует перечисленные production artifacts. Demo seed — отдельный существующий CLI, не startup hook; не запускать его на production при deployment. Рабочие legacy OTP methods остались внутри service/repository, но все четыре HTTP route закрыты guard; иных runtime callers не найдено. Это не устраняет раскрытие legacy OTP fields через обычные reads (C03).

Новых dependency changes в lockfile нет. Фазы нельзя коммитить частично: service/helper/schema/migration/test/CI изменения связаны. Найденные дефекты перечислены в P; здесь ничего не исправлялось.

## C. Secret scan

Scope: `git status --porcelain -uall`, полный `git diff HEAD` (189016 bytes, включая removals), содержимое всех 95 modified/untracked candidate files. Выполнены case-insensitive searches по password/secret/token/cookie/authorization/merchant/access-key/private-key/database/SMTP, private-key headers, типичным token formats, email/phone literals; отдельно reviewed credential assignments и fixture origin. Проверены ignored paths, чтобы исключить случайное включение локальных credentials.

| Check | Result |
|---|---|
| Credential-related references | 339 matched lines в 48 candidate files; config names, runtime lookup, tests, placeholders и документация; реальные значения в отчёт не выводятся |
| Private-key header / recognizable access-token literal | 0 / 0 matches в candidate files |
| Email/phone patterns | 27 lines в 11 files: synthetic examples/fixtures, служебный sender, существующие staff/demo-target identifiers; реальных student/customer dumps в change set не обнаружено |
| Production `.env`, private keys, real merchant/SMTP/DB/JWT/AWS credentials | Не найдены среди candidate paths/literals; ignored local secret-bearing files не открывались для публикации |
| Public deployment URLs | Существующие публичные адреса приложения/инфраструктуры, не secret material; новая customer-specific URL/token не обнаружена |

**Реальные secrets в проверенном diff/untracked составе не обнаружены.** Это результат pattern scan и review данного snapshot, не доказательство отсутствия секретов во всей Git history или на серверах. Synthetic local/test passwords и env-template placeholders допустимы только в обозначенном контексте. C03 — отдельная runtime data-exposure проблема, а не найденный в Git secret.

## D. Migration state

**PASS локально:** 42 migration directories, уникальные имена и timestamp prefixes, лексикографический порядок корректен. 39 historical SQL migrations и `migration_lock.toml` побайтно совпадают с HEAD (40 файлов). Новых SQL migrations только **3**, все untracked в исходном inventory. Editing historical migrations не обнаружен.

В независимой новой disposable local DB выполнены `prisma migrate deploy` и `prisma migrate diff --from-config-datasource --to-schema src/prisma/schema.prisma --exit-code`: exit 0, no difference. Все 42 `_prisma_migrations.checksum` совпали с SHA-256 SQL на диске; все finished, без rolled-back migration. DB после проверки удалена. Диагностический integration runner дополнительно получил clean schema на каждой из 16 isolated databases. Checksum существующей production DB здесь не проверялся.

Полный workflow migration inventory (первые семь уже в HEAD):

| Migration | Purpose | Data rewrite | Lock risk | Backfill | Rollback note |
|---|---|---|---|---|---|
| `20260825170000_add_consultation_expert_status_start_index` | Индекс consultation expert/status/start | Нет business rewrite | Обычный CREATE INDEX; время зависит от объёма | Нет | Обычно оставить индекс |
| `20260826190000_add_sales_manager_crm` | CRM lead/source/submission/callback/call/activity, permissions | Rename/nullable Lead fields, source/roles/permissions, snapshot старых лидов | ALTER/FK/index + scan/update Lead | Старые submissions/displayName/source | Не удалять CRM данные; отдельный forward compatibility plan |
| `20260906110000_sales_expert_v2` | Expert assignment, office/manual workflow statuses, invitations | Дозаполнение assignedExpertUserId из calls | ALTER/FK/index; новые enum values | Assigned expert | Enum/table removal не делать автоматически |
| `20260906180000_lead_invitation_delivery_version` | Versioned invitation retries | Default deliveryVersion=1 для старых rows | Короткий ALTER lock, оценить на копии | Default 1 | Колонку оставить; учесть queued jobs |
| `20260915120000_lead_call_email_notifications` | Delivery key/lease/retry fields | Defaults/nullable columns | ALTER + unique index на NotificationLog | Defaults, без повторной рассылки | Оставить поля и durable intents |
| `20260915130000_lead_status_changed_at` | Время входа в этап + expert ordering index | UPDATE всех Lead, затем NOT NULL/default | Transaction держит ALTER/UPDATE/index locks; важен production rehearsal | `statusChangedAt=createdAt`, историческое время этапа неизвестно | Не удалять новые реальные stage timestamps |
| `20260916160000_add_user_middlename` | Раздельное отчество | Нет, nullable TEXT | Короткий ALTER User lock | Нет | Оставить nullable column |
| `20260928130000_manual_contracts` **NEW** | ContractPaymentType, contract fields, draft/schedule tables | Additive; старые contracts не преобразуются и не удаляются | ALTER Contract, FK/index на новых таблицах | Нет автоматической конверсии legacy | Schema оставить; после новых drafts/receipts только отдельный recovery plan |
| `20260928150000_journey_occurred_at` **NEW** | Business event timestamp + index | Nullable field, прежний createdAt сохранён | ALTER + обычный index build по event table | Legacy null читается через createdAt fallback | Колонку/индекс оставить |
| `20260928151000_backfill_manual_journey` **NEW** | Восстановление только подтверждённых manual facts | INSERT отсутствующих milestones/paid-installment events | Transaction со scans/joins/NOT EXISTS; возможны длительность/WAL/locks на записи | First milestone per user/type; later per contract/number; replay idempotent | Не откатывать DELETE по эвристике; forward fix и snapshot evidence |

SHA-256 ключевых migration SQL:

| Migration suffix | SHA-256 |
|---|---|
| lead_status_changed_at | `a321dba69271aca4086fd1af599487a0fc50be501ef83d5ca06c0b71a902b332` |
| add_user_middlename | `453ca15d0dcf275aa7a1fe7ab76e4fc7ff51344e1a0442810505cf812d85942d` |
| manual_contracts | `f4cc540cffe7f2b85e02f2e00be5823a885fc50378a17e1ed6d513ccebfe2c62` |
| journey_occurred_at | `be09b1d66893ba69716d81e7b2cd7d450cbcdde11ae246881bb588f644e385e3` |
| backfill_manual_journey | `735b6e4d1c0ba383a1ed11e4bbdca7083b7961e7308e9e9a46fcce2c773d292c` |

Полный набор, применённый clean deploy:

```text
20260228075258_001_init
20260301141049_002_test
20260302153625_003_idk
20260302160444_004_programs
20260319073021_006_attempt_uuid
20260319075045_007_attempt_submitted_at
20260323140337_008_expert_assignment_and_sla
20260324051045_009_event
20260329141549
20260329161454
20260330062717
20260331062625_add_email_question_type
20260331130911_add_program_requirements
20260401130150_add_degree_level
20260401144023_document_type
20260401144912_add_org_image
20260404170000_program_catalog_sync
20260404193000_qs_import_and_org_requests
20260408000000_add_lead
20260408010000_update_lead
20260411000000_lead_add_email_topic
20260411152425_add_question_segment_description_label
20260412000000_add_contract_model
20260412010000_add_contract_currency
20260504134053_init
20260504200000_add_user_journey_event
20260504210044_add_contract_paid_status
20260524120000_user_phone_optional
20260526145316_add_organisation_cover_image
20260527071048_add_task
20260610074119_add_collab_meeting
20260610082058_add_recurring_to_collab_meeting
20260825170000_add_consultation_expert_status_start_index
20260826190000_add_sales_manager_crm
20260906110000_sales_expert_v2
20260906180000_lead_invitation_delivery_version
20260915120000_lead_call_email_notifications
20260915130000_lead_status_changed_at
20260916160000_add_user_middlename
20260928130000_manual_contracts
20260928150000_journey_occurred_at
20260928151000_backfill_manual_journey
```

Backfill regression проверяет повторный запуск, неизменность исходного event и отсутствие создания account из draft. Чистая пустая DB не доказывает приемлемую длительность locks на production volume. Rollout требует restore rehearsal и сверки production migration history; никаких новых down migrations gate не добавляет.

## E. Test gate

Среда: macOS, Node `22.15.1`, локальные PostgreSQL/Redis в существующих Docker test containers. Production/server/merchant connections не использовались. Build завершён **до** запуска tests, использующих `dist`; повторного build параллельно integration не было. CI использует Ubuntu, Node 22, PostgreSQL 17 и Redis 7; локальная проверка не заменяет эту среду.

Команды выполнены без `--fix`: `nest build`, `tsc --noEmit`, `eslint '{src,apps,libs,test}/**/*.ts'`, `jest --runInBand`, `node test/run-integration.mjs`, `python3 -m unittest discover -s deployment/tests -v`, обе Compose validations, `bash -n` трёх deployment scripts, `git diff --check`. Для integration заданы synthetic local `DATABASE_URL` с suffix `_test` и `SALES_V2_TEST_REDIS_URL`; каждый suite получает собственную DB, удаляемую в finally.

**Основной обязательный запуск:**

| Gate | Passed | Failed | Skipped | Примечание |
|---|---:|---:|---:|---|
| Nest build | 1 | 0 | 0 | Exit 0 |
| TypeScript | 1 | 0 | 0 | Exit 0 |
| ESLint | 1 | 0 | 0 | Exit 0, без auto-fix |
| Jest | 270 | 0 | 0 | 39 suites |
| Integration: Phase 4 | 12 | 0 | 0 | Включая 40k contracts / 60k installments |
| Integration: generated OpenAPI | 7 | 0 | 0 | Документ скомпилированных controllers |
| Integration: Phase 3 | 17 | 0 | 0 | R02/R08 |
| Integration: admin expert profile | 10 | **1** | 0 | C01, `read ECONNRESET`; runner exit 1 |
| Integration: оставшиеся formal suites | 0 | 0 | 0 | **136 не запущены** из-за fail-fast; не выдаются за skipped/pass |
| Smoke | 0 | 0 | 0 | 11 сценариев не достигнуты первым runner |
| Deployment Python | 21 | 0 | 0 | Mode runtime subcases не считаются отдельными tests |
| Independent clean migrations | 42 | 0 | 0 | Не formal tests |
| Independent schema diff / checksum set | 1 / 42 | 0 | 0 | No drift, все applied checksums совпали |
| Compose validation | 2 | 0 | 0 | Local/server templates |
| Shell syntax | 3 | 0 | 0 | deploy/ssh-deploy/install-ci |
| git diff --check | 1 | 0 | 0 | И повторно после отчёта |

Первый formal gate: **337 passed, 1 failed, 136 not executed**, без неожиданного skipped. Это failed gate независимо от предыдущего baseline 474 PASS.

Из-за сбоя выполнен **один диагностический повтор неизменённого полного runner**, чтобы проверить воспроизводимость и оставшиеся suites. Он завершился exit 0:

| Integration suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `phase4-reporting.test.ts` | 12 | 0 | 0 |
| `openapi-contract.test.ts` | 7 | 0 | 0 |
| `phase3-production-blockers.test.ts` | 17 | 0 | 0 |
| `admin-expert-profile.test.ts` | 11 | 0 | 0 |
| `phase1-contract-security.test.ts` | 28 | 0 | 0 |
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
| `sales-expert-v2-smoke.ts` — smoke, не formal | 11 | 0 | 0 |

Диагностический runner: **183 formal tests + 11 smoke**, 16 clean DB deploy/schema-diff cycles. Повторные первые 47 tests не добавляются к formal total. Полный уникальный набор остаётся **474 formal = 270 Jest + 183 integration + 21 deployment**, отдельно **11 smoke**; у одного из этих tests в исходном запуске был failure. Поэтому формулировка «474 tests PASS, gate green» для этого этапа неверна. Повтор не доказывает root cause C01 и не закрывает его.

Evidence files вне repo: `/private/tmp/oxus-candidate-{build,types,lint,unit,integration,integration-diagnostic,deployment,migrations}.log`, `oxus-candidate-test-results.json`, `oxus-candidate-migrations.json`, sanitized `oxus-candidate-config.json`. Логи могут содержать synthetic failure injection stack traces; ожидаемые 4xx/5xx в negative tests не считаются новыми failures. Temporary OTP serialization probe не formal test; его первый запуск имел ошибку ручной DI-настройки harness, после корректной property injection probe подтвердил C03. Production/test source при этом не менялся.

## F. Business invariants

PASS в таблице — конкретный invariant подтверждён code review и прошедшими permanent tests, включая диагностический full run; это не общий green verdict.

| Invariant | Evidence | Result / граница |
|---|---|---|
| Prepare создаёт draft, не account/Contract/invitation | `LeadContractService.prepare`; manual HTTP draft test, demo, smoke | PASS для новых CRM leads; существующий linked contract возвращается совместимым retry |
| Signature не закрывает lead | draft.signedAt / manual studentSignedAt; manual HTTP | PASS: `CONTRACT_PENDING` остаётся до first receipt |
| Первый receipt + signature создаёт account/Contract/assignment/benefits | Serializable `confirm` → shared confirmation; concurrent и injected failure tests | PASS для CRM; existing account reuse не означает новый account |
| FULL → PAID; INSTALLMENT → SIGNED; последний tranche → PAID | `manual-contract.ts`, `manual-contract-confirmation.ts`, `ManualContractService`; HTTP schedule tests | PASS; lead `CONVERTED` уже после первого receipt, не после полного погашения |
| Нет account до денег | Draft/signature/wrong amount/future date/foreign expert/rollback tests | PASS в new CRM path; generic contract endpoint работает с уже существующим student |
| Idempotent retry | Same paidAt/amount и optional signedAt; duplicate/concurrent first/later receipt tests | PASS; изменённые факты при retry дают conflict, не второй receipt |
| Concurrency / rollback | Serializable retries + student/provider locks; DB-trigger failures на benefits/events/profile | PASS business scenarios; C01 остаётся отдельно по надёжности gate |
| Один Contract на student | Все найденные writers: generic repository, CRM confirm, demo; общий `lockStudentWithoutContract` | PASS runtime writers. Это не DB UNIQUE(studentId); historical duplicates/ручной SQL не исправляются |
| FREE не paid contract | Общий `commercialTerms`, повторная проверка stored draft, expert/ADMIN/direct/race tests | PASS обе цены и оба платных tiers; новый tier→price mapping не вводился |
| Ambiguous historical SIGNED блокируется | `assertHistoricalBenefits`; R02 missing/mismatch/competing/usage tests | PASS, 409 `HISTORICAL_BENEFITS_REVIEW_REQUIRED`, без partial writes/regrant |
| Valid manual SIGNED installments не попадают под historical guard | manualConfirmedAt retry branch; R02 new installment + transfer test | PASS |
| Historical consistent SIGNED не получает benefits повторно | R02 fully consumed package / exact first receipt | PASS observable consistency, не immutable proof исходной выдачи |
| ADMIN сохраняет business restrictions | F10/R08/R02 tests: signed metadata, price, duplicate, ordering, disabled actor | PASS; ADMIN не назначается expert. Для существующего unassigned non-CRM student subscription допустима без выдуманного expert/package — прежний явно проверенный scope |
| Этапная дата | `leadStatusUpdate`, all-tab statusChangedAt sorting, migration regression | PASS текущих переходов; исторический fallback createdAt не восстанавливает неизвестную дату |

Business decisions перед релизом: закрепить равные доли/округление, введённое экспертом согласованное количество 2–120; новая цена 1500000 KZT, Cambridge определяется 750000 KZT. Скан не prerequisite первого receipt: эксперт сначала подтверждает бумажный договор, затем прикрепляет scan. Prepayment/signature chronology в обоих направлениях не запрещена универсально; спорные historical случаи должны получить business disposition, а не автоматический repair.

## G. Security/payment invariants

| Invariant | Final evidence | Result |
|---|---|---|
| Current expert = operational owner | `contract-access.ts`: portrait assignment, pending CRM fallback; F03/F05 | PASS; foreign эксперт не получает read/write/scan доступ |
| Transfer A→B | Настоящий transfer в Phase 1, последующие reads/payment/scans, R02 retry | PASS; current owner B, historical signer/lead attribution не переписывается |
| Permission/role/profile revocation | Live domain checks, F06 + ADMIN matrix | PASS проверенного contract scope; spoofed isAdmin не authority |
| Forged FreedomPay rejected до writes | Raw scalar signature, receiving secret, timing-safe compare; F01 cases | PASS invalid/missing signature, tampered extensions, nested/duplicate amount, unsuccessful/uncaptured/context mismatch |
| Duplicate exactly-once | Serializable + order row lock + provider-ref advisory lock; F02 concurrent/retry/rollback | PASS для одного order/provider receipt |
| ProviderRef нельзя reuse между orders | F02 two-order replay/race | PASS; single receiving merchant model; historical duplicates требуют audit |
| Mode init/callback согласован | Jest modes 0/1; реальный compiled service внутри обоих Compose probe containers | PASS; invalid/blank fail before network, unset→0. Это не проверка live merchant |
| `pg_request_method=POST` | `freedompay.service.ts`, dedicated Jest init tests | PASS поля init; фактический provider POST ещё нужен |
| Signed XML ACK | HTTP phase1 payload/ACK verification | PASS local generated messages, HTTP 200 после settlement |
| Late failure/historical SUCCESS | F02 | PASS: SUCCESS не downgraded/regranted; failed callbacks отвергаются, без ошибочной выдачи |
| In-flight callback на manual contract | F02 ledger-only test | PASS: gateway ledger обновляется, manual benefits повторно не выдаются; нужна reconciliation |
| Private scans | MIME+magic/size, current owner + student/ADMIN, повторная ownership check после S3 I/O | PASS unit/HTTP authorization; anonymous access реального bucket ещё не проверен |
| Legacy secret-field redaction | Обычные contract reads используют include без omit; synthetic DB/service probe | **FAIL C03**: OTP hashes/expiry попадают в response |

MD5 здесь — существующий provider signing protocol, не password hashing. HTTP callback Public намеренно: authority задаётся подписью провайдера. ProviderRef uniqueness и historical SUCCESS policy не доказывают, что старые SUCCESS были когда-то проверены корректной подписью. Полный security audit всех неизменённых API за пределами перечисленного scope не заявляется.

## H. OpenAPI

**Generated-document check PASS: 7/7 permanent tests**, и в основном, и в диагностическом запуске (считать только один набор). Документ создаётся `SwaggerModule.createDocument` из built production controllers через test DI с mock dependencies. Main продолжает устанавливать Swagger на `/api`, API prefix `/api/v1`.

- Generated file: `$TMPDIR/oxus-phase4-openapi.json`, вне repo, **417830 bytes**.
- SHA-256: `a9ab4b993d1824534d4dee825cd271464a90bf2e9d34504786feea58716f59f4`.
- **223 paths, 102 named schemas, 136 `$ref`, 0 unresolved refs**; дополнительные response schemas inline.
- Проверены pagination/default20/max100, nullable finance/byCurrency, draft/contract:null/signature/confirmation/installments, occurredAt/storage time и nullable durations.
- Четыре OTP routes deprecated, документируют 409 `MANUAL_SIGNATURE_REQUIRED`, без обещанного 200/201 signing success.
- Scan upload multipart binary с лимитом; download PDF/JPEG/PNG/octet-stream binary, bearer auth.
- Protected изменённые операции документируют bearer; callback — provider-signed raw form/multipart/JSON со signed XML ACK и без bearer requirement.

Генерация OpenAPI не является response sanitizer: отсутствие OTP properties в schema не удаляет их из JSON (C03). Local check не поднимал полный server stack и не открывал Swagger UI в браузере; доступность deployed `/api` остаётся staging smoke. Hash фиксирует конкретный generated artifact этого gate, не server deployment.

## I. Frontend handoff

Единый контракт интеграции; ниже paths указаны без общего `/api/v1`.

| Area | Old behavior | New backend contract | Required frontend change | Breaking |
|---|---|---|---|---|
| Expert tabs/cards | NEW / FOLLOW_UP / combined CONTRACTS | `NEW`, `FOLLOW_UP`, `SIGNING`=`CONTRACT_PENDING`, `SIGNED`=`CONVERTED`; legacy `CONTRACTS`=SIGNING+SIGNED, `ARCHIVE` сохранён | Показать «Новые / Дожать / На подписании / Контракт подписан» и карточку «На подписании»; не суммировать overlapping counters | UI/semantic |
| Stage date | На части tabs использовалась createdAt | Все tabs sorted `statusChangedAt DESC, id DESC`; это момент входа в этап | Показывать statusChangedAt с timezone, не updatedAt/время платежа; legacy fallback возможен | Semantic |
| Summary filters | Summary не следовал search/source | `GET /expert/leads/summary?search=&source=` использует тот же predicate, что list | Передавать одинаковые filters; refresh list/card counters после операций | Semantic |
| Prepare | Создавались student и linked contract | `POST /expert/leads/:id/contract` → `{lead,contract:null,draft,invitationRequired:false}` для нового lead; повтор legacy может вернуть contract/draft:null | Не читать contract.id без null-check, не открывать student profile до confirm; хранить leadId и draft | **Да** |
| Edit draft | Изменение уже созданного contract | `PATCH /expert/leads/:id/contract` принимает полный draft DTO; после подписи terms frozen | Отдельная форма редактирования draft; linked legacy contract — metadata endpoint | **Да** для прежнего flow |
| Student/parent identity | Account/full-name assumptions | Student: firstname/lastname/optional middlename/email/phone; `parent:{firstname,lastname,middlename?,email?,phone?}` отдельно и обязателен для parent lead; исходные submissions не перезаписываются | Поля по роли автора анкеты; не копировать parent contacts в student identity и не split full name автоматически | **Да** для parent lead |
| Existing student | Confirmation могла требоваться на prepare | Matching email/phone проверяются при first confirm; 409 `EXISTING_STUDENT_CONFIRMATION_REQUIRED` с studentId; повтор с `existingStudentId` | Явный шаг выбора/подтверждения существующего account; не менять его credentials/роль | **Да** |
| Signature only | OTP/signing завершал процесс | `POST /expert/leads/:id/contract/signature {signedAt}` записывает бумажную подпись; account не создаётся | Оставлять lead на подписании, не считать его закрытым | **Да** |
| Price/payment type | Legacy prices и online payment assumptions | Новые 1500000/750000 KZT; `FULL` (1) или `INSTALLMENT` (явное 2–120); price750000 означает Cambridge Line | Два типа оплаты, количество вводит эксперт по решению директора; не изобретать tier-price mapping | **Да** |
| Schedule preview | Client-calculated schedule | `POST /contracts/payment-schedule/preview {price,currency,paymentType,installmentCount,firstPaidAt}` → decimal-string amounts и dueDate | Отображать server amounts; не пересчитывать float division. Almaty anniversary first receipt, month-end clamp с возвратом к исходному дню | Новый обязательный flow |
| First receipt | Подпись сама закрывала lead | `POST /expert/leads/:id/contract/confirm {paidAt,amount,signedAt?,existingStudentId?}` → `{lead,contract,invitationRequired}`; signedAt уже сохранён либо передаётся здесь | Подтверждать только реальную подпись + деньги; amount numeric с ≤2 decimals ровно scheduled first amount, timestamp с timezone | **Да** |
| Legacy existing contract | Online OTP path | `POST /contracts/:id/manual-signature`, затем `/confirm-manual` (или signedAt вместе с confirm); старые положительные KZT/USD/EUR terms сохраняются в совместимом scope | Не принуждать historical amount к новым ценам; 409 R02 отправлять на review, не retry-loop/авторемонт | **Да** |
| Installments/statuses | SIGNED воспринимался как весь payment завершён | `POST /contracts/:id/installments/:number/confirm {paidAt,amount}`; FULL→PAID, первый installment→SIGNED, последний→PAID; lead уже CONVERTED | Разделить lead tab SIGNED и Contract.status; показывать paid/remaining/schedule | **Да** |
| Receipt retry | Новый timestamp на каждое нажатие | Идентичные amount/paidAt/(signedAt при передаче) возвращают существующий факт; отличающиеся дают conflict | Хранить отправленный payload до разрешения timeout; не генерировать новые timestamps при network retry | **Да** |
| Contract list | `GET /contracts` → array всех rows | `{data,total,page,limit,totalPages}`, default page1/limit20, max100, deterministic createdAt/id; прежний status/owner filter | Перейти на envelope и server pagination; не считать `data.length` общим числом | **Да, shape** |
| Expert earnings | contracts содержал весь набор | `GET /admin/finance/experts/:id/earnings?page=&limit=` → `{expert,totals,contracts,total,page,limit,totalPages}`; totals по всему historical signer dataset | Пагинировать contracts; показывать серверные totals, не сумму текущей страницы | **Да, meaning** |
| Finance | Скалярные суммы без корректной currency grouping | Mixed currency scalar totals/currency могут быть null; `byCurrency`; finance rows amount/paidAmount/remainingAmount/currency | Убрать безусловный toFixed и fallback null→0; выводить currency groups, не складывать без FX policy | **Да, nullable** |
| Analytics dates | createdAt использовался как business date | Events: occurredAt с legacy fallback createdAt; createdAt остаётся временем записи; event date filters по business time | Показывать occurredAt, не путать registration cohort summary/funnel с event period. Date-only upper bound — midnight UTC, не конец дня | Semantic |
| Analytics population/lost | STUDENT-only; paid мог быть lost | Live STUDENT/SCHOOLBOY; lost = тот же registration cohort, age≥7 days, DISCOVERY+NONE без payment/conversion evidence; conversions — unique users lifetime events within cohort | Обновить подписи метрик/ожидания; null duration при неоднозначной chronology, не zero | Semantic |
| OTP | Active signing UI | Все `/contracts/:id/{otp,sign}/{student,expert}` → 409, deprecated | Удалить из активного сценария, поддержать `MANUAL_SIGNATURE_REQUIRED` | **Да** |
| Scans | Public-link assumptions | `POST /contracts/:id/scan` multipart field `file`, PDF/JPEG/PNG ≤10MiB после confirmation; `GET` authenticated binary, private no-store | Fetch blob с auth, затем download; не строить public MinIO URL из scanFileKey | **Да** для старого UI |
| FreedomPay | Callback мог выглядеть browser endpoint | `/payment/freedompay-webhook` только provider protocol; manual contracts не начинают online subscription payment | Frontend не имитирует callback и не использует его как подтверждение receipt | **Да** для online manual-flow |

Обязательные breaking changes перед совместным rollout: nullable prepare/draft-first и deferred account; nested parent identity; explicit existingStudent confirmation на confirm; manual signature+receipt вместо OTP; fixed commercial terms и exact retry payload; `/contracts` envelope; paginated earnings с global totals; nullable mixed-currency finance; authenticated scan download. Старый frontend без этих изменений нельзя считать совместимым, даже если HTTP health и Swagger работают. C03 не следует закреплять как клиентский контракт: frontend не должен использовать OTP hash/expiry.

## J. Historical-data gate

Read-only scripts присутствуют и reviewed:

| Script | Проверка | Выполнение в этом gate |
|---|---|---|
| `deployment/audits/final-release-historical.sql` | 26 SELECT reports: duplicates/ownership/payment/schedules/manual states/journey | PASS на clean final-schema DB с `default_transaction_read_only=on`; synthetic anomaly checks также в permanent Phase 3 |
| `deployment/audits/phase1-contract-duplicates.sql` | Duplicate student contracts / provider refs | PASS, read-only; исторические записи не изменяет |
| `deployment/audits/phase2-currencies.sql` | Contract/transaction/receipt totals по currency | PASS, read-only; не складывает валюты |
| `deployment/audits/phase3-historical-benefits.sql` | R02 ambiguous historical SIGNED, current-owner package/tier/usage/competing contracts | PASS read-only; positive synthetic candidates, manual evidence и guard semantics проверены permanent tests |

Первые/последний script сами используют RepeatableRead READ ONLY + timeouts; два коротких scripts содержат только SELECT и здесь дополнительно запускались под session read-only. Чистая пустая DB даёт пустые business result sets и проверяет SQL/schema compatibility, **не production anomaly counts**. Production backup/data в gate не читались и не менялись. SQL audit labels `C01–C04` внутри старого historical script — собственные query identifiers; не путать с новыми findings C01–C03 раздела P.

Обязательный future runbook:

1. Снять свежую production backup и восстановить в isolated environment без исходящих jobs/email/gateway writes; проверить completeness и доступ только назначенным reviewers.
2. Сверить migration history/checksums, применить candidate migrations одним migrator; сохранить duration, lock/WAL/space observations и schema diff.
3. Выполнить все четыре SQL scripts с `psql -X -v ON_ERROR_STOP=1`, read-only session; сохранить counts по каждому query label и ограниченно доступные raw results. Не коммитить identifiers/financial exports в repo.
4. Классифицировать invariant violations отдельно от review candidates; назначить каждому owner и disposition. Legitimate A→B transfer не повод менять historical attribution.
5. Особо R02: missing package не доказывает «benefits никогда не выдавались». Fully consumed consistent package допустим; transfer/mismatch/competing contracts требуют ручной сверки платежей, пакетов и договора. Historical PAID сохраняет 409; auto-grant/auto-confirm не запускать.
6. Сверить in-flight/old SUCCESS/providerRef с provider export; старый SUCCESS не доказательство корректной подписи. Не создавать receipt повторно по совпадению цены.
7. Повторно проверить approved dispositions и получить **business + technical sign-off** с counts, версиями candidate/backup и residual risks. Repairs, если нужны, — отдельное согласованное изменение с тестами, вне этого gate.

Stop rollout: duplicate contracts/providerRefs без безопасного disposition; unverified SUCCESS/необъяснённые финансовые расхождения; missing signature/first receipt у manualConfirmedAt; неверные schedule total/count/order/status; unresolved ambiguous benefits; недоступный current owner/student, неразрешённая privilege inconsistency; отсутствующие/дублированные required manual milestones; migration drift/checksum mismatch, lock/restore rehearsal failure. Mixed currency само по себе допустимо, смешанная неразмеченная сумма — нет. Review-only anomalies не объявляются corruption автоматически, но требуют disposition до go-live затронутого workflow.

## K. Remote CI readiness

**REMOTE CI REQUIRED.** Ни один hosted run/digest/deployment в этом gate не запускался и не объявляется PASS.

Workflow inspection:

- Triggers: PR в `test`/`main`, push в `test`/`main`, workflow_dispatch. PR в main допускается только из test того же repo.
- Quality: Node22, immutable Yarn install, Prisma generate, lint/Jest/build/tsc, PG17/Redis7 healthchecked services, explicit synthetic DB+Redis env, полный runner, deployment Python+реальный mode probe, shell/Compose. Fail-fast runner возвращает nonzero, если suite падает.
- `docker needs: quality`: PR build без публикации/deploy; non-PR ref test — build+publish, immutable digest output.
- `deploy-test needs: docker`, non-PR ref test, environment `test`: **push в текущую test автоматически ведёт к SSH deployment**, затем public health и tested-release artifact. workflow_dispatch на test тоже допускает эту цепочку.
- `deploy-production needs: quality`, push main, environment `production`: выбирает ранее successful Test artifact с идентичным source tree, проверяет актуальность main, продвигает тот же immutable digest. Merchant/frontend/historical acceptance не являются отдельными jobs этой YAML.
- Environment required reviewers/branch protections находятся в GitHub settings и здесь не проверены. Сам `environment:` не доказывает наличие approval gate. Красный/cancelled job не основание для ручного bypass dependencies.

Точный checklist после устранения C01 и согласованного candidate commit:

1. Зафиксировать полный inventory и SHA, повторно проверить diff/secrets. Для quality-only проверки использовать **отдельную candidate branch + PR в test**; bare push произвольной ветки без PR не включает этот workflow.
2. Дождаться green hosted `quality` с полными test/migration/schema/Redis/runtime-probe результатами; сохранить run URL и SHA. При failure/cancelled остановиться, не делать staging/prod actions.
3. Дождаться green Docker build для того же candidate. PR build не публикует deployable image; не называть PR build promotion artifact.
4. До merge/push в test закрыть staging prerequisites и подтвердить deployment approval/maintenance arrangements, поскольку далее deployment автоматический.
5. После разрешённой Test image publication сохранить immutable `ghcr.io/…@sha256:…`, соответствующий commit и CI run, проверить deployed digest. Не использовать mutable `:test` как release identity.
6. Production promotion только после отдельных frontend/staging/historical/merchant sign-offs; successful Test health artifact сам по себе их не заменяет.

Таким образом, сейчас нельзя рекомендовать обычный `git push` текущей ветки test «просто для CI». Проверка protected environments и путь безопасного PR — обязательная operational condition, не выполненное действие.

## L. Staging prerequisites

До deployment на staging:

- Backend: disposition C01–C03, повторный accepted local gate, candidate commit, green remote quality + Docker build, immutable image digest; release-specific installed deployment bundle и проверенная migration history; подготовленный откат/изолированные данные.
- Env: реальный test merchant, **effective mode=1 внутри container**, правильные merchant ID/receiving secret, HTTPS result URL `/api/v1/payment/freedompay-webhook`; отдельные test DB/Redis/storage credentials, корректные CORS/frontend/activation URLs. Значения secrets не публиковать.
- Frontend: готовая версия по I, feature rollout согласован; backend-only healthcheck не означает совместимость старого UI.
- Infrastructure: shared Redis для queues/WebSocket, private contracts bucket без public policy, рабочий SMTP; negative access и recovery scenarios заранее подготовлены.
- Server scripts: обновить установленный `/opt/oxus_backend/deployment/deploy.sh` и server `compose.yaml` из candidate, проверить override/environment. `ssh-deploy.sh` передаёт image/env, **не копирует новые Compose/scripts**; `install-ci.sh` также не обновляет Compose автоматически. Новый backend image один не доставляет R01 wiring на сервер.

Staging acceptance после разрешённого deployment:

| Area | Обязательное доказательство |
|---|---|
| Backend/manual | Реальный браузер: draft/no account → signature/still signing → first receipt/account+benefits → final installment; owner transfer, retries, invalid amount/foreign expert; Swagger `/api` и generated spec |
| FreedomPay | Real test init с pg_request_method=POST; реальный provider POST, raw signed fields, signed XML ACK; duplicate/concurrent/late failed callback; exactly-once effects и providerRef reconciliation. Для manual contract late gateway receipt — ledger-only, без повторных benefits |
| SMTP | Фактическая invitation delivery/activation; temporary SMTP outage, persisted intent/retry после восстановления, без повторной business conversion |
| Object storage | Upload/download PDF/JPEG/PNG через auth, owner/foreign/anonymous matrix; anonymous GET bucket/object denied; oversized/MIME mismatch rejected |
| Redis | Несколько backend instances используют общий Redis; queues работают; reconnect/restart/lost queue recovery, без дублей benefits. In-memory WebSocket fallback не выдавать за healthy multi-instance realtime |
| Frontend | Pagination envelope/total, earnings global totals, null+byCurrency money, stage timestamps/filter counters, manual signing/no OTP, authenticated blob scans |

Все эти live acceptance пункты **REQUIRED / NOT VERIFIED** в данном gate. До staging не требуется выдавать будущий merchant E2E за уже выполненный; нужны configured environment и test plan, сам E2E выполняется после разрешённого deployment.

## M. Runtime configuration

Обе Compose конфигурации отрендерены **только по `.env.example` / `deployment/.env.example`**, без чтения real `.env`. Сверены фактические ConfigService/process.env names в FreedomPay, mail, scan service, AppModule queues, RedisIoAdapter, invitations и main. Sanitized evidence — `/private/tmp/oxus-candidate-config.json`.

| Setting | Local rendered | Server example rendered | Вывод / release condition |
|---|---|---|---|
| NODE_ENV / STAGING | development / absent | production / true | Test требует STAGING=true, production false; deploy preflight проверяет |
| FREEDOM_TESTING_MODE | `0` | `0` | Обе Compose передают явно, blank не заменяется default. Для test merchant обязательно override=1; STAGING не переключает payment mode автоматически |
| FREEDOM_RESULT_URL | `/api/v1/billing/result` на localhost | HTTPS `/api/v1/payment/freedompay-webhook` | **C02 local mismatch**; оба env examples имеют правильный путь, hardcoded local Compose остаётся старым |
| FREEDOM_API_URL / MERCHANT_ID / RECEIVE_SECRET_KEY | Empty | Empty | Template не готов к merchant E2E; receiving secret обязан совпадать с test merchant; payout secret не замена |
| FREEDOM_SUCCESS_URL / FAILURE_URL | Local frontend payment pages | Test public payment pages | Browser redirects отдельно от signed backend callback; проверить actual frontend routes |
| DATABASE_URL | db:5432 / oxusedu | db:5432 / oxusedu, composed from POSTGRES_* | Корректная docker-network цель; actual DB volume/env и URL-safe password требуют проверки; credentials withheld |
| REDIS_URL / HOST / PORT / PASSWORD | Shared redis:6379, default DB0 | Shared redis:6379, default DB0 | Queue и WebSocket используют REDIS_URL; согласовать с actual shared instance, ACL и isolation между environments |
| APP_URL / FRONTEND_URL / EXPERT_DASHBOARD_URL / CORS_ORIGINS | Local ports 4000/3000/3001/3002 | Test host/subdomains | Activation берёт FRONTEND_URL; проверить TLS/CORS/реальные routes, не унаследовать production fallback |
| SMTP_SERVER / PORT / SECURE / SENDER_EMAIL / PASSWORD | Server/password empty | Placeholder host,587,false,password empty | Реальная доставка не проверена; нужны transport credentials/TLS и delivery+recovery smoke |
| AWS_BUCKET_NAME / MINIO_ENDPOINT | uploads / http://minio:9000 | То же | Scan bucket вычисляется `uploads-contracts`; ACL/policy реально private проверить отдельно |
| AWS access/secret keys / public URL | Local-only values | Placeholder keys / test storage URL | Public upload URL не применим к contract scans; bucket credentials/permissions должны быть provisioned |
| JWT / refresh / Jitsi | Local synthetic / local key setup | Placeholders / mounted private key path | Нужны независимые реальные keys; secrets не в image/Git; templates не production-ready |
| BACKEND_IMAGE | Local dev image | Example mutable tag | Deployment принимает immutable digest; example не является выбранным candidate image |

Config render PASS означает валидную Compose структуру, не готовность внешних интеграций. Runtime probe доказал propagation/validation mode в контейнере, но использовал synthetic merchant и mocked HTTP. Deploy preflight принимает 0/1, не связывает автоматически 1 с test/0 с production: effective mode — явный operational gate.

## N. Rollout runbook

Будущий runbook, **не выполнен в этом аудите**:

1. Закрыть candidate findings/gate, зафиксировать commit и immutable image digest, состав deployment bundle.
2. Подтвердить green remote CI для exact candidate и отсутствие failed/cancelled required jobs.
3. Подготовить совместимую frontend версию по I и порядок её включения.
4. Получить staging E2E sign-off: manual flow, merchant, SMTP, storage, Redis/recovery, frontend.
5. Подготовить свежую production backup, checksum, retention и ответственного за restore.
6. Выполнить restore rehearsal, проверить данные и целевой RPO/RTO; `pg_restore --list` в deploy script не заменяет настоящий restore.
7. Восстановить свежую production DB copy, применить migrations, выполнить все четыре audits и schema diff.
8. Разобрать anomaly counts/dispositions, особо R02/provider reconciliation, получить business/technical sign-off.
9. Согласовать maintenance window и freeze; проверить GitHub environment approval, actual server script/config version и effective env.
10. Остановить **всех старых writers**: replicas, workers, scheduled jobs, admin/seed/import scripts; ограничить traffic. Deploy script останавливает свой backend container, не гарантирует остановку внешних writers.
11. Применить migrations одним migrator, сохранить logs и checksums. Не менять уже применённые SQL; не запускать одновременно старое приложение.
12. Проверить schema diff, migration status, контрольные audit counts и отсутствие необъяснимых financial/data changes. При ошибке stop, backend закрыт.
13. Запустить новый backend exact digest; проверить health и effective configuration без раскрытия secrets.
14. Включить подготовленный frontend совместно с backend contract.
15. Выполнить production smoke на согласованных безопасных данных: auth/roles, list/summary/pagination/money, signature/receipt, invitation/scan; не создавать фиктивные реальные платежи.
16. Открыть traffic только после acceptance ответственными.
17. Сверить in-flight gateway callbacks/manual receipts/outbox, provider references, новые benefits, приглашения и scans; повторять только идемпотентные операции.
18. Наблюдать errors/conflicts, callback rejects/retries, duplicate guards, queue lag/outbox, DB locks, memory/latency, payment reconciliation и frontend failures в agreed watch window.

Текущий deploy script не вставляет паузу между успешным migrator и запуском backend. Поэтому rehearsal/sign-off, maintenance traffic gate и необходимые operational проверки должны быть готовы заранее; script health не является автоматическим production business acceptance. При необходимости ручной контрольной точки порядок deployment отдельно согласуется до релиза.

## O. Rollback boundary

| Boundary | Допустимое действие / ограничение |
|---|---|
| До запуска migrations | Возможен restart предыдущего application container; deploy.sh делает это при failure после stop, но до migration_started |
| После additive schema, до business writes | Обычно оставить совместимые columns/tables/indexes; rollback приложения требует отдельной проверки совместимости. Не удалять schema только ради старого image |
| После backfill | Новые persisted facts уже появились; предпочтителен forward fix. Нельзя эвристически удалить «лишние» events без evidence |
| После нового manual workflow | Drafts/installments/manualConfirmedAt и account-after-receipt несовместимы с прежними предположениями; включать старый backend без анализа нельзя |
| После payments/invitations/scans | DB restore не возвращает внешние деньги/письма/активацию/object storage в прежнее состояние; нужны reconciliation, сохранение evidence и отдельный recovery plan |
| Emergency snapshot restore | Только с остановленными writers и принятым RPO; учесть все external effects после backup и провести согласованное восстановление |

`deploy.sh` устанавливает migration_started до запуска migrator; после этого не пытается автоматически оживить старое приложение и не откатывает DB. Migration failure оставляет backend остановленным; health failure требует investigation. Это соответствует границе rollback; противоречия автоматического post-migration rollback не найдено. Скрипт сохраняет previous image/config и production dump, но не доказывает возможность бизнес-отката сам по себе.

## P. New findings

Нумерация относится к этому Final Candidate Gate; C01–C03 ниже не являются историческими SQL query labels. Исправления запрещены scope и не выполнялись.

### C01 — Medium — Unexpected permanent-test failure; release gate blocker

**Evidence:** основной `/private/tmp/oxus-candidate-integration.log:871`: `not ok 7 - saving or reassigning EXPERT preserves profile identity and isActive=true`, `read ECONNRESET`, `TCP.onStreamRead`; `admin-expert-profile.test.ts` suite 10 pass / 1 fail, runner exit1. Test body находится в `test/admin-expert-profile.test.ts:174` и выполняет сохранение EXPERT, смену роли и проверку видимости/сохранности profile. Assertions бизнес-состояния не сообщили mismatch; завершение произошло на transport error.

**Reproduction:** после build на synthetic local PG/Redis запустить неизменённый `node test/run-integration.mjs` с обоими test env. В этом gate получен один сбой. Один полный диагностический повтор на том же коде прошёл 183 formal +11 smoke, включая этот test. Детерминированный trigger и источник reset (HTTP/DB socket/test lifecycle/environment) не установлены; нельзя утверждать, что backend role-change logic сломана или что это уже исправлено.

**Impact:** nondeterministic gate outcome, возможный red hosted CI; основной runner не проверил оставшиеся suites до остановки. Успешный повтор уменьшает вероятность постоянной логической регрессии, но не объясняет failure.

**Release consequence:** блокирует признание текущего candidate готовым по прямому правилу пользователя «любой неожиданный failed/skipped permanent test → candidate не готов». Следующий отдельный scope должен диагностировать C01, зафиксировать evidence/disposition и получить новый accepted gate; не скрывать первоначальный сбой retry-until-green.

### C02 — Medium — Local Compose retains obsolete FreedomPay result URL

**Evidence:** `compose.yaml:51` задаёт `http://localhost:4000/api/v1/billing/result`. `.env.example` и server example исправлены на `/api/v1/payment/freedompay-webhook`; реальный controller и generated OpenAPI содержат только последний callback route. Sanitized `docker compose --env-file .env.example -f compose.yaml config --format json` воспроизводит старое hardcoded значение.

**Reproduction:** отрендерить local Compose по example и сравнить backend.environment.FREEDOM_RESULT_URL с `PaymentController` route. Изменение одноимённой переменной только в `.env` не заменяет hardcoded local YAML value.

**Impact:** local gateway setup после добавления credentials отправит result на отсутствующий endpoint; template-correct `.env` не исправляет local stack. Health/mode probe это не ловят. Это унаследованная несогласованность, newly identified здесь; server Compose читает правильный example path и не имеет именно этого hardcode.

**Release consequence:** блокирует приёмку local Compose gateway E2E до отдельного исправления/явно проверенного override. Сам по себе не доказывает неверный callback URL действующего server deployment; actual HTTPS callback и env обязательны перед staging merchant E2E.

### C03 — Medium — Legacy OTP hashes/expiry exposed through ordinary contract reads

**Evidence:** `src/modules/contract/repository/contract.repository.ts:27` (`findByStudentId`) и `:51` (list) используют `include` без `omit`/explicit scalar select. `ContractService.getMyContract` возвращает ORM object, `ContractController.getMyContract` отдаёт его напрямую. В отличие от этих reads, `manualContractRead` явно исключает четыре OTP fields. Global response sanitizer в main/PrismaService отсутствует.

**Reproduction:** на synthetic local contract внутри откатываемой DB transaction записаны маркеры в studentOtpHash/expertOtpHash и expiry; вызван **реальный compiled `ContractService.getMyContract` с реальным repository/Prisma**, выполнен JSON stringify/parse. Результат содержал оба marker values и все четыре keys: `studentOtpHash`, `studentOtpExpiry`, `expertOtpHash`, `expertOtpExpiry`. Evidence `/private/tmp/oxus-candidate-otp-exposure.json` содержит только key names/booleans; transaction принудительно rollback. HTTP controller возвращает тот же объект; отдельный live HTTP request для этого probe не выполнялся. List/other generic reads имеют тот же источник экспозиции по code review.

**Root cause:** Prisma `include` добавляет relations, но не исключает scalar columns; OpenAPI schemas не фильтруют runtime output. Проблема присутствовала в прежнем generic read path и остаётся в candidate, хотя новый manual read helper redaction выполняет.

**Impact:** авторизованный student получает также expert OTP hash/expiry своего historical contract; разрешённый expert/ADMIN может получать внутренние signing fields через reads. Это unnecessary sensitive-data exposure, не доказанный foreign-contract access или account takeover. Все OTP HTTP routes сейчас заблокированы, поэтому непосредственное использование кода для online signing этим probe не показано.

**Release consequence:** требуется отдельное исправление redaction/response regression перед production acceptance; не полагаться на deprecated OTP или null values новых contracts. Не расширять frontend contract этими fields. Это runtime finding, не основание утверждать, что реальные secrets обнаружены в Git.

## Q. Final verdict

**CANDIDATE NOT READY**

Главный формальный blocker — C01. Диагностический повтор всего набора успешен, source snapshot не менялся, но исходный permanent test failure остаётся необъяснённым. C02/C03 также требуют отдельного disposition; code fixes этим gate не авторизованы. Миграции, build/types/lint/Jest/deployment checks и generated OpenAPI прошли в указанном scope. Secrets/временные artifacts в предполагаемом change set не обнаружены.

| Track | Status |
|---|---|
| Backend candidate | **CANDIDATE NOT READY** — C01; C02/C03 recorded, no fixes |
| Frontend integration | **REQUIRED** — окончательный handoff в I; actual frontend не проверялся |
| Remote CI | **REMOTE CI REQUIRED** |
| Staging | **BLOCKED pending candidate disposition, CI, env/deployment/frontend prerequisites** |
| Historical data | **PRODUCTION-COPY AUDIT + BUSINESS/TECHNICAL SIGN-OFF REQUIRED** |
| FreedomPay merchant E2E | **REQUIRED / NOT RUN** — synthetic protocol tests не live merchant proof |
| Production | **NOT READY** — все внешние gates и findings должны быть закрыты/согласованы |

Ответы на final gate questions:

1. **Можно ли сейчас сделать commit этого рабочего дерева?** Как одобренный release candidate — **нет**. Технический checkpoint commit возможен отдельно, но этот аудит не выдаёт candidate acceptance. Commit/push в рамках задания не выполнялись.
2. **Какие файлы должны войти?** Все 95 M/U paths из inventory A + `deployment/final-candidate-gate.md` (96 файлов), после закрытия gate с учётом последующих согласованных fixes. Включить все три новых migrations, helpers, tests/runner, CI, templates/deployment probes, audit SQL и phase reports; не коммитить только tracked diff без untracked dependencies.
3. **Что нельзя коммитить?** Real `.env`/private keys/credentials, ignored build/dependency/cache/OS output, локальные Postman/data exports и `/private/tmp`/generated OpenAPI/logs. Полный перечень exclusions — A. Среди 95 intended paths accidental artifacts не найдено.
4. **Можно ли после commit делать push и запускать remote CI?** Для диагностического CI можно использовать отдельную candidate branch + PR в test с явно failed локальным gate; это не promotion approval. Для принятого candidate — после C01 disposition и повторного gate. **Не обычный push текущей test:** он включает auto-deploy; до него обязательны staging prerequisites/approval arrangement. Push/main также не quality-only.
5. **Что обязательно до staging?** Candidate disposition (C01–C03), accepted gate/commit, remote quality/build, immutable digest, установленный актуальный deployment bundle, изолированные DB/Redis/storage, mode1 test merchant/receiving secret/HTTPS callback, SMTP/CORS/activation env, подготовленный совместимый frontend и E2E plan. Реальная staging acceptance выполняется затем по L.
6. **Что обязательно до production?** Green staging manual+merchant+SMTP+storage+Redis+frontend E2E, reviewed production-copy audits/counts и R02 dispositions, migration/checksum/restore rehearsal, свежая backup, business/technical release sign-off, exact tested image+frontend, production env/mode0, freeze всех writers/single migrator, smoke/reconciliation/monitoring и согласованная rollback boundary.

Gate изменяет только этот отчёт. Production code, tests, migrations, CI, OpenAPI source и deployment scripts сохранены. Commit, push, real deployment, production-data mutation и real merchant calls не выполнялись. Два использованных локальных test containers возвращены в исходное остановленное состояние. Итоговая сверка сохранена в `/private/tmp/oxus-candidate-final-integrity.json`.
