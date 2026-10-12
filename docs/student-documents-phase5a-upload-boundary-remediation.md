# Phase 5A — F-5-01 Student Upload Boundary Remediation

Дата: 2026-10-10, Asia/Almaty. Baseline/current HEAD: `a43ecc682100c0cafd3840ad24f8ee0bf14add74`. Ветка: `release/manual-contract-candidate`.

## 1. Executive Summary

**F-5-01: CLOSED в implementation self-check. Backend Commit Gate: PASS WITH NOTES; готово к независимому Final Review. Test Deployment Gate: NOT READY. Production Deployment Gate: NOT READY.**

Оба student multipart endpoints теперь принимают валидный файл ровно **10 485 760 bytes**. MAX+1 и MAX+2 возвращают413 до storage/intent/business writes. При успешной загрузке JWT download возвращает exact bytes. Staff implementation, схемы request/response, authorization, storage, durable intent, CAS, audit и compensation не менялись.

Прошли **1446 уникальных repository tests = baseline1399 +47 новых**:37 student HTTP,8 staff HTTP compatibility и2 validator unit cases. Отдельные повторные targeted/observation/security suites в total не добавлены. Все final suites без failures/skips/cancellations/todo. Commit/push/deploy и обращения к Test/Production не выполнялись; index пуст.

Исторический [Phase5 report](student-documents-phase5-test-rehearsal-report.md) сохранён. Этот отчёт закрывает только F-5-01; он не отменяет C01–C14/release controls и не утверждает U1/U2/G1 или destructive recovery.

## 2. Baseline/Git Scope

Preflight: HEAD и branch совпали с заданными; upstream `origin/release/manual-contract-candidate`, локально ahead0/behind0. Tracked/untracked status и staged diff были пустыми. Ignored inventory проверен: существующие docs, .env/key paths, dependencies/generated/build/cache artifacts не staging candidates; contents secrets не читались.

Итоговый scope: **4 modified tracked files +1 new ignored remediation report**. Остальные tracked files и все36 ранее существовавших файлов docs проверены SHA-256 inventory и сохранены. Application change ограничен student controller; другие production modules/configuration/schema/workflows/deployment не изменялись. Prisma client/dist — ignored outputs штатных generate/build.

Git add/commit/push/reset/restore/clean/rebase не выполнялись. Existing user files не удалялись. Upstream comparison только локальный, без fetch/remote changes.

## 3. F-5-01 Root Cause

[Shared constants/validator](../src/common/utils/minio/student-document-file.ts) задают MAX=10*1024*1024 и multipart `fileSize:MAX, files:1`. Student controller передавал их обоим FileInterceptor без sentinel. В установленном Busboy `lib/types/multipart.js` file stream получает `limit` и `truncated=true` при **fileSize===fileSizeLimit**, а Multer/Nest превращает это в413. Content validator уже разрешал buffer.length===MAX; отказ происходил раньше, при multipart parsing.

[Staff controller](../src/modules/document/api/staff-document.controller.ts) уже использовал `fileSize:MAX+1`, сохраняя shared content validator≤MAX. До исправления actual full-app Phase5 HTTP matrix воспроизводила201/413/413 для student create и200/413/413 для student replacement; staff exact-MAX работал. Before evidence — раздел11 Phase5 и `/private/tmp/oxus-phase5-9101trb6/boundaries.json`.

Это inclusive multipart boundary defect, а не ошибка PDF parser, storage metadata, authorization или транзакций.

## 4. Multipart Limit Correction

[Student controller](../src/modules/document/api/document.controller.ts) получил локальный `studentMultipartLimits = {...STUDENT_DOCUMENT_MULTIPART_LIMITS, fileSize:STUDENT_DOCUMENT_MAX_BYTES+1}`. Оба прежних FileInterceptor используют этот object. Shared export, staff config и другие upload services не изменены.

Реальный MAX остаётся10485760; внутренний sentinel10485761 не становится допустимым file size. Busboy equality rejection обеспечивает HTTP413 для MAX+1; MAX+2 также413. Shared validator независимо отвергает структурно валидные oversized PDF при прямом вызове, без multipart limit event — новые2 unit tests. Direct validator failure остаётся прежним BadRequestException400; HTTP oversized contract413 обеспечивается interceptor.

Никаких новых Buffer copies, writer/helper service, streaming/spooling или изменения existing Buffer ownership copy в StorageService. Upload остаётся **bounded Buffer pipeline**.

Multipart fields/parts проверены отдельно:

| Student route | Existing behavior, сохранённое remediation |
| --- | --- |
| Create | title/documentType и optional targetProgramId; duplicate known fields дают array и validation400; unknown text fields удаляет production whitelist |
| New-version | DTO body отсутствует; дополнительные/повторные text fields игнорируются, файл всё равно проходит тот же validator |
| Оба | files=1; повторный file/другой file field400; Busboy default fieldSize1MiB, exceeding text field400; остальные multipart settings unchanged |
| Aggregate fields/parts | Explicit count bounds отсутствуют: Busboy defaults fields/parts=Infinity; staff-only count/1024-byte bounds не скопированы |

Tests подтверждают valid create с тремя contract fields и повторными ignored fields при MAX, valid replacement с ignored fields при MAX; extra/duplicate fields не обходят oversized413. Student test fixture global ValidationPipe приведён к actual main.ts (`whitelist:true, transform:true, forbidUnknownValues:false`), вместо прежнего более строгого `forbidNonWhitelisted:true`; application bootstrap не изменён. Это исключает ложное утверждение, что production отклоняет unknown create fields.

Unlimited aggregate text fields/parts — сохранённый resource-risk и отдельный hardening scope. Этот patch ограничивает file bytes, а не весь размер multipart request; staff title/count restrictions без approval изменили бы student compatibility.

## 5. Authorization/Error Contract

| Case | Fresh verification |
| --- | --- |
| No JWT |401 для обоих student multipart routes; snapshots unchanged |
| Foreign student replacement / foreign portrait target |403; guards/current ownership сохраняются; snapshots unchanged |
| Empty / corrupt PDF,JPEG,PNG / MIME mismatch / multiple file |400; zero SDK calls и DB mutations |
| MAX+1/MAX+2 |413 для create/replacement; zero SDK calls, Document/business audit/technical intents unchanged |
| Valid MAX |201 create /200 replacement; public11 fields, version and committed intent verified |
| Storage unavailable | Existing real API failure-injection cases503 прошли; generic storage error, SDK details не расширены |
| Concurrent access/write / audit failure | Existing current-DB reauthorization, CAS409, audit rollback/compensation cases прошли |

Student ownership/guards, staff permissions и student response bodies не менялись. Negative snapshots сравнивают **все Document rows и все AuditLog rows**, включая technical journal, а также SDK-call counter. Zero SDK calls означает отсутствие PutObject/DeleteObject/bucket operations; проверяется сохранность timestamps/values, а не только counts. Fixture setup до snapshot отделён от rejected request. Successful replacements дополнительно читают старый private key через настоящий SDK и подтверждают прежние bytes.

503 failure injection относится к negative scenarios; successful Put/Get/download используют настоящий MinIO и не заменены mocks.

## 6. Boundary Matrix Before/After

Все размеры ниже — bytes файла, без multipart overhead. Before — actual Phase5 rehearsal; after — permanent HTTP suites на свежих migrated disposable DB и реальном MinIO.

| Route | MAX−1 before→after | MAX before→after | MAX+1 before→after | MAX+2 after |
| --- | --- | --- | --- | --- |
| Student POST /api/v1/documents |201→201|413→201|413→413|413|
| Student PATCH /api/v1/documents/:id/new-version |200→200|413→200|413→413|413|
| Staff POST /api/v1/expert/portraits/:portraitId/documents |201→201|201→201|413→413|413|
| Staff PATCH same scope/:documentId/new-version |200→200|200→200|413→413|413|

MAX−1=10485759; MAX=10485760; MAX+1=10485761; MAX+2=10485762. Для успешных случаев actual JWT binary response deep-equal исходному Buffer.

## 7. Real HTTP/PostgreSQL/MinIO Tests

В [student suite](../test/document-private-api.test.ts) добавлены37 permanent tests:

- Для обеих routes четыре границы, empty/corrupt трёх formats/MIME mismatch, повторные/другие file fields, extra/duplicate text fields+oversized, default text-field bound и401; negative full DB/SDK snapshots.
- Duplicate known create fields400; чужой actor/target403; production whitelist compatibility и все optional create fields; ignored replacement fields без bypass.
- Четыре параллельных exact-MAX uploads, distinct saved IDs, exact download bytes каждого файла и memory samples.

[Validator Jest](../src/common/utils/minio/student-document-storage.service.spec.ts):2 новых structurally-valid MAX+1/MAX+2 PDF cases. Existing exact-MAX, PDF header high-bit mutations/EOF, JPEG/PNG structure/MIME/size checks сохранены и прошли; полноценный parser не добавлялся.

Настоящие compiled Nest controllers/interceptors/guards/services + PostgreSQL16.0 + real source-built MinIO. Focused Nest fixture не запускает весь Production AppModule; wiring/request pipeline и current DB auth сохранены. Новый test bootstrap повторяет actual global pipe. JWT, ownership, storage и business DB calls не подменены для success; existing controlled failure hooks/barriers проверяют negative/concurrency paths.

Новая инфраструктура: UUID ownership labels, explicitly verified Docker Desktop Unix socket/context и daemon ID, loopback-only random ports;3 собственных containers PG16/Redis8/MinIO и собственная сеть, synthetic credentials/data, без project .env. PG/MinIO по512MiB, Redis256MiB, CPUs2, PG/MinIO tmpfs1GiB. Redis приведён к password-free isolated CI fixture после диагностированного mismatch. Реальный Redis8 соответствует server major; exact Test settings/version не утверждаются.

MinIO — штатный test Dockerfile с checksum-pinned October2025 upstream source. Это не exact June2025 server image; прежняя server-version compatibility gap остаётся. Standard storage runner дополнительно сам создал/очистил два собственных labeled MinIO containers; их штатные resources/deadlines не исправлялись.

После всех tests3 infra containers/network удалены по exact IDs после ownership checks; OOMKilled=false перед cleanup. Нет global prune или удаления shared images/cache/user resources. Runners удалили только fresh owned test DB/containers.

## 8. Staff Compatibility

[Staff suite](../test/document-staff-api.test.ts):8 permanent compatibility cases (2 routes×4 sizes), actual strict snapshot fields/optional target, exact bytes и negative DB/audit/SDK snapshots. **188/188 PASS**, включая прежние four exact-MAX upload benchmark cases.

Staff controller/service/authorization, raw DTO/F-3-R01 validation, expectedVersion/expectedUpdatedAt CAS, same-ms/ABA protections, assignment/profile races, transactional audit rollback, idempotent archive, archived filters и old-object retention не изменены. Existing staff/student interleavings и security tests прошли заново.

## 9. Concurrency/Memory Results

Final permanent student suite: **4 simultaneous uploads×10485760bytes →4 HTTP201,4 distinct rows/private files**, subsequent exact bytes каждого download. Upload operations elapsed **454.466ms**, sampling10ms,42 samples. Warm process; input fixture allocation предшествует baseline.

| Memory | Baseline MiB | Sampled peak MiB | Delta MiB |
| --- | ---: | ---: | ---: |
| RSS |524.27|525.98|1.72|
| heapUsed |68.24|74.64|6.39|
| external |91.28|145.31|54.04|
| arrayBuffers |65.97|120.16|54.19|

Измерение **combined HTTP client+Nest+Prisma+SDK process на локальном arm64**, не isolated production server/cgroup и не true peak. RSS после предыдущих boundary tests уже high/warmed; маленькая RSS delta не означает negligible per-upload memory. external/arrayBuffers пересекаются и не суммируются с RSS. GC/reuse и10ms sampling способны скрыть пики; это один успешный burst, не sustained capacity/admission guarantee.

Targeted повтор того же benchmark:4 success,444.741ms,41 samples; не дополнительные уникальные tests. Fresh final staff benchmark:4 exact-MAX success,518.200ms; combined process, не production memory. Для точных raw staff values использовать `staff-final.log`.

Global admission limiter не добавлялся. До Test необходимы approved concurrency/upload+proxy limits и adequate memory/CPU/headroom с наблюдением при realistic load. Bounded file size сам по себе не ограничивает aggregate memory/concurrency.

## 10. Full Regression Results

| Gate | Final result | Unique membership |
| --- | --- | ---: |
| Targeted storage validation/stream metadata Jest |108 PASS|Subset full Jest|
| Targeted new student HTTP |37 PASS|Subset student|
| Full Jest |53 suites,707 PASS|707|
| Standard integration runner |23 TAP groups,407 PASS|407|
| Real student API via standard MinIO runner |111 PASS|111|
| Real staff API, final suite |188 PASS|188|
| MinIO foundation via standard runner |20 PASS|20|
| Storage runner security |13 PASS|13|
| Observation runner |CLI26 + PG25 PASS|Subset integration|
| Document HTTP security runner |80 PASS|Subset integration|
| OpenAPI/schema migration |18 /4 PASS; schema drift checks0|Subset integration|
| Prisma validate/generate |PASS,client7.8.0|—|
| Nest build / TypeScript noEmit |PASS/PASS|—|
| TS lint / configured MJS lint / all test/**/*.mjs |PASS/PASS/PASS|—|
| git diff --check / cached check / scope hashes |PASS|—|

**707+407+111+188+20+13=1446 unique repository tests.** Baseline1399 +2 unit +37 student HTTP +8 staff HTTP =1446. Initial standard API run111+180 прошёл; после добавления staff compatibility8 отдельно повторён весь staff188 на fresh DB. Эти180 и subsequent188 не суммируются. Targeted/observation/security repeats и benchmarks повторно не считаются.

CI inclusion уже обязательна: [quality full Jest](../.github/workflows/ci.yml#L84) включает new unit cases; [private API gate](../.github/workflows/ci.yml#L97) запускает [оба suites без opt-in](../test/run-student-document-storage.mjs#L111), включая все45 новых HTTP cases. Workflow/package/runner behavior не изменены. Hosted CI не запускался; local success не заменяет future trusted CI gate.

Диагностические первые попытки сохранены отдельно, не объявлены PASS: sandbox EPERM на Jest CORS HTTP sockets исправлен разрешённым local loopback execution; NOAUTH в integration вызван password-protected ephemeral Redis при password-free queue fixture, исправлен только ephemeral config; первоначальные new test expectations text-field413 и large unauthorized Supertest ECONNRESET исправлены (actual existing text error400, stable401 request). Negative unknown-field assertion заменена actual whitelist compatibility; application logic не менялась ради green tests.

Evidence directory: `/private/tmp/oxus-phase5a-ax7usv5o`; `counts.json`, `boundary-evidence.json`, `jest-results.json`, `targeted-student.log`, `private-api.log`, `staff-final.log`, `integration.log`, `foundation.log`, `runner-security.log`, `observation.log`, `document-security.log`, validate/generate/build/TS/lint logs и scope/infra checks. Logs содержат только synthetic test fixtures и local endpoints; они не включаются в Git. Baseline/old documentation сохраняют исторические результаты отдельно.

## 11. Changed Files

| File | Change |
| --- | --- |
| src/modules/document/api/document.controller.ts | Student-local MAX+1 sentinel для двух прежних interceptors |
| src/common/utils/minio/student-document-storage.service.spec.ts |2 direct validator oversized cases|
| test/document-private-api.test.ts |37 HTTP regressions; fixture pipe соответствует production bootstrap|
| test/document-staff-api.test.ts |8 route boundary compatibility cases|
| docs/student-documents-phase5a-upload-boundary-remediation.md |Этот новый ignored отчёт|

Никаких Prisma/schema/migration, DocumentService, private storage, recovery, observer, JWT/auth, public UploadService/ContractScanService, Contracts/Payments/Lead, frontend/mobile, Docker/Compose/deployment/CI changes.

## 12. Findings P0–P3

| Finding | Severity / status | Assessment |
| --- | --- | --- |
| F-5-01 |P2 CLOSED, pending independent Final Review|Both student exact-MAX success; >MAX413 and no mutations; staff compatible|
| New confirmed P0/P1 |0|В данном bounded remediation/review не выявлены|
| New additional confirmed P2/P3 defects |0|Scope patch не вводит иных подтверждённых defects; inherited operational risks ниже не закрыты|

Структурная content validation не AV/full decoder; tests не доказывают безопасность arbitrary parser inputs или arbitrary external SQL/seed writers. Сохранённые unbounded multipart text fields/parts и aggregate memory требуют separate resource-hardening decision; closed F-5-01 не означает полное upload admission hardening.

## 13. Remaining Risks

- **C01–C14 OPEN для actual Test**, включая trusted release authority/hold, installed scripts/identity, effective config/origins/JWT, Test isolation, migration ledger/drift/pending SQL, real backup+restore/RPO/RTO, private storage/IAM, exact-image compatibility/budgets, immutable digest/provenance, TLS/proxy/client/resource boundaries, maintenance/previous-image compatibility, synthetic acceptance, legacy exposure и observation operations. F-5-01 снимает только inclusive-boundary defect внутри C10.
- Release publish→pre-SSH hold, reviewers/branch restrictions, immutable artifact approvals и actual previous-image rollback compatibility ещё не доказаны. Automatic rollback to previous image **NOT APPROVED**; older historical image может нарушать private/archived authorization.
- **U1/U2/G1 NOT APPROVED; automatic destructive recovery NOT APPROVED**. Observer unchanged; deployment не разрешён. Phase2C legacy migration design NOT APPROVED; public historical bytes и legacy private404 acceptance отдельно.
- Inherited F-2B1-03 image/cold runner/resource/deadline budgets, F-2B1-04 Docker locality, F-OBS-01 observation scale/freshness, F-2B2-R01 responder note и auth/client topology risks остаются. **Docker runner нельзя считать безопасным для произвольного удалённого Docker context без дополнительной проверки**; текущие explicit local socket/daemon checks не являются его code remediation.
- Buffered aggregate upload memory, unlimited student text field/part counts, realistic concurrent load, proxy limits/timeouts, real browser CORS/cookie/refresh/logout/account switch и client sign-off не закрыты этим patch.

## 14. Backend Commit Gate

**PASS WITH NOTES — готово к независимому Final Review.** F-5-01 implementation closure подтверждён real HTTP/PG/MinIO и permanent regression coverage;1446 final unique tests PASS, scoped changes/compatibility preserved. This self-check не является независимым approval или разрешением на commit. Изменения оставлены незакоммиченными, index пуст.

| Required question | Answer |
| --- | --- |
|1. F-5-01 закрыт? |Да, implementation self-check CLOSED; independent review следующий gate|
|2. Оба student routes принимают ровно10MiB? |Да,201/200|
|3. MAX+1/MAX+2 отклонены? |Да,413 обоими routes; direct validator также отвергает oversized|
|4. Exact success bytes? |Да, authenticated real downloads deep-equal; old replacement bytes retained|
|5. Rejected invalid/oversized без DB/SDK mutations? |Да, full Document/AuditLog/intent snapshots и zero SDK calls|
|6. Staff CRUD unchanged? |Да, source preserved;188 final tests, including boundary matrix|
|7. Unique tests? |1446 =1399+47; repeated subsets excluded|
|8. New P0/P1? |Не обнаружены подтверждённые|
|9. Independent Final Review возможен? |Да; index пуст, no commit/push/deploy|
|10. Remaining Test conditions? |C01–C14 actual operator evidence и release controls, перечисленные выше|

## 15. Test Deployment Gate

**NOT READY.** F-5-01 closure не закрывает actual server preflight, C01–C14, release controls/published digest/hold/approval, backup/restore, migration history, IAM/privacy, capacity/proxy/client/rollback и acceptance. Test не использовался, rollout не запускался.

## 16. Production Deployment Gate

**NOT READY.** Production не использовался. U1/U2/G1 и automatic destructive recovery **NOT APPROVED**; production operational/client/privacy/recovery/deployment gates остаются отдельными решениями. Нет commit/push/deploy и staging; только локальные owned disposable tests и scoped remediation.
