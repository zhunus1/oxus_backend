# Document Storage Recovery — observation-only operational runbook

Дата: 2026-10-10. Baseline `d1ab3bed7f8d058e839d1036a59f83a5f74d402b`.
Phase 2B-3B реализует **read-only observation**, классификацию и метрики. Automatic cleanup отсутствует. Полный destructive recovery protocol имеет статус **NOT APPROVED**: [validation / U1/U2/G1](student-documents-phase2b3-fencing-validation-report.md), [design proposal](student-documents-phase2b3-recovery-design-proposal.md). Proposed SQL functions/triggers/indexes не установлены. Этот runbook не разрешает подключения или изменения Production/Test.

Рабочая реализация: [observer](../src/modules/document/observation/document-observation.service.ts), [read-only repository](../src/modules/document/observation/document-observation.repository.ts), [CLI](../test/document-observation-cli.mjs). Existing [synchronous compensation](../src/modules/document/service/document-storage-recovery.service.ts) сохранён; новые worker/CLI его не вызывают. Не импортировать AppModule для ручной диагностики: existing [MinioService lifecycle](../src/common/utils/minio/minio.service.ts) может инициализировать public bucket.

## 1. Реально работающие команды

Из корня проекта, только с заранее проверенной disposable локальной PostgreSQL DB:

```sh
yarn build
yarn documents:observe --database-env OBSERVATION_DATABASE_URL --limit 10 --dry-run
```

Владелец fixture заранее устанавливает `OBSERVATION_DATABASE_URL`. Не выводить URL/credentials и не загружать реальный `.env`. CLI требует явное имя environment variable; implicit `DATABASE_URL` не используется. Разрешены только `postgres:`/`postgresql:`, literal `127.0.0.1`/`localhost`, имя DB `[A-Za-z0-9_]+_test`, без query parameters/fragment. Если port отсутствует, используется 5432, а не inherited PGPORT. Проверить принадлежность DB: локальный tunnel/proxy сам по себе не доказывает локальность инфраструктуры.

Реальные flags: `--database-env NAME` (обязательный), `--limit 1..100` (default 10), `--dry-run`, `--help`. Обычный запуск тоже read-only; dry-run не меняет поведение. `--apply` и `reconcile --apply` отсутствуют и отвергаются. Docker для диагностики уже доступной разрешённой DB не требуется. Build обязателен до CLI: он загружает только compiled classifier/config/repository/service, без AppModule, Prisma config, MinIO или bucket helpers.

Output: JSON с `mode`, `readOnly`, `limit`, `observed`, глобальным `summary` и batch `categories`. Нет raw journal, IDs, cursor, key, operationId, owner metadata или credentials. Exit 0 — полный successful observation; exit 1 — неправильные аргументы, недоступный build/DB или query failure, с одинаковым безопасным сообщением. Connection timeout 2 s, server statement/lock timeout 2 s, client query timeout 2.5 s. Это bounds на отдельные операции, не общий CLI deadline.

CLI каждый раз классифицирует первую bounded страницу; `summary` относится ко всему technical journal. Для продвижения по всем страницам используется worker. CLI не предоставляет per-intent investigation или repair.

## 2. Включить / выключить worker

Worker **disabled by default**. Настройки читаются при создании Nest module; изменение environment требует контролируемого перезапуска соответствующего процесса. Никаких HTTP enable/disable endpoints нет.

| Config key | Default для local testing | Допустимо |
| --- | ---: | --- |
| `DOCUMENT_OBSERVATION_ENABLED` | `false` | literal `true` / `false` |
| `DOCUMENT_OBSERVATION_BATCH_SIZE` | 10 | integer 1–100 |
| `DOCUMENT_OBSERVATION_CONCURRENCY` | 1 | integer 1–4 |
| `DOCUMENT_OBSERVATION_INTERVAL_MS` | 60000 | integer 1000–3600000 |
| `DOCUMENT_OBSERVATION_QUERY_TIMEOUT_MS` | 2000 | integer 100–10000 |
| `DOCUMENT_OBSERVATION_STALE_AFTER_MS` | 300000 | integer 1000–86400000 |

Enabled worker использует configured application `DATABASE_URL`. Нельзя подменять его непроверенным target. В локальном стенде сначала подтвердить принадлежность disposable DB и безопасный application environment; полный AppModule имеет другие lifecycle side effects, поэтому для диагностики предпочтителен CLI.

Для включения на разрешённом local instance: `DOCUMENT_OBSERVATION_ENABLED=true`; для выключения: `false`, затем обычный контролируемый restart этого instance. Для реальных серверов это отдельное согласованное operational действие, здесь не выполнялось. Значения 10/1/60 s — стартовые local values, не измеренные production defaults.

Nest scheduler проверяет due time каждую секунду. За due tick — один batch, без drain loop и без process overlap. При shutdown новые ticks отвергаются, текущие reference lanes завершаются, затем закрывается отдельный pg pool. Bootstrap включает Nest shutdown hooks. Timeout каждой DB операции ограничен; total drain time не равен одному query timeout. Не останавливать чужие Bull/Contract/Lead jobs.

## 3. Backlog и классификация

Journal root state и диагностическая category — разные понятия. Рассматриваются `DOCUMENT_STORAGE_PENDING` в обоих namespaces `DocumentStorageIntent` и historical `StudentPortrait`. Все references проверяются по `Document.fileKey`, включая soft-deleted/archived, несколько записей и другие portraits. `fileKey=NULL` не превращает legacy `fileUrl` в private object reference.

| Условия наблюдения | Category | Реакция |
| --- | --- | --- |
| Invalid envelope/JSON/typed fields/unknown state | `MALFORMED_INTENT` | Investigate producer/data; сохранить rows/bytes |
| Foreign portrait reference; CLEANED с ref; existing fence/manualReason | `MANUAL_REVIEW_REQUIRED` | Authorised manual investigation |
| COMMITTED с допустимыми refs | `COMMITTED_REFERENCED` | Preserve, наблюдать |
| PENDING / ROLLED_BACK с допустимыми refs | `REFERENCED_OBJECT` | Preserve, investigate journal mismatch |
| COMMITTED без refs | `COMMITTED_MISSING_REFERENCE` | Investigate; отсутствие refs не proof |
| CLEANED без refs | `CLEANED_TERMINAL` | Только journal diagnosis, object existence неизвестно |
| ROLLED_BACK без refs | `ROLLED_BACK_UNRESOLVED` | Preserve/manual; автоматического delete нет |
| PENDING без refs, младше stale threshold | `IN_FLIGHT_OR_UNKNOWN` | Наблюдать; завершение upload неизвестно |
| PENDING без refs, на/после threshold | `UNRESOLVED_PENDING` | Investigate; age не разрешает delete |

`summary.unresolved` включает все PENDING/ROLLED_BACK, malformed, COMMITTED без refs, CLEANED с refs, foreign references и existing fence/manualReason. Это широкая operational очередь внимания; young PENDING также входят. `pending`/`rolledBack` — raw root-state counts, включая malformed rows с таким state. `referenced` — число intents с любыми DB references, включая malformed и archived. Это не число уникальных объектов.

Возраст вычисляется по PostgreSQL clock и UTC semantics существующей `createdAt` timestamp column. Infinite/invalid createdAt — malformed; infinite date не увеличивает возраст до Infinity. Summary читается в одном repeatable-read snapshot; candidate page и reference lanes имеют последующие snapshots. Между ними возможны изменения. Наблюдение не является atomic authorization или durable proof.

## 4. Метрики и alert interpretation

Используется existing Prometheus registry/endpoint: configured `/metrics`, с текущим global API prefix — `/api/v1/metrics`. Новый recovery endpoint не создаётся. Все новые metrics имеют prefix `document_storage_observation_`:

| Suffix | Meaning |
| --- | --- |
| `pending_intents` | DB PENDING snapshot |
| `rolled_back_intents` | DB ROLLED_BACK snapshot |
| `unresolved_intents` | DB очередь внимания, определение выше |
| `oldest_unresolved_seconds` | Возраст oldest finite unresolved row |
| `malformed_intents` | Invalid/unknown intent count |
| `referenced_intents` | Intents с any Document refs |
| `observed_total{category}` | Process-local repeated classifications |
| `errors_total` | Failed complete cycles; без arbitrary error label |
| `batch_seconds` | Histogram длительности полного cycle |
| `last_success_timestamp_seconds` | Время последнего complete success; 0 до первого success |

Category label имеет только девять значений таблицы; histogram `le` фиксирован. Existing registry label `app` сохраняется. IDs/keys/emails/filenames не используются в labels.

До первого success/при disabled worker gauges не представляют измеренный backlog. После outage остаётся последний successful snapshot; смотреть `last_success_timestamp_seconds` вместе с gauges. Failed cycle не публикует partial gauges и не продвигает cursor.

Примеры PromQL для already configured scrape:

```promql
max(document_storage_observation_unresolved_intents)
max(document_storage_observation_oldest_unresolved_seconds)
rate(document_storage_observation_errors_total[5m])
time() - document_storage_observation_last_success_timestamp_seconds
```

Alert thresholds и scrape/network access согласуются отдельно на actual environment. Проверять freshness каждого enabled instance; disabled instance с 0 не должен создавать outage alert. Не складывать backlog gauges разных instances как независимые intents. Не интерпретировать observed counter как recovered/cleaned/unique operations.

## 5. Pagination, нагрузка и несколько instances

Локальный keyset cursor `(afterId, throughId)` фиксирует верхнюю границу sweep, сортировка `id ASC`, `LIMIT batch`. Malformed rows тоже продвигают cursor. Новые ID выше high-watermark читаются на следующем sweep. Ранее выделенный ID, committed после чтения его диапазона, тоже может ждать следующего sweep. Короткая/пустая page сбрасывает cursor; exact full last page требует ещё одного tick. Restart начинает sweep заново, не меняя journal.

Candidate memory ограничена batch и bounded JSON projection; unknown extra payloads и текст manualReason не возвращаются. Reference queries пакетные, максимум concurrency lanes, без per-row query. Separate lazy pool имеет max=concurrency. Disabled worker не открывает connections.

Global summary каждый cycle сканирует весь journal и группирует Document keys; batch limit не ограничивает число DB rows в этих aggregates. Фактическая схема не имеет нужных technical/fileKey indexes. Statement timeout ограничивает отдельный query; при превышении gauges становятся stale и растёт errors counter. Объём работы растёт с DB size; оценивать actual plans, throughput и sweep time перед enable. Возможные минимальные indexes требуют отдельного schema approval.

Multiple instances могут читать одинаковые rows; mutations нет, поэтому Redis lease/leader election не нужен для data safety. Each instance имеет собственные cursor/counters/last snapshot. Минимальная operational стратегия — включить observer на одном выбранном instance, остальные оставить disabled, если нужна меньшая DB нагрузка. При нескольких enabled instances допускаются repeated observations/logs/counters и разная snapshot freshness; gauges агрегировать как observations одного backlog, не суммировать.

## 6. DB outage / рост unresolved

При connect/query failure worker прекращает текущий cycle, ждёт следующий interval, увеличивает errors, выводит только generic warning. Raw pg/Prisma error, SQL parameters и target не печатаются. Failed connection уничтожается, aborted transaction не возвращается в pool. Успешные lanes дождутся завершения перед выходом/закрытием.

Проверить approved DB availability/connection budget, timeout и freshness; затем повторить CLI на разрешённом disposable стенде. Не увеличивать timeout/concurrency автоматически для сокрытия overload. При росте unresolved выяснить producer/transaction outcome, ошибки existing synchronous compensation, изменения refs и скорость полного sweep. Сохранять evidence и bytes. Уменьшение backlog ручным UPDATE/CLEANED/DELETE journal запрещено.

## 7. Manual investigation и неизвестные outcomes

Authorised incident owner проверяет полную identity только в закрытом approved инструменте: namespace/action, journal/operation/key/portrait, producer version, exact snapshot, все active/archived refs, реальные upload/COMMIT/Delete outcomes. Aggregate CLI не раскрывает identity и не заменяет это investigation. Не помещать персональные значения в metrics, общий stdout/logs/tickets.

Если outer DB transaction вернул connection error после callback, rollback не доказан. COMMITTED/reference — preserve; PENDING/no refs — тоже preserve до независимого доказательства. Lost Put acknowledgement или поздний remote send остаются unknown. Не вызывать `compensation(true)` с вручную придуманным proof. Смена journal state не отменяет поздний Put/COMMIT.

Existing fence/manualReason, malformed/foreign refs, COMMITTED missing reference, CLEANED with reference или persistently stale PENDING/ROLLED_BACK требуют manual attention. Когда outcome доказать нельзя — оставить unresolved; safe manual mutation tool не реализован.

## 8. MinIO и запрещённые операции

Observer/CLI **не выполняют HEAD/GET/Put/Copy/Delete**, не создают bucket, не меняют policy/ACL и не импортируют SDK/storage services. DB-only подход достаточен для минимальной безопасной classification. Поэтому MinIO outage не превращается в ложный diagnostic «object missing». Object existence/bytes этим monitoring не установлены.

Возраст, отсутствие Document reference и HEAD404 никогда не дают authorization на delete. HTTP abort и SDK maxAttempts=1 не доказывают завершение всех remote writes. `CLEANED_TERMINAL` — state в journal, а не fresh подтверждение отсутствия object.

Запрещены автоматические state transitions, CLEANED/deleteFenced/grants, AuditLog pruning, key/operation/portrait rewrite, bucket policy mutation, arbitrary fileUrl access, prefix/age purge и обход U1/U2/G1. Existing synchronous compensation не расширялся и не считается новым universal destructive recovery protocol.

## 9. Proposed future destructive recovery — не рабочие команды

[Design proposal](student-documents-phase2b3-recovery-design-proposal.md) и [98 design probes / NOT APPROVED](student-documents-phase2b3-fencing-validation-report.md) сохранены как architecture evidence. Исправленный DB reference/tombstone subcomponent не утверждает весь protocol.

До отдельного implementation gate нужны решения: U1 single producer/per-key upload permit/durable wire outcome; U2 consumed PENDING reservation retention и защита от journal/key reuse; G1 paused/stale process, который может send после DB authorization. Нужны approved exact producer/retention/dispatch semantics, роли/DDL privileges, lifecycle/crash/concurrency evidence, schema/index approval, independent review, rollout/retention/client/infrastructure gates.

Будущие claim, fence, terminal proof, CAS, permanent tombstone и manual-after-unknown-delete — предложения, не установленная инфраструктура. Не запускать proposed SQL artifacts на actual DB. После eventual destructive grant нельзя удалять fence/tombstone, повторять unknown Delete или возвращать mixed-version unfenced writer. Code rollback не отменяет отправленный request. На текущем observation-only этапе новых grants/guards нет; отключение observer меняет только monitoring.

## 10. Проверки на disposable local infrastructure

Реальные package commands:

```sh
yarn test:documents-observation
yarn test:integration
yarn test:documents-private-api
yarn test:documents-storage
```

Observation runner требует подтверждённую disposable loopback `DATABASE_URL`, создаёт собственную UUID `_test` DB, применяет existing migrations и удаляет только созданную им DB. Standard runner также требует disposable Redis URL и содержит новые observation/CLI gates. Эти test runners создают synthetic fixtures; runtime observer/CLI их не создают. Все новые unit/PG/CLI tests входят в mandatory CI.

Private API/foundation runners дополнительно используют Docker и owned MinIO fixtures. Перед запуском подтвердить Docker daemon locality, context/DOCKER_HOST и ownership. **Существующий Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки**: loopback publish не доказывает daemon locality (F-2B1-04). F-2B1-03 cold CI/resources/unpinned/deadlines остаётся отдельным infrastructure risk. Warm local success не закрывает hosted cold CI gate.

Результаты текущего этапа, performance и release gates: [observation report](student-documents-phase2b3-observation-report.md). Backend commit readiness и Production readiness оцениваются отдельно; automatic cleanup остаётся NOT APPROVED.
