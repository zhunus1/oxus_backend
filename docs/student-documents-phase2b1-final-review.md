# Phase 2B-1 — Final Code Review

Дата: 2026-10-09, Asia/Almaty. Baseline: `ed29cc84ac01ce6bb04e2b6aafd543623d7e7650`. Статус: **PASS WITH NOTES**.

## 1. Executive Summary

Проведён отдельный audit pass по исходникам и фактическому patch, с повторным запуском всех обязательных gates на новой disposable инфраструктуре. Implementation report использован как описание заявленного результата, а не как доказательство успешности проверки. Application code, repository tests, Dockerfile, workflow, Prisma и Git index аудитом не менялись. Создан только этот отчёт; probes и их артефакты находятся в `/private/tmp`.

**P0/P1 не обнаружены.** Подтверждены два неблокирующих P2: PDF magic-byte comparison через lossy ASCII decoding и недостаточная проверка числового Content-Length. Оба должны быть устранены до подключения нового service к Document API. Также отмечены P2 operational gaps в воспроизводимости CI и гарантировании локальности Docker daemon. Детали и минимальные предложения приведены в разделе 11; исправления в рамках аудита не выполнялись.

Повторно прошли **842 уникальных framework tests**: 463 Jest + 348 standard integration + 20 real MinIO + 11 runner probes. Targeted и повторные package runs входят в этот итог, а не добавляются к нему. Дополнительные временные audit probes подтвердили conditional collision safety, policy race, backpressure и поведение 10/30 одновременных uploads по 10 MiB.

Основа пригодна для отдельного Phase 2B-1 commit с перечисленными notes. Это не разрешение на deploy и не подтверждение privacy Production/Test. Перед Phase 2B-2 нужны отдельные validation fixes и проектирование authorization/DB consistency/HTTP limits.

## 2. Git Diff Inventory

HEAD и branch совпадают с ожидаемыми: `ed29cc84ac01ce6bb04e2b6aafd543623d7e7650`, `release/manual-contract-candidate`. Index пустой.

В начале аудита были обнаружены четыре tracked удаления исторических отчётов. Пользователь подтвердил случайность удаления и самостоятельно восстановил их. Повторный diff подтвердил отсутствие отличий этих файлов от baseline; finding по scope закрыт. Аудит не выполнял restore/reset/clean и не изменял эти отчёты.

| Scope | Файлы / результат |
| --- | --- |
| 4 modified tracked | `.github/workflows/ci.yml`, `package.json`, `src/common/utils/minio/minio.module.ts`, `src/common/utils/minio/minio.service.ts` |
| 3 new application/test TS | `student-document-file.ts`, `student-document-storage.service.ts`, `student-document-storage.service.spec.ts` в существующей MinIO utility directory |
| 5 new test/infrastructure files | `test/student-document-storage.test.ts`, `test/run-student-document-storage.mjs`, `test/student-document-storage-runner.test.mjs`, `test/storage-runner-eslint.config.mjs`, `test/minio.Dockerfile` |
| 3 new fixtures | `test/fixtures/student-documents/{blank.pdf,pixel.jpg,pixel.png}`; синтетические blank/1×1 assets |
| 2 ignored Phase 2B-1 reports | Implementation report и этот final review; `/docs` уже ignored существующим .gitignore |
| Unchanged | Prisma schema и все migrations; Document API/service/repository; authorization; serialization; contracts; public UploadService; local/deployment Compose; lockfile/dependencies |

Итого будущий согласованный inventory: **17 files = 4 modified + 11 new source/test/fixtures + 2 reports**. Все source additions прочитаны; весь tracked patch проверен относительно baseline. Getter существующего S3 client и provider/export не меняют public initializer/upload/cleanup semantics. [MinioService](../src/common/utils/minio/minio.service.ts#L131), [module](../src/common/utils/minio/minio.module.ts#L8), [scripts](../package.json#L33), [workflow](../.github/workflows/ci.yml#L87).

Ignored inventory также содержит `.DS_Store` и семь исторических design/security/CI reports; они не относятся к Phase 2B-1 patch. Для ignored файлов Git не содержит baseline blob: их наличие нельзя выдавать за Git diff. Generated build output и dependencies также ignored и не входят в commit scope. Source snapshot после восстановления охватил **667 файлов**, включая implementation report; контроль перед созданием review дал 0 изменений. Дополнительный snapshot tracked/untracked/ignored docs охватил 674 файла. Финальная проверка hash сохранности выполняется после записи review.

## 3. Security Review

Service использует существующий MinioService/client и фиксированный server-side bucket suffix. Отсутствуют HTTP endpoints, Prisma mutations, AuditLog, RBAC decisions, URL fetch, arbitrary bucket override и fallback на public bucket. Constructor не выполняет I/O, поэтому регистрация нового provider не переключает существующие Document uploads. [Storage service](../src/common/utils/minio/student-document-storage.service.ts#L21), [unchanged DocumentService](../src/modules/document/service/document.service.ts#L33).

Upload проверяет bytes до сети, копирует Buffer до первого await и возвращает только internal metadata. Чтение/удаление/exists проверяют key до сети. Failure responses и service logs не содержат SDK message/stack, credentials, endpoint, bucket, key или содержимое файла. Backpressure и точечное удаление подтверждены probes. Реальный public UploadService upload остался анонимно читаемым в прежнем общем test-owned bucket; его policy и отдельный contract bucket сохранились.

Граница доверия: storage service является внутренним инструментом, а не ownership guard. Пользователь с возможностью изменить bucket policy/объекты непосредственно в MinIO находится вне этой границы. Phase 2B-2 обязана проверять JWT/ownership до service calls и не принимать fileKey напрямую как доказательство доступа.

## 4. Bucket Policy / ACL

На каждую новую операцию выполняются HeadBucket, GetBucketPolicy и GetBucketAcl. Bucket создаётся без public policy/ACL; `BucketAlreadyOwnedByYou` при concurrent creation допустим, затем policy/ACL всё равно проверяются. На одном instance разделяется только текущий Promise; последующие calls заново проверяют состояние. Across instances реальное concurrent creation 12 instances прошло. [Checks](../src/common/utils/minio/student-document-storage.service.ts#L66).

Policy: допустим точный `NoSuchBucketPolicy` + HTTP 404 или JSON с массивом исключительно Deny statements. Allow statements, в том числе conditional/authenticated, отклоняются. Generic 404, malformed JSON, AccessDenied/SDK failure не превращаются в private success. Консервативная policy strategy намеренно несовместима с custom bucket-level Allow grants даже для authenticated principals; это приемлемо для выделенного private bucket. Parser не является полной IAM schema validation, но никакой распознанный Allow не допускает. [Policy parsing](../src/common/utils/minio/student-document-storage.service.ts#L92).

ACL: допускается owner-only ACL либо конкретный MinIO compatibility stub с пустым Owner и единственным canonical FULL_CONTROL grant без ID/URI. Unknown/group/public grants и ошибки запроса отвергаются. GetObjectAcl дополнительно проверяется перед GetObject. Сам по себе stub не доказывает отсутствие anonymous access: доказательство включает policy и реальный unsigned access. [ACL code](../src/common/utils/minio/student-document-storage.service.ts#L45).

Repository local/deployment Compose указывает **`RELEASE.2025-06-13T11-33-47Z`**. Test Dockerfile собирает **`RELEASE.2025-10-15T17-29-55Z`**. Official `cmd/acl-handlers.go` для June release независимо загружен read-only и сопоставлен с October archive: файлы совпадают побайтно, SHA-256 обоих `d95dcc998b3b17a0d5184a101de3eba20d7caf920b03f79904dbd6ca9f0d544c`. В обоих releases ACL APIs — private-only compatibility calls, public ACL writes возвращают unsupported; GetBucketAcl/GetObjectAcl используют permission GetBucketPolicy. Это подтверждает ожидаемую исходную совместимость configured release. Actual server image/version/credentials/proxy/policy не проверялись. [Deployment configuration](../deployment/compose.yaml#L125), [June upstream handler](https://github.com/minio/minio/blob/RELEASE.2025-06-13T11-33-47Z/cmd/acl-handlers.go), [October handler](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/cmd/acl-handlers.go).

**TOCTOU воспроизведён на настоящем MinIO:** временный probe изменил только собственную bucket policy после ответа GetBucketAcl и перед PutObject. Upload завершился, anonymous GET вернул 200; следующая service operation получила 503. Это известное ограничение проверки, а не обход через HTTP/user input: injection требует policy-admin capabilities, позволяющих открыть bucket и независимо от service. Повторная проверка не является atomic storage-policy transaction. Рекомендуются ограничение policy administration, least privilege и мониторинг перед rollout; post-upload check также не устранит полностью эту гонку. Приватность Production этим локальным тестом не заявляется.

## 5. Object Lifecycle

Keys — `documents/<lowercase UUID v4>`, 46 characters. Используется crypto.randomUUID; filename, student identity и Date.now отсутствуют. Strict regex вместе с проверкой длины отвергает trailing newline, URL, traversal, uppercase и другой namespace. Bucket нельзя выбрать через key. Foreign fixtures в public/contract buckets после delete tests сохранились. [Key check](../src/common/utils/minio/student-document-storage.service.ts#L41).

`PutObject` отправляет `IfNoneMatch: "*"`. Помимо существующего SDK-level conditional-write test, отдельный real probe временно зафиксировал crypto UUID **в собственном test process**: первая service upload прошла, вторая с тем же key получила sanitized 503, исходные bytes сохранились. Backend response MinIO — `PreconditionFailed`/412. Это подтверждает реальную collision safety именно service path. Изменений source или repository tests нет. [Upload](../src/common/utils/minio/student-document-storage.service.ts#L107), [S3 conditional-write semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

Для configured June release дополнительно просмотрен official `cmd/object-handlers.go`: PutObject связывает If-None-Match с `CheckPrecondFn`/`checkPreconditionsPUT`. June runtime отдельно не запускался; native October поведение проверено фактически. [June PutObject source](https://github.com/minio/minio/blob/RELEASE.2025-06-13T11-33-47Z/cmd/object-handlers.go#L1971).

Delete выполняет один DeleteObject без listing/prefix cleanup и без URL parsing; повторный delete успешен. SDK failure не превращается в success. HeadObject 404 даёт false, storage error — 503; missing download object — 404. Versioning/Object Lock configuration не проверяется сервисом: при будущем включении versioning DeleteObject будет логическим удалением текущей версии, а не permanent purge исторических данных. В текущем scope purge не требуется. [Delete/exists](../src/common/utils/minio/student-document-storage.service.ts#L148).

## 6. File Validation

Проверены non-empty Buffer, точная reported size, 10 MiB boundary, MIME/content consistency, один file, forbidden MIME, missing/disk-only buffer и read/getter failure. Filename/extension не используются. Frozen multipart limits подготовлены, но не подключены к старому DocumentController согласно scope. [Validator](../src/common/utils/minio/student-document-file.ts#L55), [limits](../src/common/utils/minio/student-document-file.ts#L4).

Дополнительный временный probe выполнил 19 cases, включая реальные fixtures и повреждения:

| Формат | Наблюдение |
| --- | --- |
| PDF | Нормальный fixture проходит; missing EOF отвергается. Header+EOF без objects/xref и неверный startxref проходят: xref не проверяется. High-bit подмена первых `%PDF-` bytes тоже проходит — подтверждённый F-2B1-01 |
| PNG | Signature, first IHDR length/nonzero dimensions, bounded chunks и IEND проверяются; truncation, overflowing length и zero width отвергаются. Неверная bit depth и CRC проходят |
| JPEG | Normal fixture проходит; missing EOI и overflowing marker length отвергаются. Проверяются SOF0/1/2 и SOS, но не entropy stream, полный component layout или decoded image |

Ограничения xref/CRC/decoder проверки соответствуют заявленному shallow validator и не являются AV protection. При этом PDF magic comparison — отдельный дефект, а не следствие отсутствия полноценного parser: ASCII decoding теряет high bit. PNG bit-depth/color-type validation можно недорого усилить отдельно; полная decompression/CRC/content scanning выходит за текущую минимальную архитектуру. [PNG specification](https://www.w3.org/TR/png-3/#11IHDR).

Риск чрезмерной строгости: JPEG SOF modes кроме 0/1/2 исключены, PDF требуется header в byte 0 и EOF с только trailing whitespace, PNG требуется точный IEND end и JPEG — EOI в последних двух bytes. Это может отклонять редкие JPEG modes и viewer-tolerated файлы с wrapper/trailing bytes; не все такие файлы стандартно валидны. Доказанного rejection корректных обычных PDF/baseline JPEG/PNG fixtures нет; broad production corpus не исследован. До rollout следует добавить corpus типичных scanner/mobile exports и явно задать support policy, не расширяя validator на основании только filename.

## 7. Streaming & Failure Handling

Download возвращает PassThrough и metadata, использует Node Readable и `pipe`, без transformToByteArray/full-file Buffer. GetObjectAcl и bucket checks выполняются до выдачи stream. Normal binary integrity/completion, consumer cancellation, upstream errors и missing key покрыты обязательными tests. Temporary backpressure probe без consumer остановил upstream после 131,072 bytes, а не прочитал 10 MiB; output destroy уничтожил upstream. Premature close without end преобразован в безопасный 503 stream error. [Streaming](../src/common/utils/minio/student-document-storage.service.ts#L121).

Body с invalid MIME/zero/oversized length уничтожается при отказе. Но **negative и fractional ContentLength проходят**: временный SDK response probe воспроизвёл `-1` и `1.5` (F-2B1-02). NaN, Infinity, 0 и >10 MiB отвергаются. Настоящий MinIO отдавал нормальные integer lengths; malformed HTTP Content-Length не инжектировался в реальный сервер. Это defensive metadata defect, без подтверждённой утечки или обхода реального MinIO limit.

Caller обязан читать stream или уничтожить его при отмене; сервис не решает HTTP Authorization/headers. Cancellation до получения GetObject response и bounded request deadlines интерфейсом не предусмотрены. Существующий shared S3 client не задаёт connection/socket/request timeout; installed Smithy handler при отсутствии этих параметров не создаёт deadline. Это inherited transport limitation, не regression public UploadService. Перед HTTP integration нужно определить abort/deadline contract, особенно для удержания upload Buffers и stalled headers; global shared-client configuration нельзя менять без regression review.

Errors/logs сервиса безопасны для рассмотренных SDK paths: наружу идут generic 503/404/400, без исходного SDK message или document metadata. Audit probes не обнаружили raw upstream SDK leakage.

## 8. Real MinIO Tests

**Повторены все 20 scenarios, PASS: 20/20**, failed/skipped/cancelled/todo = 0. Это новая disposable MinIO instance, фактические S3 requests и unsigned HTTP probes. [Suite](../test/student-document-storage.test.ts).

| Scenarios | Что подтверждено |
| --- | --- |
| 1 | Private bucket creation, 12-instance concurrent initialization, policy absence и signed ACL |
| 2–4 | PDF/JPEG/PNG upload, bytes, MIME/size, keys без PII/URL, object ACL, anonymous GET 403 |
| 5 | Anonymous ListBucket и PutObject 403 |
| 6–11 | Missing/empty/oversized/mismatch/forbidden/multiple files без новых objects |
| 12 | 16 concurrent unique uploads и conditional overwrite refusal |
| 13–15 | Single/idempotent delete, missing key, foreign namespace/URL/traversal rejection и сохранение чужих fixtures |
| 16 | Public-policy canary 200, service отказ без policy repair, после own cleanup GET 403 |
| 17 | Public bucket/object ACL attempts получают 501; objects остаются anonymous-inaccessible |
| 18 | Invalid synthetic credentials дают safe storage refusal |
| 19 | Early cancellation и последующее корректное чтение 10 MiB object |
| 20 | Real public UploadService URL/bytes и public policy сохранены; contract bucket ACL/policy/content сохранены |

Конкретные GetBucketPolicy/GetBucketAcl AccessDenied/unsupported/malformed failure paths проверены unit mocks, а не реальными separately provisioned IAM users. Invalid-credentials scenario обычно отказывает раньше policy/ACL. Это точное ограничение test coverage, а не доказательство IAM behavior на серверах.

Дополнительные real probes: administrator policy race, actual service collision и 1/10/30 max-size uploads. Они не увеличивают framework count. Первоначальный performance probe в более тесном container (1 GiB RAM, tmpfs 384 MiB) получил sanitized storage 503 на 30 uploads; причина SDK failure не была сохранена до cleanup, поэтому OOM/DiskFull не утверждается. Повторный owned probe с 2 GiB/1 GiB tmpfs прошёл; small-capacity failure остаётся capacity-planning evidence, а не подтверждённым application defect.

## 9. CI / Infrastructure Review

Dockerfile fixed source: official `RELEASE.2025-10-15T17-29-55Z` archive, `ADD --checksum=sha256:be6d0bd3696c3a13a35f02d3a0280b64319c67918b4501c5c3d87f96d000085c`, Go 1.24.8. Audit independently вычислил SHA-256 archive и получил то же значение. Current Docker build прошёл; archive/Go layers были cached, поэтому cold source download/build в этой audit-сессии не замерялся. [Dockerfile](../test/minio.Dockerfile).

Go build использует upstream go.mod/go.sum; отключён CGO, нет curl-pipe-shell, install scripts или go generate. Go module dependencies загружаются официальным module machinery с checksum verification по go.sum/default sum database, а не произвольным script downloader. Дополнительный storage provider/dependency в application не добавляется. Base images `golang:1.24.8-alpine` и `node:22-alpine` не pinned by digest; source integrity подтверждена, bit-for-bit image reproducibility не гарантируется (F-2B1-03).

Runner ownership: UUID name/label, random local test credentials, dynamic port только на 127.0.0.1, non-root process, tmpfs data. Cleanup требует exact ID и matching label; global prune/prefix cleanup отсутствуют. Прогнаны 11 offline probes: build/create/start/spawn failures, test failure, unsafe port, ownership mismatch, combined cleanup failure и interrupts при creation/test. Primary errors сохраняются. [Runner](../test/run-student-document-storage.mjs), [probes](../test/student-document-storage-runner.test.mjs).

Credentials: real tests получают whitelist child env; inherited AWS credentials, NODE_OPTIONS и dotenv overrides не доходят до S3 test process. MinIO получает только созданные runner synthetic root credentials. Server .env не читался. Parent Docker commands наследуют process environment/context: поэтому locality самого daemon не enforced (F-2B1-04). Audit фактически использовал `desktop-linux` и свежие containers; remote Docker/Test/Production не использовались.

CI step обязательный и расположен после build, до standard integration; нет condition, continue-on-error или failure suppression. Общий quality timeout **20 minutes**. Source build — рациональный fallback для fixed upstream release в текущем implementation, однако fresh hosted runners каждый раз скачивают Go dependencies и компилируют MinIO; межзапускового build cache step нет. Cold runtime/network/CPU/RAM budget GitHub Actions этой сессией не подтверждён. В самом runner нет per-command deadline, CPU/memory limit или bounded tmpfs size; только readiness polling ограничено максимум примерно 120 s, а whole CI — 20 minutes. При hang build/docker/test cleanup может зависеть от job termination; SIGTERM during build лишь выставляет flag, не останавливает build child. SIGKILL/host/daemon failure не гарантируют cleanup. Это operational gaps F-2B1-03, не скрываемые passing warm tests.

Предлагаемый следующий инфраструктурный шаг: управляемый immutable test image из проверенного source/digests либо controlled build cache, измерение cold Linux run, явные build/test deadlines и resource budget. Locality guard должен учитывать Docker context/DOCKER_HOST до build/create. Аудит не менял Dockerfile/runner/workflow автоматически.

После real runs containers со storage-test/storage-review labels отсутствовали. PostgreSQL/Redis этого аудита имели свои exact IDs и dynamic loopback ports; SQL подтвердил отсутствие suite databases и public tables в bootstrap. Эти containers удалены только по собственным IDs с их test-owned volumes.

## 10. Performance

На последовательную operation: upload/delete/exists — 4 SDK commands (HeadBucket, policy, bucket ACL, object request), download — 5 (добавляется object ACL). При отсутствии bucket добавляется CreateBucket. Permanent cache отсутствует: несколько service instances делают свои checks, увеличивая latency/load. Один instance coalesces только overlapping check Promise.

Временный local probe: один shared S3 client/service, одна исходная 10 MiB Buffer, отдельные snapshot Buffers каждого upload; собственный MinIO с лимитом 2 CPU / 2 GiB и tmpfs 1 GiB:

| Concurrent uploads × 10 MiB | Batch elapsed | SDK commands | Peak audit Node RSS | Peak arrayBuffers |
| --- | --- | --- | --- | --- |
| 1 | 99 ms | 4 | 121.9 MiB | 20.1 MiB |
| 10 | 836 ms | 13 = 3 checks + 10 puts | 213.7 MiB | 110.1 MiB |
| 30 | 2289 ms | 33 = 3 checks + 30 puts | 420.2 MiB | 310.1 MiB |

Все keys уникальны; after-run deletes — только exact returned keys. Это single local measurement, не throughput guarantee и не server benchmark. Считаются SDK commands, а не transport retries/TCP packets. Across instances service не объединяет checks.

**Memory interpretation:** probe разделял один source Buffer. Настоящие 30 multipart requests дополнительно держат 30 отдельных originals: до 300 MiB originals + 300 MiB snapshots, без учёта Node/SDK/HTTP overhead и памяти MinIO. Для 10 requests payload envelope — до 200 MiB. Перед Phase 2B-2 нужны multipart pre-buffer limits, concurrency/rate controls и request cancellation/deadline strategy. Streaming download не держит full-file Buffer. [Snapshot](../src/common/utils/minio/student-document-storage.service.ts#L107), [stream](../src/common/utils/minio/student-document-storage.service.ts#L121).

## 11. Findings

**P0: 0. P1: 0. P2: 2 confirmed defects + 2 operational gaps. P3: нет отдельных обязательных findings.**

| ID | Severity / nature | Evidence и минимальное предложение |
| --- | --- | --- |
| F-2B1-01 | P2, confirmed validation defect | [student-document-file.ts:62](../src/common/utils/minio/student-document-file.ts#L62): Node ASCII decoding clears high bit. Temporary probe заменяет первые `%PDF-` bytes на `byte OR 0x80`; файл всё ещё принимается как PDF. Использовать byte-preserving comparison/decoding и regression case. Исправить до Document API integration; полноценный parser не нужен |
| F-2B1-02 | P2, confirmed defensive metadata defect | [storage service:131](../src/common/utils/minio/student-document-storage.service.ts#L131): truthiness + upper bound пропускают ContentLength -1 и 1.5. SDK response probes это воспроизвели; normal MinIO integer metadata корректны. Require positive safe integer ≤10 MiB, сохранить upstream destroy и добавить targeted cases до Phase 2B-2 |
| F-2B1-03 | P2, CI reproducibility/resource gap | [Dockerfile](../test/minio.Dockerfile), [runner command](../test/run-student-document-storage.mjs#L20), [CI timeout](../.github/workflows/ci.yml#L27): verified source, но mutable base tags, cold source build каждый hosted run, отсутствие explicit per-command/runtime resource bounds. Remote CI/cold budget ещё не доказаны. Предложение: digest-pinned controlled image/cache + measured cold gate/deadlines/resources; source/workflow здесь не менялись |
| F-2B1-04 | P2, local-infrastructure guard gap | [runner:20](../test/run-student-document-storage.mjs#L20): Docker commands наследуют environment/default context до проверки port. Remote DOCKER_HOST/context не отвергается; loopback binding относится к выбранному daemon, а не доказывает его физическую локальность. Фактический audit local. Перед использованием на произвольных operator hosts добавить guard для approved local daemon; не подключать remote daemon для проверки этой гипотезы |

Policy race, отсутствующий AV/full decoder, versioning/retention semantics, future ownership/DB consistency и inherited S3 timeouts отделены от patch defects. Проектировать их в соответствующих следующих этапах; не расширять scope до public upload rewrite или retention purge.

## 12. Phase 2B-2 Readiness

Service interface достаточно узкий: upload metadata пригодны для будущего fileKey mapping; delete/exists — foundation для compensation; streaming не требует URL fetch и готов к authorized controller adapter. Нет инфраструктурного дублирования client/config и нет DB/storage transaction внутри storage service.

До подключения Document API:

1. Исправить F-2B1-01/F-2B1-02 с targeted regression cases; определить support corpus PDF/JPEG/PNG.
2. Подключить frozen limits в multipart interceptor до буферизации, enforce ownership/JWT перед storage calls.
3. Спроектировать DB transaction/recheck и compensation for orphan/ambiguous upload; не держать DB transaction через external I/O и не вводить auto purge без отдельного проекта.
4. Определить HTTP binary headers/attachment/no-store/nosniff, consumer abort и request deadlines/concurrency budget.
5. Подтвердить controlled CI cold run и configured MinIO runtime compatibility перед rollout, с approval boundary отдельного этапа; текущий audit серверы не трогает.

## 13. Final Release Gate

**PASS WITH NOTES. Отдельный commit Phase 2B-1 допустим в перечисленном scope.** P2 findings не раскрывают private data и не меняют текущий API; F-2B1-01/02 должны быть закрыты до подключения этого storage к пользовательскому Document upload/download. Production/Test readiness не заявляется. Аудит не выполняет commit.

| Запрошенный ответ | Результат |
| --- | --- |
| Есть ли P0/P1? | Нет обнаруженных P0/P1; четыре P2 items классифицированы выше |
| Подтверждена ли privacy на настоящем MinIO? | Да, на новых disposable October-release instances: anonymous GET/list/write 403 и ACL/public-policy canaries. Production/Test privacy не подтверждена; privileged policy race воспроизведён |
| Не сломан ли public UploadService? | Не сломан: code без diff, real upload/URL/anonymous bytes и policy сохранены; Document regression прошёл |
| Безопасны ли streaming/delete? | Нормальные paths, backpressure, cancellation, premature close и idempotent exact-key delete подтверждены; F-2B1-02 остаётся defensive metadata note |
| Насколько воспроизводима test infrastructure? | Fixed official source/checksum и module lock, warm run воспроизводится; bases не digest-pinned, cold hosted CI budget не подтверждён, locality/deadline/resource notes остаются |
| Сколько уникальных tests прошло? | **842 = 463 Jest + 348 standard integration + 20 real MinIO + 11 runner probes**; targeted 56 и повторы не добавлены |
| Можно ли создавать Phase 2B-1 commit? | Да, как foundation с notes и explicit source/report scope; без deploy/Phase 2B-2 API activation |

Все обязательные дополнительные checks прошли: Prisma validate, Nest build, tsc --noEmit, TS lint, MJS lint, node --check, actionlint и git diff --check. Standard suite — 23 invocations (22 node:test files и один smoke script), includes Document HTTP 80 + migration 4. Неуспешный constrained performance probe не скрыт и не считается framework success.

Evidence: `/private/tmp/oxus-phase2b1-review-{targeted,jest,minio-package,runner,integration,build,typescript,validate,lint,mjs-lint}.txt`, validation/stream/real-probe artifacts, official-source copies и hash snapshots. Они временные и не входят в future commit. HEAD/index неизменны; source hash verification подтверждает отсутствие audit edits вне этого отчёта. Git add/commit/push/deploy/reset/restore/clean не выполнялись.
