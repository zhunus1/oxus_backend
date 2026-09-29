# Candidate commit report — 2026-09-29

## Git strategy

Один **atomic candidate commit**: schema, migrations, production code, tests, CI/deployment и OpenAPI взаимосвязаны. Разделение по историческим фазам создало бы неподтверждённые промежуточные snapshots. Проверенные 101 candidate paths включены вместе.

Этот запрошенный post-commit отчёт добавляется отдельным **docs-only commit**, поскольку он фиксирует hash уже созданного candidate. Это единственное дополнение к verified inventory: 101 проверенный path + 1 отчёт. Код, API, tests, migration SQL и прежние reports не изменяются.

## Commit(s)

- Candidate: `fde280652f1b12a76183c62aa6d19847083cd2ca` — `feat(contracts): complete manual contract workflow and release hardening`.
- Docs-only record: `docs(release): record candidate commit integrity and PR plan`. Hash самого содержащего отчёт commit не встраивается в собственное содержимое; его можно получить через `git log -1 --format=%H -- deployment/candidate-commit-report.md`, и он приводится в итоговом ответе.

Candidate parent: `3b593656640f10faad792611b41e45b81dca1662`. Historical commits не amended/squashed. Локальная branch `test` сохраняет исходный HEAD.

## Candidate integrity

- Исходный full inventory подтверждён: **101 path** (51 modified + 50 untracked), index до staging пуст; неожиданных files/content changes нет.
- Staging выполнен по явному NUL-separated path list, без `git add .`/`-f`.
- Все **635 staged blobs и затем candidate commit blobs** совпали с accepted snapshot по SHA-256; commit modes совпали с index. Changed paths candidate commit — ровно 101, без пропусков untracked dependencies.
- Gate candidate fingerprint: `62abb4122cd7f28b0b6683bf6c053e4ce202e067e7dee9edda28c2128234f57e`.
- Candidate Git tree: `0bdf1d767919fd35d559549d56d5600022ba6fe0`.
- Canonical full file-tree SHA-256 (`path<TAB>SHA256(file-bytes)` + LF, sorted): `167578492f6f7b3a069b15fcc5bdc04a47173ea2a03bb76e38bdece1ab5670fe`.
- Все 3 новые migrations, domain helpers, integration runner, CI, deployment probes, OpenAPI schemas/tests, C01–C03 fixes и final reports присутствуют. Все 42 migration hashes сохранены.
- `git diff --cached --check`, staged secret/artifact scan, merge-marker scan и проверка добавленного production debug logging прошли. Candidate working tree после первого commit был clean.
- Полный gate не повторялся: доказано совпадение staged/committed bytes с snapshot, где прошли **483 formal + 11 smoke, 0 failed/skipped**.

После docs-only commit HEAD будет отличаться от verified candidate **только этим отчётом**. Это явно разрешённое дополнение, а не изменение проверенного application snapshot. Перед push сравнивается весь HEAD tree с candidate + report, включая hashes/modes и отсутствие иных изменений. Local evidence: `/private/tmp/oxus-commit-staged-integrity.json`, `oxus-commit-post-commit.json`, `oxus-commit-final-integrity.json`.

## Exclusions

Не включены real `.env`/credentials/private keys, DB dumps/backups/exports, logs, `dist`, `node_modules`, generated Prisma client, caches/coverage/`.DS_Store`, `/private/tmp` diagnostics и generated temporary OpenAPI JSON. Env example templates включены как часть проверенного candidate. Ignored files принудительно не добавлялись.

## Branch

`release/manual-contract-candidate`, создана от исходного `test` HEAD с сохранением accumulated working tree. Remote `test` перед подготовкой совпадал с исходным HEAD; выбранной remote candidate branch не существовало. Прямой push в `test` не выполняется.

## PR

Title: **Manual contract workflow and backend release hardening**.

Head: `release/manual-contract-candidate`; base: `test`. Draft PR для remote CI/review, без auto-merge. Ниже точное подготовленное описание PR:

---

### Summary

Move lead conversion to manual contract confirmation with a verified first receipt, and harden the related payment, access, reporting and release paths. The atomic candidate commit contains the complete 101-path snapshot accepted by the local candidate gate; a separate documentation commit records Git preparation without changing tested code.

### Business flow

- Preparing a contract creates a draft (`contract: null`) without a student account, invitation, payment or benefits.
- The expert records the paper signature. Signature alone keeps the lead awaiting confirmation.
- Confirming the first receipt atomically creates or explicitly reuses the student account, creates the contract and schedule, assigns benefits and converts the lead.
- FULL payment makes the contract `PAID`. INSTALLMENT remains `SIGNED` until the final scheduled receipt; monthly dates are anchored to the first payment.
- Preserve separate parent/student identity and provide protected contract scan upload/download. Concurrent confirmations and repeats do not duplicate accounts, contracts or benefits.

### Security

- Verify FreedomPay signatures over raw callback fields and enforce merchant, mode, amount, currency and captured-success context.
- Apply settlement and benefits once, including concurrent duplicate callbacks and reused provider references.
- Enforce contract ownership, current-owner transfer rules, permissions and student/contract uniqueness across HTTP and direct service paths.
- Reject FREE commercial terms and fail closed when historical SIGNED benefits require operator review.
- Omit internal OTP hash/expiry fields from public Contract responses while preserving the narrow internal legacy verifier. Online OTP signing routes remain disabled.

### Reporting/API

- Keep finance totals currency-aware; mixed-currency scalar totals can be null and expose per-currency totals.
- Use business `occurredAt` for payment/signature milestones and align cohorts, SCHOOLBOY visibility, lost-lead accounting and summary/list filters.
- Bound and paginate contract lists and expert earnings while retaining complete totals.
- Update OpenAPI contracts and align Compose FreedomPay callback configuration with the actual POST route.

### Database

Three new migrations, with historical migration SQL unchanged:

- `20260928130000_manual_contracts`
- `20260928150000_journey_occurred_at`
- `20260928151000_backfill_manual_journey`

Clean deploy and schema diff passed. All 42 applied migration checksums matched the SQL and accepted snapshot. Historical audit SQL is included; production-copy review and R02 dispositions remain required before rollout.

### Tests

- **483 unique formal tests:** 270 Jest, 191 integration, 22 deployment.
- **11 smoke scenarios; 0 failed / 0 skipped.**
- Three consecutive integration runs after the HTTP-listener fix, followed by another complete run in the final candidate gate.
- Build, TypeScript, ESLint, generated OpenAPI, clean migrations, schema diff, checksum verification, Compose and shell validation passed.
- Staged and committed bytes match the verified candidate snapshot; no full test rerun was needed for Git preparation. The additional commit report is documentation only.

[Final candidate gate](https://github.com/zhunus1/oxus_backend/blob/fde280652f1b12a76183c62aa6d19847083cd2ca/deployment/final-candidate-gate-repeat.md)

### Breaking frontend changes

Coordinate the compatible frontend before staging:

- Handle `contract: null` during draft preparation.
- Replace OTP signing actions with manual signature and first-receipt confirmation.
- Consume paginated `/contracts` and paginated expert earnings responses.
- Handle nullable mixed-currency finance totals and per-currency values.
- Remove assumptions about public OTP fields or working online-signing routes.
- Download private contract scans through the authenticated endpoint rather than a public object URL.

### Release conditions

**REMOTE CI REQUIRED.** This PR targets `test`: quality and Docker build may run, while image publication and test deployment are disabled for `pull_request` events. Do not merge or push directly to `test` as a CI-only step.

Before staging/production acceptance: compatible frontend, successful remote CI and immutable image digest; real test-merchant E2E; SMTP, object storage and Redis/multi-instance checks; production-copy historical audit and R02 manual dispositions; restore rehearsal, backup and business/technical sign-off. Local candidate readiness is not production readiness.

---

## Remote CI

Workflow проверен: candidate branch push не соответствует `push.branches: [test, main]`; PR в `test` запускает quality и Docker build. Для `pull_request` image push и `deploy-test` выключены условием `github.event_name != 'pull_request'`. Direct push в `test` запускает deployment chain и здесь не используется.

План публикации: push только `refs/heads/release/manual-contract-candidate`, затем draft PR → `test`. Итоговый URL PR и фактический remote CI status приводятся в итоговом ответе; этот отчёт не утверждает заранее успешное выполнение remote CI. **REMOTE CI REQUIRED**. Environment, merge и deployment не изменяются/не запускаются.

## Next gate

После green remote CI проверить результаты quality/image build для точного PR HEAD и провести review совместимого frontend/API и release changes. Переход к merge в `test` отдельно согласуется как deployment-triggering действие, с готовыми staging env/deployment bundle/test merchant, SMTP/storage/Redis и E2E plan. Production требует staging acceptance, immutable tested image, historical/R02 dispositions, migration/checksum/restore rehearsal/backup и business/technical sign-off.
