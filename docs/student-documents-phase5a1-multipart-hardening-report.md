# Phase 5A.1 — Student Multipart Resource Hardening

## 1. Executive Summary

**F-5A-R01 (P2): CLOSED в implementation/self-check; готово к independent Final Review. Backend Commit Gate: PASS WITH NOTES. Test Deployment Gate: NOT READY. Production Deployment Gate: NOT READY.**

Student create ограничен тремя текстовыми полями и одним файлом, replacement — одним файлом без текстовых полей. Неизвестные, повторные и вложенные create fields отклоняются до DTO whitelist/DocumentService. Исправление F-5-01 сохранено: файл размером **10 485 760 bytes включительно** принимается, MAX+1/MAX+2 возвращают 413 при корректном остальном multipart.

Полный regression: **1494 уникальных repository tests PASS = baseline 1446 + 48 новых**, без сложения повторных subsets. Actual HTTP probes: 47 baseline + 38 temporary candidate + 55 после implementation; последние **55/55 PASS**. Старые наблюдения подтверждают воспроизведение finding, а не успешное hardening до исправления.

## 2. Baseline / Git Scope

Работа начата после отдельного Phase 5A commit `9088307591ea29c57a599c9d54a4eae16ad952da` (`fix(documents): accept exact 10 MiB student uploads`), ветка `release/manual-contract-candidate`. Локальный upstream `origin/release/manual-contract-candidate`: ahead 1 / behind 0, без fetch. Начальные status/index пустые; сохранены SHA-256 всех 709 tracked files и существующих документов.

Основания: [Phase 5A final review](student-documents-phase5a-final-review.md), [boundary remediation](student-documents-phase5a-upload-boundary-remediation.md), [Test rehearsal](student-documents-phase5-test-rehearsal-report.md). Исторические reports не переписывались: F-5A-R01 OPEN в предыдущем review — состояние до этой remediation.

Финальный scope: 3 modified tracked files, 1 new source file, этот новый ignored report. HEAD/index не менялись. Application edits ограничены student controller и focused create-input interceptor. DocumentService, Staff CRUD, DTO, shared validator/writer, JWT/current-DB authorization, AuditLog/recovery/observer, Prisma/schema/migrations, CI/deployment и другие upload endpoints сохранены.

## 3. Root Cause F-5A-R01

Student FileInterceptor передавал только `fileSize=MAX+1, files=1`. Busboy defaults для `fields`/`parts` — Infinity, для `fieldSize` — 1 MiB. Multer через append-field накапливал повторные поля в массивы. Create whitelist удалял неизвестные keys только после полного multipart parsing; replacement вообще не использовал text body.

Fresh local baseline воспроизвёл 100000 дополнительных полей по 64 ASCII bytes и 64 поля по 512 KiB. С valid small PDF оба endpoints успешно завершались после накопления всего текста (201/200); invalid PDF давал 400 только после parsing. Авторизация перед Multer сохранена, поэтому это authenticated resource risk, а не доказанный unauthorized access/OOM.

Count limits сами по себе недостаточны: candidate fixture с fields=3/parts=5 всё ещё принимал неизвестное третье create field. Поэтому после FileInterceptor поставлен raw-input interceptor: только exact keys `title`, `documentType`, `targetProgramId`, только scalar strings. Arrays/objects от repeated/bracket field syntax отвергаются до global whitelist. Существующие DTO rules для обязательности, enum, числового преобразования и ownership не менялись.

## 4. Previous vs New Multipart Contract

| Route | Previous text / parts | New text fields | New actual multipart parts | File |
| --- | --- | --- | --- | --- |
| POST `/api/v1/documents` | Unlimited; unknown keys stripped later | ≤3, unique allowed keys | ≤4 | Exactly one non-empty valid PDF/JPEG/PNG, ≤10485760 bytes |
| PATCH `/api/v1/documents/:id/new-version` | Unlimited; ignored | 0 | ≤1 | Same file contract |

Create: required `title`, `documentType`; optional `targetProgramId` belonging to the current student; one `file`. Replacement: **file-only**, без staff snapshot fields. Extra/duplicate fields теперь 400. Missing/empty file, invalid MIME/magic остаются 400. Existing valid 2-field create, 3-field create and file-only replacement сохраняют response serialization и business behavior.

## 5. Compatibility Impact

**Намеренно изменена legacy compatibility boundary:** дополнительные text fields, ранее silently ignored, теперь отклоняются. На replacement нельзя отправлять title/documentType/targetProgramId, staff expectedVersion/expectedUpdatedAt или служебные keys. На create нельзя добавлять telemetry/client-local fields, protected fields или повторять keys. Клиенту следует создать новый FormData с разрешённым набором, не переиспользовать форму со stale metadata.

Проверены доступные source/API consumers и repository tests. В source нет отдельного student Document frontend/Agent client; billing FormData относится к другому endpoint. [Frontend integration guide](student-documents-phase4-backend-client-integration.md) описывает student replacement file-only, staff contracts остаются отдельными. Внешний frontend repository недоступен, mobile приложения нет; внешний browser/client compatibility **не проверен**, нужен sign-off разработчика.

Найден локальный consumer: multipart helper в `test/document-security-http.test.ts` посылал create fields и при PATCH. Он обновлён на file-only PATCH; race/CAS/authorization assertions не ослаблены. Две Phase 5A legacy extra-field success fixtures заменены валидными 3-field create/file-only replacement. Старые oversized-with-extra fixtures проверяют actual parser error precedence. Число существующих tests сохранено.

## 6. Parser Limits / Error Mapping

Installed Multer 2.1.1, Busboy 1.6.0, Nest platform-express 11.1.21 проверены локально по implementation и actual HTTP **до изменения source**.

| Limit | Create | Replacement | Equality semantics |
| --- | --- | --- | --- |
| fileSize | 10485761 | 10485761 | Busboy emits limit at equality; shared validator stays ≤10485760 |
| files | 1 | 1 | Next file emits filesLimit/unexpected-file |
| fields | 3 | 0 | Next text field emits fieldsLimit before append |
| parts | 5 | 2 | `++parts === partsLimit` emits partsLimit: sentinels permit 4 / 1 actual parts |
| fieldSize | Default 1048576 unchanged | No text accepted | Equality truncates; actual accepted scalar field ≤1048575 bytes |

Existing student fieldSize не заменён staff 1024-byte setting. ASCII title at 1048575 bytes succeeds and persists; 1048576/1048577 return 400. Это byte bound, не character count. Сохранение boundary проверено baseline/candidate/after и permanent test.

Nest maps LIMIT_FILE_SIZE →413; field/part/file-count limits и raw/DTO/content validation →400. Tests проверяют actual codes, включая file-first и fields-first. Если запрос нарушает несколько limits, возвращается первая parser error: oversized valid-shape file →413; extra fields before file могут дать 400 раньше file-size проверки; oversized file-first может дать 413 раньше extra-field rejection. Это не обход валидатора: ни один такой запрос не записывается.

Raw interceptor работает после parsing и до global pipes; он не обещает pre-buffer rejection неизвестного поля. За resource bound отвечает parser. Отдельные tests с `Content-Disposition: attachment` parts подтверждают, что skipped parts тоже расходуют parts budget и дают `Too many parts` 400.

## 7. Resource Benchmarks

Evidence: `/private/tmp/oxus-phase5a1-4t_857pr/{before,candidate,after}-results.json`. Fresh migrated owned DB per phase; actual compiled Nest controllers/services, Prisma, JWT guard, SDK/MinIO. HTTP client в отдельном процессе; focused server с `--max-old-space-size=256`. Runtime stats sampled каждые 5 ms плюс response finish. Это sampled values, не true peak и не полный production AppModule. GC, warm caches и параллельный regression влияют на absolute RSS/latency.

100000×64 payload: около 15.07 MiB wire; 64×512KiB: около 32.01 MiB wire. Ни destructive stress, ни OOM testing не проводились. Метрика fields — число retained scalar values в raw `req.body`, включая elements duplicate arrays; она не является счётчиком всех просмотренных transport/header bytes.

Таблица для valid small PDF; memory в MiB, baseline→sampled peak:

| Scenario | HTTP | Retained fields | Server ms | RSS | heapUsed | external | arrayBuffers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Before create 100000x64 | 201 | 100002 | 176.57 | 370.75→370.77 | 88.09→88.43 | 17.75→17.88 | 11.69→11.82 |
| Before create 64x512KiB | 201 | 66 | 76.93 | 430.20→481.84 | 99.61→127.32 | 28.08→48.21 | 22.02→37.24 |
| Before version 100000x64 | 200 | 100000 | 151.3 | 460.14→466.67 | 114.96→130.71 | 24.21→24.35 | 18.16→18.29 |
| Before version 64x512KiB | 200 | 64 | 69.43 | 462.20→499.39 | 106.88→126.62 | 35.10→47.30 | 29.04→41.24 |
| After create 100000x64 | 400 | 3 | 15.4 | 368.80→368.88 | 70.28→71.31 | 20.93→36.01 | 14.87→29.95 |
| After create 64x512KiB | 400 | 3 | 24.16 | 379.41→380.91 | 71.15→72.54 | 33.73→45.05 | 27.67→38.99 |
| After version 100000x64 | 400 | 0 | 17.54 | 385.00→385.00 | 72.15→73.20 | 16.11→31.18 | 10.05→25.13 |
| After version 64x512KiB | 400 | 0 | 29.69 | 393.64→393.64 | 76.85→77.35 | 40.88→41.01 | 34.83→34.95 |

Для invalid small PDF после hardening: create 100000/64 fields —400, retained3, 24.58/26.78 ms; replacement —400, retained0, 24.64/28.86 ms. Во всех восьми after resource scenarios **Document delta=0; business AuditLog delta=0; technical-intent delta=0; all SDK calls delta=0**, включая PutObject/DeleteObject.

Четыре concurrent field-heavy requests (2 create +2 replacement, по10000 дополнительных fields): все400; retained3/3/0/0; server27.36–30.62 ms. Isolated aggregate RSS406.47→406.56 MiB, heap83.64→85.71, external30.88→31.40, arrayBuffers24.82→25.35; все DB/journal/SDK snapshots сохранены.

Четыре concurrent exact-MAX creates: все201, четыре разных документа, JWT download exact bytes. Server407.19–464.04 ms, samples68–80; aggregate RSS411.50→433.69 MiB, heap79.05→80.51, external36.20→116.19, arrayBuffers30.15→110.14. Upload остаётся **bounded Buffer pipeline**, не streaming. Новых full-file copies в application не добавлено.

**Drain limitation:** Multer unpipes Busboy при ошибке, затем продолжает drain remaining HTTP body, чтобы избежать EPIPE. Bounds прекращают накопление полей, но не прекращают весь network traffic. External/arrayBuffers могут расти при transport drain, несмотря на retained fields=0/3. Нужны отдельные ingress body-size, connection/request timeouts и aggregate upload concurrency/admission budgets. Body budget должен учитывать multipart overhead и сохранённый title bound; ровно10 MiB ingress body cap сломал бы валидный exact-MAX file. Existing nginx128M не даёт достаточного document-specific admission budget. Global limiter/proxy configuration не добавлялись.

## 8. DB / SDK Safety

Permanent parser/content negative cases сравнивают полные отсортированные Document rows и все AuditLog rows до/после, плюс count **всех** SDK calls. Technical DocumentStorageIntent представлен audit namespace/action records, а не отдельной Prisma model. Для parser errors equality доказывает отсутствие Put/Delete и даже privacy metadata reads.

Actual no-JWT401, foreign document replacement403, foreign/missing target403, malformed/extra/duplicate input400 и normal oversized413 сохранены. Guards до Multer и transactional current-DB reauthorization не менялись. Valid uploads/downloads используют actual private SDK and exact bytes. Existing staff/student races, CAS/audit rollback, archived filters, safe PublicDocument/PublicAudit serialization проверены штатными suites.

**Late503 не приравнивается к parser rejection.** Controlled PutObject failure в after probe возвращает generic503 без raw SDK text: нет Document mutation/business event; остаётся один durable DOCUMENT_STORAGE_PENDING intent, Put attempted один раз, Delete не вызывается. Existing unknown-outcome behavior намеренно сохранён. Новая remediation не меняет компенсацию или destructive recovery.

## 9. Real HTTP / PostgreSQL / MinIO Tests

Добавлено **48 permanent tests** в `test/document-private-api.test.ts`: 0/1/2/3 allowed fields, обе ordering, own optional target, unknown/protected/duplicate/nested/array fields, fourth create field, any replacement field, missing file, skipped parts counting,100000-small/64×512KiB valid/invalid small-file scenarios обоих routes, fieldSize−1/equality/+1, concurrent field-heavy requests.

Сохранены Phase5A L−1/L/L+1/L+2 tests для обоих student routes, exact bytes по JWT download, old object retention, invalid MIME/magic/empty/multiple-file checks, unauthorized/foreign ownership и four concurrent exact-MAX uploads. Staff suite без изменений проверяет обе upload boundaries и existing CRUD/CAS/security.

Новые tests выполняются обязательно существующим CI `documents-private-api` gate: `.github/workflows/ci.yml` invokes `test/run-student-document-storage.mjs --document-api`, который запускает весь private suite и staff suite без filter/skip. Workflow/runner edits не требовались; GitHub workflows в этой задаче не запускались.

## 10. Full Regression Results

| Gate | Final result | Unique accounting |
| --- | --- | --- |
| Full Jest |707 PASS,53 suites,0 failed/skip |707 |
| Standard integration |407 PASS,0 failed/skip |407, включает OpenAPI18 и document schema migration4 |
| Real student HTTP/PG/MinIO |159 PASS,0 failed/skip |111 existing +48 new |
| Real staff HTTP/PG/MinIO |188 PASS,0 failed/skip |188 |
| MinIO foundation |20 PASS |20 |
| Storage runner security |13 PASS |13 |
| **Unique repository total** |**1494 PASS** |**1446 +48**, without repeats |
| Targeted multipart |85 PASS |Subset;37 Phase5A +48 new |
| Targeted storage Jest |108 PASS |Subset of full Jest |
| Observation runner |26 CLI +25 PG PASS |Repeat of integration subsets |
| Document HTTP security runner |80 PASS |Repeat of integration subset |
| Prisma validate/generate |PASS |No schema/migration edit |
| Nest build / TypeScript |PASS |No source business changes |
| TS lint / configured MJS + all test MJS lint |PASS |No automatic fix outside scope |
| git diff --check / untracked source whitespace check |PASS |HEAD/index unchanged |
| Temporary actual HTTP probes |47 before +38 candidate +55 after PASS |Separate evidence, not repository total |

Final results/logs в evidence root: `build-results.json`, `checks-results.json`, `integration-results.json`, `storage-results.json`, `targeted-results.json`, `jest-results.json`, per-gate logs. First integration attempt:31st security test received expected new400 on legacy replacement helper; next race wait could not reach upload hook. Только owned hanging process tree завершён. Initial trace сохранён в `integration-first-attempt.log`; helper обновлён, полный standard runner и dedicated security runner повторены. Этот промежуточный failure не скрыт и не считается extra successful test.

Docker locality проверена **до** create/build: explicit desktop-linux unix socket, expected local Docker Desktop daemon identity. New owner-labelled PostgreSQL16.0/Redis8.10.2/MinIO compatible test image, loopback ports, synthetic credentials, fresh DBs; no project .env inheritance. MinIO test image из checksum-verified upstream October2025 foundation fixture, DEVELOPMENT.GOGET build; это не доказательство exact Test/Production image compatibility. Проектные/внешние MinIO policies не менялись; штатный foundation suite использовал свои unchanged unsafe-policy negative fixtures только в новых owned disposable buckets.

Own containers running/noOOM после всех suites; final cleanup выполнен после проверки exact IDs/owner labels контейнеров и network. Повторный inspect подтвердил отсутствие всех трёх контейнеров и network; `cleanup.json` сохранён. Штатные runners проверяют ownership перед удалением своих MinIO containers. No global prune/image deletion. Temporary evidence сохранена вне repository; никаких user-file deletions.

## 11. Changed Files

| File | Change |
| --- | --- |
| `src/modules/document/api/document.controller.ts` | Student create fields3/parts5; replacement fields0/parts2; unchanged files1/fileSizeMAX+1; attach create raw interceptor |
| `src/modules/document/api/student-document-create-input.interceptor.ts` | New focused exact-key/scalar check before global whitelist |
| `test/document-private-api.test.ts` |48 actual HTTP/resource regression tests; update legacy ignored-field fixtures to approved contract; full DB/journal/SDK snapshots |
| `test/document-security-http.test.ts` | Multipart helper sends metadata on POST, file-only on PATCH; preserve all race assertions |
| `docs/student-documents-phase5a1-multipart-hardening-report.md` | New report, ignored by existing docs rule |

Нет других modified tracked/untracked source files, удалений или existing documentation edits. Existing build/generated outputs only from approved build/generate; no credentials/generated artifacts prepared for Git. Git index пуст; no add/commit/push/deploy/reset/restore/clean/rebase.

## 12. Findings P0–P3

| Finding | State | Evidence / decision |
| --- | --- | --- |
| F-5A-R01 P2 |**CLOSED — implementation/self-check**, independent review pending |Finite raw retained fields, strict create keys, actual error matrix, resource/DB/SDK checks,48 permanent tests |
| F-5-01 P2 |CLOSED, preserved |All four routes L−1/L/L+1/L+2 and exact JWT bytes PASS |
| New confirmed P0/P1 |None found |No access bypass/lost updates/audit or storage-contract regression established |
| External consumer compatibility |Design note, sign-off pending |Approved extra-field rejection; unavailable frontend not claimed tested |
| Aggregate transport/admission budgets |Remaining operational risk |Drain and parallel valid buffers persist; no global admission guarantee claimed |

## 13. Remaining Risks

C01–C14 actual Test attestations remain OPEN: release authority/hold before SSH; trusted installed scripts/config; isolated synthetic accounts/providers; migration ledger/checksum/schema/pending SQL review; actual backup and real restore; private MinIO IAM/version/anonymous deny; exact image/capacity compatibility; trusted CI immutable artifact/digest; TLS/cookie/CORS/client/proxy/body/concurrency acceptance; previous-image compatibility/preserving roll-forward; functional smoke/sign-off; legacy public exposure/retention; read-only monitoring freshness/capacity.

This remediation closes field accumulation, not arbitrary concurrent upload capacity, slow body drain or proxy budgets. Cookie-before-Bearer/refresh/logout/account-switch decisions and external browser sign-off remain separate. Legacy public bytes/old private versions remain preserved; Phase2C/retention changes are outside scope.

Inherited F-2B1-03 cold/image/deadline/resource limits, F-2B1-04 Docker locality, F-OBS-01 freshness/aggregate scans remain open. **Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки.** Здесь context/daemon проверены, общий runner не исправлялся.

**U1/U2/G1 — NOT APPROVED. Automatic destructive recovery — NOT APPROVED.** Observation remains read-only and unchanged; no restore/purge/cleanup activation or bucket policy change added.

## 14. Backend Commit Gate

**PASS WITH NOTES — implementation готова к independent Final Review.** F-5A-R01 closed by narrow student admission changes; full1494 repository tests and after55 probes pass. Notes: explicit legacy extra-field compatibility change needs frontend communication; operational transport/concurrency risks remain. Commit в этой задаче не создавался; отдельное решение после independent review.

## 15. Test Deployment Gate

**NOT READY.** Field-hardening implementation removes F-5A-R01 technical finding, но не закрывает C01–C14/operator/immutable release/hold/backup/rollback/proxy/client controls. No actual Test connection, SSH, workflow dispatch, data smoke or deploy authorization.

## 16. Production Deployment Gate

**NOT READY. U1/U2/G1 и automatic destructive recovery NOT APPROVED.** Нужны actual Test sign-off, отдельные Production authorization/IAM/backup/restore/private storage/proxy/concurrency/monitoring/release controls. Local regression/MinIO/resource results не переводят этот gate в READY.
