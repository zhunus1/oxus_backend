# Phase 2B-1 — Targeted Remediation Report

Дата: 2026-10-09, Asia/Almaty. Baseline HEAD: `ed29cc84ac01ce6bb04e2b6aafd543623d7e7650`.

Release gate: **PASS WITH NOTES**. F-2B1-01/F-2B1-02 закрыты; все обязательные regression gates прошли. F-2B1-03/F-2B1-04 остаются открытыми инфраструктурными рисками.

Исходные требования и findings: [implementation report](student-documents-phase2b1-storage-report.md), [independent final review](student-documents-phase2b1-final-review.md). Исправлены только F-2B1-01 и F-2B1-02; F-2B1-03/F-2B1-04 сохранены как отдельные инфраструктурные риски.

## 1. Root causes

**F-2B1-01 — PDF magic bytes.** `Buffer.toString("ascii")` сбрасывает старший бит каждого исходного байта. Поэтому regex header принимал `%PDF-` и version/newline bytes с установленным high bit как ожидаемые ASCII bytes. Это дефект сравнения сигнатуры, независимый от отсутствия полноценного PDF parser.

**F-2B1-02 — Content-Length.** Проверка `!ContentLength` вместе с верхней границей отвергала zero/undefined/NaN и oversized/positive Infinity, но принимала отрицательные и дробные числа, включая negative Infinity. Эти значения попадали в возвращаемые metadata и позволяли начать piping.

До изменения production code новые unit tests дали ожидаемый RED: **12 failed, 66 passed, 78 total**. Девять failures — high-bit mutations каждой позиции девятибайтового PDF header; ещё три — Content-Length `-1`, `-Infinity`, `1.5`. После исправления все 78 storage tests прошли.

## 2. Минимальные изменения

| Файл | Изменение относительно состояния в начале remediation |
| --- | --- |
| [student-document-file.ts](../src/common/utils/minio/student-document-file.ts#L62) | PDF header декодируется через `latin1`, сохраняющий каждый байт один-к-одному. Существующий regex требует точного `%PDF-`, разрешённой версии и CR/LF; high-bit bytes больше не совпадают с ожидаемыми символами |
| [student-document-storage.service.ts](../src/common/utils/minio/student-document-storage.service.ts#L131) | До создания PassThrough проверяются тип number, `Number.isSafeInteger(size)`, `size > 0`, `size <= 10 * 1024 * 1024`. Возвращается это же проверенное значение |
| [student-document-storage.service.spec.ts](../src/common/utils/minio/student-document-storage.service.spec.ts) | Добавлены 27 targeted regression tests, без переписывания существующих проверок |
| Этот отчёт | Результаты remediation и оставшиеся риски |

PDF parser не добавлялся. Regex поддерживаемых версий, EOF check в последних 1024 bytes, MIME checks, size limits, PNG/JPEG validation и error responses сохранены. Существующий stream lifecycle и `pipe` не менялись.

Snapshot 654 source/config/report files до remediation подтвердил изменения только трёх перечисленных TS files; отчёт добавлен отдельно. Prisma schema/migrations, DocumentController/DocumentService, authorization, public UploadService, ContractScanService, deployment, bucket configuration, Dockerfile/runner/workflow и package scripts remediation не меняла. Исторические отчёты сохранены.

## 3. Новые regression tests

**PDF: 14 новых cases.** Девять независимых high-bit mutations по позициям `%PDF-`, version `1.4` и LF из настоящего blank PDF fixture. Первые пять cases отдельно покрывают каждый байт `%PDF-`. Все остальные bytes и правильный EOF в этих cases сохранены, поэтому rejection проверяет именно header. Ещё три cases принимают поддерживаемые headers `%PDF-1.0\n`, `%PDF-1.7\r\n`, `%PDF-2.0\n`; два отвергают missing EOF и non-whitespace data после EOF. Проверки здесь остаются структурными и не заявляют полной валидности PDF объектов/xref.

Повторно прошли существующие корректные PDF/JPEG/PNG fixtures, exact 10 MiB acceptance, zero/oversized rejection, reported size mismatch, MIME mismatch, truncated files, multiple files, inaccessible buffer и safe validation errors.

**Streaming: 13 новых cases.** Девять invalid Content-Length cases: `-1`, `-Infinity`, `1.5`, `NaN`, `Infinity`, `0`, `undefined`, `10 MiB + 1`, `Number.MAX_SAFE_INTEGER + 1`. Каждый проверяет generic 503, отсутствие read/pipe, уничтожение и close upstream. Два positive boundary cases принимают `1` и ровно `10 MiB`, проверяют metadata, полное побайтное чтение, normal end и освобождение upstream. Ещё два cases проверяют backpressure без consumer и sanitized premature upstream close. Существующие cancellation и asynchronous SDK stream-error tests также прошли.

## 4. Streaming resource cleanup

Upstream Readable присваивается `body` до metadata validation. При недействительной длине код переходит в существующий catch с `body.destroy()`; PassThrough ещё не создан, `body.pipe()` и чтение bytes не начаты. Unit tests дожидаются `close`, проверяют `destroyed`/`closed` и нулевые read/pipe calls. Наружу выходит `ServiceUnavailableException("Document storage is unavailable")`; internal metadata error и SDK details не возвращаются и не логируются.

При корректной длине остаются прежние `Readable.pipe(PassThrough)` и backpressure. Тест без consumer подтверждает, что upstream останавливается до полного чтения 10 MiB. Consumer cancellation уничтожает upstream; asynchronous errors и premature close возвращают safe stream error; normal completion сохраняет bytes. На настоящем MinIO повторно прошёл cancellation test с 10 MiB object.

## 5. Real MinIO

**PASS: 20/20 real MinIO tests**, fail/skipped/cancelled/todo = 0. Выполнен штатный `npm run test:documents-storage`: Nest build, **11/11** offline runner probes, затем real MinIO suite.

Использован настоящий local MinIO из уже предусмотренного test Dockerfile: source `RELEASE.2025-10-15T17-29-55Z`, archive SHA-256 `be6d0bd3696c3a13a35f02d3a0280b64319c67918b4501c5c3d87f96d000085c`. Source/Go build layers были cached; этот прогон не доказывает cold hosted CI budget. Runtime suite заняла около 1.25 s без build/start overhead.

Проверены private bucket creation, concurrent creation/upload, PDF/JPEG/PNG upload и byte integrity, anonymous denial, invalid input, conditional writes, missing object, delete/idempotency и namespace isolation, public-policy canary, unsupported public ACL, synthetic invalid credentials, streaming cancellation, совместимость public UploadService и отдельного contract bucket. Malformed Content-Length проверяется unit SDK responses; настоящий MinIO отдавал нормальные integer metadata.

До запуска проверены actual Docker context `desktop-linux` и endpoint `unix:///Users/johnycarlson/.docker/run/docker.sock`. Runner создал собственный UUID-labelled container с synthetic credentials, dynamic loopback port и tmpfs data. Production/Test и удалённый Docker daemon не использовались. После package run и при финальной проверке containers с label `oxus.storage-test-owner` отсутствовали.

## 6. Общие результаты

| Gate | Результат |
| --- | --- |
| Targeted storage validation + streaming metadata + existing ContractScan Jest | PASS: **83 = 78 storage + 5 contract tests** |
| Full Jest | PASS: **47 suites, 490 tests** |
| Real MinIO | PASS: **20 tests** |
| Storage runner probes | PASS: **11 tests** |
| `npm run test:documents-storage` | PASS, exit 0; включает Nest build и оба storage gates |
| Штатный `npm run test:integration` | PASS: **348 tests**, 22 TAP files + один plain smoke script, exit 0 |
| Prisma validate | PASS с synthetic local DATABASE_URL и project dotenv disabled |
| Nest build | PASS через обязательный первый шаг storage package |
| TypeScript `--noEmit` | PASS |
| Штатный TS ESLint, без fix | PASS |
| `lint:documents-storage-runner`, включая MJS runner/tests/config | PASS |
| Prettier check трёх изменённых TS files | PASS |
| `git diff --check` | PASS |
| HEAD / Git index / remediation scope | HEAD baseline совпадает, index пустой, изменены только целевые TS files и добавлен отчёт |

**869 уникальных framework tests = 490 Jest + 348 standard integration + 20 real MinIO + 11 runner probes.** Targeted runs, package repeats и plain smoke scenarios повторно не прибавляются к unique count. Новый test count отличается от исходного review на 27 добавленных unit cases.

Standard runner использовал только новые owned PostgreSQL 17 и Redis 7 containers на dynamic localhost ports; для каждой suite создавались отдельные disposable databases. После успешного runner SQL подтвердил только bootstrap `oxus_storage_remediation_test` и `postgres`, без оставшихся suite databases; bootstrap public schema содержала 0 tables. Ownership label обоих containers проверен, затем они удалены по exact IDs с их anonymous volumes. Финальные label checks подтвердили отсутствие оставшихся remediation/MinIO containers. Global prune, existing containers/volumes и server data не затрагивались.

Логи: `/private/tmp/oxus-phase2b1-remediation-{red,targeted,jest,minio-package,integration,validate,typescript,lint,mjs-lint}.txt`. Baseline source hashes: `/private/tmp/oxus-phase2b1-remediation-baseline.json`. Это временные локальные evidence artifacts.

## 7. Оставшиеся инфраструктурные риски

**F-2B1-03 — CI reproducibility/resource budget, P2, OPEN.** Source archive checksum проверяется, но base-image tags не pinned по digest; hosted runner cold build/network/Go dependency budget здесь не подтверждён. Не добавлялись build cache, per-command deadlines, container CPU/memory limits или bounded tmpfs size. Общий CI timeout не заменяет эти ограничения; SIGKILL/host/daemon failure может оставить ресурсы. Passing warm run не закрывает finding. Это отдельный infrastructure follow-up.

**F-2B1-04 — Docker locality guard, P2, OPEN.** Runner наследует Docker environment/default context и сам не отвергает remote `DOCKER_HOST`/Docker context до build/create. Binding `127.0.0.1` относится к выбранному daemon и не доказывает его физическую локальность. **Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки.** В этой сессии daemon locality проверена отдельно до запуска; проверка не является исправлением runner. Remote context не подключался для эксперимента. Нужен отдельный guard для approved local daemon перед применением на произвольных operator hosts.

Остальные ограничения final review сохраняются: shallow validation не является malware/full-decoder проверкой; privacy checks не атомарны с policy-admin changes; shared SDK transport deadlines и будущий HTTP cancellation/ownership/DB consistency contract требуют отдельного этапа. Configured deployment MinIO release отдельно runtime не проверялся. Они не исправлялись и не выдаются за закрытые findings этой remediation.

## 8. Итоговый release gate

**PASS WITH NOTES.** Оба подтверждённых P2 code defects закрыты, 27 новых regression cases прошли вместе со всеми обязательными gates; streaming cleanup/backpressure/cancellation сохранены. Phase 2B-1 подготовлена к отдельному коммиту в согласованном scope. Notes относятся к открытым F-2B1-03/F-2B1-04 и ограничениям предыдущего review; warm local test pass не закрывает infrastructure risks и не разрешает deployment.

Phase 2B-2 не начиналась; Document API не менялся. Commit, push и deploy не выполнялись. Production/Test connections отсутствуют. `/docs` уже ignored существующим `.gitignore`; отчёт создан локально, Git index не менялся. При будущем отдельном коммите отчёт потребуется явно включить согласно существующей политике repository.
