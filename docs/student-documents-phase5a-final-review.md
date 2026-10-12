# Phase 5A — Independent Final Code Review

Дата: 2026-10-10, Asia/Almaty. Baseline/current HEAD: `a43ecc682100c0cafd3840ad24f8ee0bf14add74`. Branch: `release/manual-contract-candidate`.

## 1. Executive Summary

**Backend Commit Gate: PASS WITH NOTES. Test Deployment Gate: NOT READY. Production Deployment Gate: NOT READY.**

**F-5-01 независимо CLOSED.** Student POST и PATCH new-version принимают валидные10485760bytes, отвергают10485761/10485762 с413; staff matrix сохранена. Shared validator, current-DB authorization, public responses, private storage, CAS/audit/compensation не изменены. Новых подтверждённых P0/P1 не выявлено.

Заново прошли **1446 уникальных repository tests** и отдельно **71 temporary independent probe**. Existing implementation evidence не заменяет эти fresh runs. Read-only review не изменял application/tests/Prisma/CI/deployment или Git index; создан только этот ignored final-review report.

Подтверждён отдельный **F-5A-R01, P2: student multipart не ограничивает количество text fields/parts и aggregate text buffering**. Это pre-existing gap, не регрессия MAX+1 sentinel. Его необходимо закрыть отдельным approved resource-hardening gate до Test exposure; code автоматически не исправлялся. Backend commit может отдельно зафиксировать проверенную boundary remediation, сохранив этот finding и Test NOT READY.

[Remediation report](student-documents-phase5a-upload-boundary-remediation.md) и [Phase5 deployment rehearsal](student-documents-phase5-test-rehearsal-report.md) сохранены без редактирования.

## 2. Git Scope

Preflight HEAD/branch совпали с заданными. Upstream `origin/release/manual-contract-candidate`, local ahead0/behind0, index пуст. Полный accumulated tracked diff: **ровно4 modified files**, без tracked deletions/new files. Non-ignored untracked files отсутствуют.

| File | Reviewed change |
| --- | --- |
| src/modules/document/api/document.controller.ts | Import MAX, local MAX+1 limits object, два прежних FileInterceptor используют его |
| src/common/utils/minio/student-document-storage.service.spec.ts |2 direct validator MAX+1/MAX+2 cases |
| test/document-private-api.test.ts |37 HTTP regressions/benchmark; fixture global pipe соответствует actual main.ts |
| test/document-staff-api.test.ts |8 staff boundary compatibility cases |

Ignored remediation report существует. Existing ignored docs/cache/dependencies/env/key/build/generated paths проверены как inventory, а не staging scope. Secrets не читались/не выводились; env/key/generated outputs отсутствуют в tracked diff/index. Prisma generate и Nest build создали/обновили только обычные ignored outputs необходимых checks.

Snapshot **707 tracked file hashes и37 existing docs hashes** до/после review подтверждает их сохранность, включая четыре уже изменённых implementation files. Единственный новый repository файл — `docs/student-documents-phase5a-final-review.md`, ignored правилом `/docs`. Нет изменений shared file validator/constants, Staff controller, DocumentService/repository/access/auth, StorageService/recovery/observer, public uploads, Contracts/Payments/Lead, Prisma/schema/migrations, CI/Compose/deployment. User files не удалялись.

Git add/commit/push/reset/restore/clean/rebase не выполнялись. Remote fetch/workflows/server access отсутствуют; ahead/behind относятся только к локальному upstream ref.

## 3. Exact Upload Boundary

[MAX constant](../src/common/utils/minio/student-document-file.ts#L4):10485760. Shared validator отвергает empty/non-Buffer/mismatched size/MIME и buffer.length>MAX, затем проверяет PDF header/EOF или JPEG/PNG structural markers. Он не является полноценным decoder/AV.

[Student-local limits](../src/modules/document/api/document.controller.ts#L20): `{...sharedLimits,fileSize:MAX+1}`; используются [POST](../src/modules/document/api/document.controller.ts#L62) и [PATCH](../src/modules/document/api/document.controller.ts#L116). Files=1 сохранён. Shared exported multipart limit и другие upload services unchanged.

Независимо прочитан установленный Busboy: `lib/types/multipart.js:476–481` при fileSize===fileSizeLimit emits limit/truncated. Nest `multer.utils.js` преобразует LIMIT_FILE_SIZE в413. Sentinel разрешает MAX; MAX+1 equality уже413; MAX+2 также413. Direct structurally-valid PDF MAX+1/MAX+2 отвергнут validator с прежним400, даже без interceptor/limit event.

| Actual route | L−1 | L | L+1 | L+2 |
| --- | ---: | ---: | ---: | ---: |
| Student POST /api/v1/documents |201|201|413|413|
| Student PATCH /api/v1/documents/:id/new-version |200|200|413|413|
| Staff POST /api/v1/expert/portraits/:portraitId/documents |201|201|413|413|
| Staff PATCH same scope/:documentId/new-version |200|200|413|413|

L=10485760. Все8 successful matrix requests вернули точные source bytes при actual JWT binary download, Content-Length равен file bytes. Все8 oversized requests сохранили full Document/AuditLog/journal snapshots и SDK histogram. Existing permanent suites дополнительно проверили private old-byte retention после replacement и PDF/JPEG/PNG success/MIME/headers.

Empty/invalid MIME/magic и повторные/другие file fields400, без storage mutation. Ни новой полной Buffer copy, ни streaming/spooling/writer нет; existing storage ownership copy сохранена. Upload остаётся bounded Buffer pipeline.

## 4. Authorization/Storage Safety

Actual compiled Nest controllers/guards/interceptors/services, real PostgreSQL16 и MinIO использовались в independent fixture и permanent runners. JWT guard читает актуальную User/Role, mutation guards проверяют ownership до Multer; повторная DB authorization внутри mutation transaction сохранена. Focused fixture не является полным Production AppModule/proxy/browser.

| Independent scenario | HTTP / side effects |
| --- | --- |
| No JWT, оба student routes |401; Document/AuditLog/intents и SDK histogram unchanged |
| Foreign student replacement с exact-MAX file |403 before storage; snapshots unchanged |
| ADMIN staff replacement с foreign portrait/document |404; snapshots unchanged |
| Student JWT на staff multipart |403; snapshots unchanged |
| Empty, invalid MIME, PDF/JPEG/PNG magic |400; snapshots и SDK unchanged |
| Multiple file / unexpected file field |400; snapshots и SDK unchanged |
| Duplicate known create title/documentType |400; snapshots и SDK unchanged |
| Extra/duplicate ignored fields +oversized file |413; snapshots и SDK unchanged |
| Default text fieldSize exceeded |400; snapshots и SDK unchanged |
| Real unsafe private bucket policy, все4 routes |503 generic; Document/business/journal unchanged; only privacy reads, no Put/Delete |

Unsafe policy временно установлена **только собственному synthetic private bucket**; после4 checks удалена, последующие exact uploads/downloads работают. Это реальный MinIO privacy failure, не mock успешного storage. Responses не содержат raw SDK endpoint/bucket/ARN/policy/error details.

Full permanent suites отдельно проверили foreign target, active assigned EXPERT/profile transfer races, blocked/deleted roles/users, current portrait ownership, CAS/ABA/same-ms/staff-student races, audit rollback, archived filters/idempotency, uncertain upload/COMMIT outcomes и stream cancellation. Auth/JWT/cookie/CORS/serializer source hashes unchanged.

**Граница side-effect guarantee:** invalid/oversized/unauthorized и pre-Put privacy/storage failures не создают Document/business audit/technical intent и не вызывают Put/Delete. Нельзя утверждать это для любого позднего503: [beforeUpload intent](../src/modules/document/service/document.service.ts#L87) записывается до Put. Два дополнительных independent negative SDK-failure probes вернули503 после одного attempted Put: Document/business audit unchanged, но появился1 **PENDING DocumentStorageIntent**, Delete отсутствует. [Conservative compensation](../src/modules/document/service/document-storage-recovery.service.ts#L49) не угадывает outcome и сохраняет intent при неизвестном upload/transaction результате.

Этот late503 behavior — existing approved durable protocol, не новый дефект sentinel; убрать intent ради универсального «503 zero mutations» означало бы расширить scope и ослабить recovery safety. Late failure injection подменяет только negative SDK send; successful storage operations во всех probes настоящие. Existing transaction/CAS rejection после успешного Put может иметь authorized compensation, поэтому «все rejected requests zero SDK calls» также нельзя распространять на409 после upload.

## 5. Multipart Resource Bounds

### F-5A-R01 — P2, OPEN; separate Test hardening gate

**Source:** [student controller:20/62/116](../src/modules/document/api/document.controller.ts#L20), [shared limits:9](../src/common/utils/minio/student-document-file.ts#L9). Student limits задают только fileSize и files. Busboy `multipart.js:253–263` defaults fieldSize1MiB, fields=Infinity, parts=Infinity. Multer сохраняет поля в req.body через append-field **до** whitelist/content validation; repeated fields превращаются в массив. Global whitelist удаляет unknown fields позднее; new-version text body вообще не используется. В Document routes нет собственного global admission/field-count limiter; throttler из Lead не является защитой этих routes.

**Reproduction — только на owned disposable fixture:** authenticated Student со своим portrait отправляет multipart с required title/documentType,64 одинаковыми `ignored` полями по524288bytes и валидным32-byte PDF. Ни одно text поле не достигает1MiB, file намного меньше10MiB; общий text payload32MiB. Student POST возвращает201; аналогичный PATCH с64 ignored fields и valid file —200, authenticated download exact32bytes. Значит aggregate buffering не ограничивается fileSize и не отсекается whitelist до parsing.

Ещё одна reproduction:100000 repeated ignored text parts по64bytes и corrupt7-byte file. Оба student endpoints сначала разбирают все100000 fields, затем400 от file validator; DB/journal/SDK unchanged. Wire body≈16.30MB, не огромный файл. Staff endpoints с тем же body прекращают field accumulation на count limit,400. Nest field/part limits возвращают **400**, а413 используется для file size; нельзя оценивать успешность bounds только по413.

Fresh isolated focused server process measurements; HTTP client в отдельном PID:

| Probe | Parsed ignored fields | Server elapsed ms | RSS baseline→sampled peak MiB | heapUsed baseline→sampled peak MiB |
| --- | ---: | ---: | --- | --- |
| Student create,1000×64bytes,invalid file |1000|18.02|390.19→390.20|63.40→65.34|
| Student create,20000×64bytes,invalid file |20000|52.14|390.20→392.58|66.12→74.89|
| Student create,100000×64bytes,invalid file |100000|149.71|392.58→399.27|75.69→80.45|
| Student version,100000×64bytes,invalid file |100000|137.29|398.84→401.50|67.54→82.57|
| Staff create,100000×64bytes,invalid file |0 retained repeats|17.18|401.50→401.50|83.25→84.20|
| Staff version,100000×64bytes,invalid file |0 retained repeats|17.91|398.92→405.23|63.89→64.91|
| Student create,64×512KiB,invalid file |64|48.50|405.47→463.48|70.31→95.84|
| Student version,64×512KiB,invalid file |64|54.00|463.48→511.67|98.55→126.40|
| Fresh server student create,64×512KiB,valid small file |64|89.47|273.17→324.39|70.98→102.83|
| Same server student version,64×512KiB,valid small file |64|88.92|324.62→379.02|108.83→132.77|

Пробы ограничены100000 parts или32MiB text,5ms sampling, child V8 old-space budget256MiB; intentionally OOM/host exhaustion не выполнялись. **Confirmed:** отсутствие count/aggregate protection, accepted large text payloads, parser work/memory before invalid rejection. **Inference:** authenticated field floods/concurrency способны создавать availability/resource exhaustion; actual outage, OOM или exploitable unauthenticated DoS не доказаны. P2 выбран для authenticated resource gap; P0/P1 из hypothetical crash не выводятся.

Warm/GC reuse и event-loop pauses влияют на sampled peaks; RSS/external/arrayBuffers пересекаются, не суммируются. Staff Multer после error дренирует оставшийся request body (`make-middleware.js:done`); его count limits ограничивают field retention/parser accumulation, но не заменяют transport/body-size/time budgets. Actual Test ingress остаётся неизвестным; repository Nginx client_max_body_size128M допускает такие32MiB requests и не равен10MiB file contract.

**Минимальное предлагаемое исправление, НЕ выполнено:** separate approved student config bounds по реальному набору полей: create fields3 + parts sentinel5 (max3 text +1 file), replacement fields0 + parts sentinel2 (1 file); files1/file sentinelMAX+1 и shared validatorMAX сохранить. Ограничение unknown/duplicate extra fields ужесточит нынешнюю compatibility, поэтому должно быть согласовано/задокументировано отдельно. Не копировать staff fieldSize1024 автоматически: student title DTO сейчас не имеет staff title bounds; сохранить прежний per-field limit либо согласовать новый. Добавить permanent HTTP count/parts negatives и authorized/unauthorized before-SDK snapshots, measured aggregate payload/concurrency и reviewed ingress budgets. Arbitrary global admission limiter без отдельного решения не предлагается как уже approved scope.

**До Test:** F-5A-R01 closure либо отдельно утверждённое и измеренное compensating endpoint/aggregate ingress control, вместе с concurrency/memory/time budgets и regression preservation. Одна JWT authorization или post-parse whitelist недостаточны. Backend commit самой F-5-01 remediation этот finding не закрывает.

## 6. Independent Probes

Все temporary files вне repository: `/private/tmp/oxus-phase5a-review-95snwohs`.

**71/71 PASS =67 primary +4 supplementary**, отдельные scenario records, не число внутренних assertions:

| Group | Probes |
| --- | ---: |
| Four routes×L−1/L/L+1/L+2; bytes/snapshots |16|
| Direct oversized validator |2|
| Two student routes:7 invalid file/MIME/magic/multiple cases |14|
| Student no JWT, ignored fields+oversized/valid, fieldSize |8|
| Foreign actor/portrait/staff access; duplicate known fields |5|
| Real private policy failures four routes |4|
| Four concurrent exact-L student files |1|
| Four routes×1000/20000/100000 repeated small fields |12|
| Accepted valid student create with1000/20000 ignored fields |2|
| Two student routes with32MiB aggregate text+invalid file |2|
| Four concurrent field-heavy invalid requests |1|
| Supplementary late Put failures +accepted32MiB valid create/version |4|
| **Total** |**71**|

Negative snapshots включают все Document rows и все AuditLog rows (business+technical, values/dates/state), SDK command histogram. Pre-Put refusals assert zero Put/Delete; allowed storage-read failures сравнивают object mutation counters отдельно. SDK wrapper делегирует реальные commands; child server/server memory отделены от parent HTTP client.

Four concurrent **10485760-byte student uploads**:4 HTTP201,4 different saved IDs, exact bytes всех JWT downloads. Server baseline RSS348.00MiB→sampled peak389.44MiB; heap peak71.41MiB, external96.30MiB, arrayBuffers90.24MiB; server request durations383.58–395.12ms,71–72 samples. Это warmed focused Nest+Prisma+SDK process, не full Production AppModule/cgroup/capacity guarantee; peak sampling может пропустить actual peak. Existing permanent combined-process benchmark тоже прошёл и не выдан за isolated server memory.

Four concurrent20000-field invalid student requests:all400, full DB/SDK snapshots unchanged; server≈94.5–129.8ms, sampled heap peak113.07MiB vs initial94.95MiB. Repetitions не добавлены к repository total.

Fresh infrastructure: explicitly verified `desktop-linux` context→local Docker Desktop Unix socket и daemon identity до side effects, own UUID labels/network, loopback ports, PG16.0/Redis8.10.2/real source-built MinIO October2025, synthetic env/data, no project .env. PG/MinIO512MiB,tmpfs1GiB, Redis256MiB,CPUs2. Standard MinIO runners дополнительно создают свои disposable resources; source unchanged. Exact June2025 deployed MinIO version не утверждается.

Owned DB/containers/network очищены только по exact ownership. Нет global prune/shared image removal/user resource deletion. Первоначальная temporary assertion ожидала413 для staff field count; primary-source Nest mapping и observed400 потребовали исправления только **temporary probe expectation**, с сохранением initial logs. Repository/core не менялись ради probes. Initial partial diagnostic attempt не прибавлен к71 final PASS.

## 7. Full Regression Results

Все проверки повторены заново; isolated env, generated client/build до HTTP tests, никакого lint auto-fix.

| Gate | Fresh result | Unique membership |
| --- | --- | ---: |
| Targeted storage validation/stream metadata Jest |108 PASS|Subset full Jest|
| Full Jest |53 suites,707 PASS|707|
| Standard integration |24 TAP summaries,407 PASS|407|
| Standard real student/staff API +PG/MinIO runner |111+188 PASS|299|
| Standard MinIO foundation runner |20 PASS|20|
| Storage runner security |13 PASS|13|
| Observation runner |CLI26+PG25 PASS|Subset integration|
| Document HTTP security runner |80 PASS|Subset integration|
| OpenAPI / document schema migration |18 /4 PASS; repeated schema drift0|Subset integration|
| Prisma validate/generate |PASS,client7.8.0|—|
| Nest build / TypeScript noEmit |PASS/PASS|—|
| TS lint / configured MJS / all test/**/*.mjs |PASS/PASS/PASS|—|
| git diff --check / cached check / hashes / HEAD/index |PASS|—|
| Temporary independent scenarios |71 PASS|Separate|

**707+407+111+188+20+13=1446 unique repository tests.** Ни observation/security/targeted repeats, ни71 independent probes, ни repeated baseline diagnostics не прибавлены. Final TAP fail/skipped/cancelled/todo0 и Jest failures/pending0. Standard integration smoke также завершился0. Mandatory CI inclusion сохранена: full Jest и standard private API runner выполняют new tests без opt-in; CI source hashes unchanged. Hosted CI/branch protection не проверены этим локальным task.

Evidence: `review-gates.json`, `jest-results.json`, `independent-probes-final.json`, `resource-summary.json`, `probes-results.json`, `extra-probes-results.json`, build/check/integration/storage results и `.log` в указанном temporary directory. Source snapshot/hash checks и owned infra evidence сохранены рядом; evidence не staging candidates.

## 8. Findings P0–P3

| Finding | Severity/status | Evidence / disposition |
| --- | --- | --- |
| F-5-01 |P2 CLOSED independently|Exact four-route matrix, validator negatives, real bytes/snapshots, permanent regressions|
| F-5A-R01 |P2 OPEN; newly confirmed review finding, pre-existing implementation gap|Count/aggregate text buffering; section5 reproductions; separate resource gate before Test|
| New confirmed P0/P1 |0|No authorization bypass, size acceptance bypass, raw storage leak or demonstrated outage in reviewed scope|
| New confirmed P3 |0|No additional patch-specific defect found|

F-5A-R01 существует и на baseline: прежний shared student config не задавал fields/parts. Sentinel не расширил text admission и не устранил этот отдельный risk. Его наличие не оправдывает automatic out-of-scope code edits и не превращает Test в READY.

Late503 retained PENDING intent — intentional existing safety behavior (section4), не новый finding или обещание zero-effects для всех failures. Старые reports могут описывать generic multipart413 шире фактической Nest field/part400; authoritative mapping и fresh outcomes зафиксированы здесь, historical docs не переписаны.

## 9. Remaining Risks

**C01–C14 OPEN для actual Test; Test NOT READY.** F-5-01 closure — только один контрактный пункт C10. F-5A-R01 resource closure добавляется как отдельный Test gate: approved text counts/parts/body/concurrency/time budgets, followed by permanent regression and client compatibility verification.

Остаются release authority/protected reviewers/pre-SSH hold, trusted installed files/server identity, effective config/CORS/cookie/JWT, DB/storage/queue/provider Test isolation, exact migration ledger/checksums/pending SQL/schema drift, actual backup+real restore/RPO/RTO, private bucket/IAM/ACL/anonymous denial, exact deployment-image compatibility/resources, published immutable digest/provenance, TLS/proxy/client limits, maintenance/writer freeze/actual previous-image compatibility, synthetic acceptance, public legacy exposure/client sign-off и observation configuration/alerts/freshness. Локальные mocks/probes не являются operator attestations на Test.

**U1/U2/G1 NOT APPROVED; automatic destructive recovery NOT APPROVED. Phase2C migration design NOT APPROVED. Automatic previous-image rollback NOT APPROVED.** Recovery/observer unchanged; old/public/uncertain object retention не изменена. Ни global admission limiter, ни migration/deployment/production configuration не внедрялись.

Inherited F-2B1-03 cold/image/resource/deadline runner risks; F-2B1-04 Docker locality; F-OBS-01 global scan/sweep capacity; F-2B2-R01 responder note и client/auth/legacy/AV risks остаются. **Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки.** В этом review external local socket/daemon checks обеспечили допустимый test scope, но не исправили runner implementation.

Sampling на warm arm64 focused fixture не определяет sustained Production RAM/CPU/admission capacity. Structural PDF/image checks не full decoder/AV; participating-writer CAS не защищает arbitrary raw SQL writers; request-time authorization не отменяет уже начатый binary stream. Эти границы не изменились.

## 10. Backend Commit Gate

**PASS WITH NOTES.** F-5-01 независимо CLOSED;1446 repository tests и71 independent probes PASS; новых подтверждённых P0/P1 нет; diff scoped и worktree/index/HEAD сохранены. Можно отдельно коммитить проверенные4 implementation/test files и approved release documentation в последующей явно разрешённой Git-задаче. Этот аудит commit не создаёт и не staging files.

Открытый P2 F-5A-R01 необходимо оставить в release evidence и закрыть отдельным approved task до Test; не смешивать его code remediation с уже проверенным boundary commit автоматически.

| Required question | Answer |
| --- | --- |
|1. F-5-01 закрыт независимо? |Да, CLOSED|
|2. Есть новые P0/P1? |Не обнаружены подтверждённые|
|3. Все4 routes соблюдают≤10MiB? |Да; L−1/L success, L+1/L+2 413|
|4. Rejected requests без DB/SDK changes? |Invalid/oversized/auth/pre-Put refusals — да; late503 имеет intentional attempted Put +PENDING journal, Document/business unchanged; blanket guarantee невозможна|
|5. Дополнительные multipart limits до Test? |Да, F-5A-R01 P2; отдельный approved hardening/compensating-control gate|
|6. Repository/independent counts? |1446 unique repository; отдельно71/71 independent probes|
|7. Отдельный commit возможен? |Да, Backend PASS WITH NOTES; только после отдельного Git authorization|
|8. Test blockers? |F-5A-R01 +C01–C14/release controls/operator/client/resource evidence|

## 11. Test Deployment Gate

**NOT READY.** Actual C01–C14, release controls и F-5A-R01 separate resource gate остаются открыты. Backend commit approval не является разрешением publish/SSH/deploy/Test writes. Test не использовался.

## 12. Production Deployment Gate

**NOT READY.** Production не использовался; deploy/push/commit отсутствуют. U1/U2/G1 и automatic destructive recovery **NOT APPROVED**, production operational/privacy/client/recovery gates остаются отдельными. HEAD и Git index unchanged; code/tests/CI/Prisma/deployment и пользовательские файлы сохранены.
