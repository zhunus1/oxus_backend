# Combined Independent Final Review — Phase 5A.1 + Phase 5A.2

Date: 2026-10-10, Asia/Almaty. Mode: read-only code review and safe regression verification.

## 1. Executive Summary

**Backend Commit Gate: PASS WITH NOTES. Test Deployment Gate: NOT READY. Production Deployment Gate: NOT READY.**

The combined worktree independently passes the local backend review. Phase 5A.1's finite Student field/part budgets and raw-input admission are confirmed. Phase 5A.2 resolves Nest's actual parser to Multer 2.4.0, handles the new parser errors through the normal Nest pipeline, and preserves the intended byte/part limits. No new confirmed P0/P1/P2 was identified in this scope.

**1560 unique repository tests passed**, with zero failed, skipped, cancelled, todo or pending tests in the final runs. The implementation reports were context only; their self-check results were not substituted for fresh runs. Additional independent probes are excluded from this total.

All four Document upload routes accept MAX−1 and MAX, reject MAX+1/MAX+2 with 413, and preserve exact bytes through JWT downloads. MAX = 10,485,760 bytes. Full Document/AuditLog/technical-intent snapshots and every observed SDK call remain unchanged on the tested parser/validation/early authorization refusals. Existing CAS, audit, private-byte retention and recovery tests pass.

Ordinary compatibility of the other multipart consumers is supported by source review, standard integration and 43 additional safe probes. This does not establish full external-client compatibility: WHATWG name decoding changed upstream, and browser/mobile sign-off remains absent. Nest's declared exact Multer 2.1.1 pin remains a maintenance caveat despite the verified Yarn override.

No application code, repository tests, dependencies, lockfile, Prisma, CI or deployment files were changed by this review. HEAD and the byte-level index hash are unchanged. This report is the only new file in the original repository. No staging, commit, push, remote fetch, SSH, Test/Production access or deployment occurred.

## 2. Git Scope

- HEAD and required baseline: `9088307591ea29c57a599c9d54a4eae16ad952da`.
- Branch: `release/manual-contract-candidate`.
- Index: empty; staged diff empty.
- Local upstream: `origin/release/manual-contract-candidate`; ahead 1 / behind 0. This describes the local ref, without a remote freshness claim.
- Accumulated tracked diff against baseline: 12 modified files, 353 insertions / 51 deletions; no tracked additions, deletions or renames. Three additional non-ignored untracked files were reviewed and included in the temporary test copy.

| Actual file | Git state at preflight | Reviewed change |
| --- | --- | --- |
| `package.json` | Modified | Exact Multer 2.4.0 and root resolution |
| `yarn.lock` | Modified | Parser resolution and removal of unused parser transitive entries |
| `src/common/interceptors/multer-exception.interceptor.ts` | Untracked | Narrow compatibility error bridge |
| `src/common/interceptors/multer-exception.interceptor.spec.ts` | Untracked | Dependency identity and safe callback/error regression tests |
| `src/modules/document/api/student-document-create-input.interceptor.ts` | Untracked | Exact scalar raw-field admission before whitelist |
| `src/modules/document/api/document.controller.ts` | Modified | Student field/part budgets, inclusive bytes, nesting bound and bridge |
| `src/modules/document/api/staff-document.controller.ts` | Modified | Preserved actual Staff budgets under inclusive parser semantics |
| `src/modules/billing/api/payment.controller.ts` | Modified | Bridge before existing NoFilesInterceptor |
| `src/modules/contract/api/contract-scan.controller.ts` | Modified | Bridge and preservation of exclusive byte boundary |
| `src/modules/organisation/api/organisation.controller.ts` | Modified | Bridge at logo and cover upload sites |
| `src/modules/qs-import/api/qs-import.controller.ts` | Modified | Bridge at existing upload site |
| `src/modules/task/api/student-task.controller.ts` | Modified | Bridge at existing upload site |
| `test/document-private-api.test.ts` | Modified | Student hardening/parser/resource regressions |
| `test/document-staff-api.test.ts` | Modified | Staff parser/order/part regressions |
| `test/document-security-http.test.ts` | Modified | Replacement helper sends file only; create helper retains its fields |

No unexpected diff was found. There are no changes to schema/migrations, DocumentService or repositories, JWT/RBAC/ownership implementations, audit/CAS/durable journal/recovery, CI/deployment/Compose. No user-file deletion, new credentials or generated outputs appear in the accumulated diff/index. Synthetic fixtures contain no real secrets.

Ignored paths were inventoried without reading environment/private-key contents: existing `.env`, private key, docs, dependencies, generated/build outputs and caches remain outside Git scope. `/docs` is ignored by the existing rule, so this report exists on disk and is not automatically included in a future commit.

Evidence: `/private/tmp/oxus-phase5a12-review/before.json`, `accumulated.diff`, `staged.diff`, `ignored-paths.txt`, `integrity-check.json`. Hash comparison covered every tracked and non-ignored untracked input file, plus the index. The 712 copied files were unchanged by all gates. Only generated/build/package-manager state inside the temporary copy was produced.

## 3. Dependency Compatibility

| Component | Independently observed version |
| --- | --- |
| Node.js | 22.15.1 |
| Declared/used Yarn | 4.18.0; node-modules linker |
| Nest common/core/platform-express | 11.1.21 each |
| Multer runtime | 2.4.0 |
| Busboy | 1.6.0 |
| append-field | 1.0.0 |
| `@types/multer` | 2.1.0; type package, not another runtime parser |
| Prisma/client | 7.8.0 |

The application's `require('multer')` and a `createRequire` rooted in installed Nest platform-express resolve the identical module object and path. `yarn why multer` resolves both consumers to 2.4.0. A recursive package-directory inspection of the clean installation found one runtime Multer directory. The lockfile has one Multer resolution; Nest's unchanged declared dependency remains 2.1.1, overridden by root `resolutions: { "multer": "2.4.0" }`.

A fresh temporary copy initially had no node_modules, generated client, build output, `.git` or project `.env`. Full `yarn install --immutable` succeeded, including install scripts; `HUSKY=0` and `PUPPETEER_SKIP_DOWNLOAD=1` avoided Git hooks and an irrelevant browser download. A subsequent full immutable install also passed. Source/package/lock hashes stayed identical. No dependency was changed in the original workspace.

Lock diff is limited to Multer 2.1.1 → 2.4.0, the direct descriptor, removal of unused concat-stream and typedarray entries, and removal of concat-stream's readable-stream descriptor. The readable-stream version and other resolved packages are unchanged. Three Prisma Studio React peer warnings remain; none concerns Multer.

`npm ls multer --all` exits ELSPROBLEMS because 2.4.0 differs from Nest's exact declared pin. This is a **P3 maintenance note**, not evidence that a vulnerable second parser is used or that callbacks fail. Installation/release tooling must use the declared Yarn manager and reviewed lockfile. Recheck the override when changing Nest, Multer or types. The verified combination is not native upstream dependency support for this exact pin override.

Installed Multer middleware is byte-identical to the official 2.4.0 tag: SHA-256 `75d1113f73af6ba5a3632de12942273f10b939867800fb2955e26ad9ba6eabb9`. Primary references: [Multer middleware source](https://github.com/expressjs/multer/blob/v2.4.0/lib/make-middleware.js), [release changes](https://github.com/expressjs/multer/blob/v2.4.0/CHANGELOG.md), [Yarn resolutions](https://yarnpkg.com/configuration/manifest#resolutions). Installed Nest FileInterceptor/NoFilesInterceptor continue to use callback completion; safe real HTTP tests exercise both. New settings are optional, existing route limits are valid nonnegative integers, and no newly required configuration was found.

## 4. Parser/Error Handling

The installed Multer field callback checks configured nesting before append-field and catches field-construction exceptions into `INVALID_FIELD_NAME`. The four Document routes set `fieldNestingDepth: 0`. Its memory-storage callback continues to return `buffer` and `size` expected by Nest and the unchanged file validator.

[MulterExceptionInterceptor](../src/common/interceptors/multer-exception.interceptor.ts) is outermost in the route-level multipart chain at all ten real parsing sites. Installed Nest's `transformException` compares messages; the bridge handles the new/renamed errors Nest 11.1.21 does not recognize.

| Error path | Public handling |
| --- | --- |
| INVALID_FIELD_NAME, LIMIT_FIELD_NESTING, LIMIT_FIELD_ARRAY_INDEX, STREAM_DESTROYED | 400: `Invalid multipart input`; standard `statusCode/message/error` response; cause retained internally |
| LIMIT_UNEXPECTED_FILE | 400: previous `Unexpected field` / `Unexpected field - <field>` message preserved |
| LIMIT_FILE_SIZE | Existing Nest 413 mapping retained |
| Existing field/file/part count, key/value and missing-name errors | Existing Nest 400 mapping retained |
| Recognized malformed Busboy boundary/header/end errors | Existing Nest 400 mapping retained |
| Unknown Multer code, business/storage error or ordinary Error | Rethrown unchanged to existing handling |

There is no blanket catch-to-400, global exception suppression or process-level exception handler. Cause/stack is not serialized in the tested responses. The prior unexpected-field reflection remains a client-supplied JSON string; no filename or stack is added by the bridge. Disconnected clients cannot be promised an HTTP response on a dead socket.

Thirteen permanent Jest cases independently passed, including a harmless marker field whose mocked append-field callback throws TypeError: actual FileInterceptor and NoFilesInterceptor deliver safe 400, skip the handler and handle a later valid request. An additional probe verifies unknown-code rethrow by object identity. Ordinary nested/array/incomplete/escaped field names and missing boundaries pass the rejection tests. No special parser-crash campaign or previously discovered problematic payload was reproduced.

Installed Nest router source invokes guards before the interceptor chain and applies parameter pipes inside the final handler. Student order is error bridge → FileInterceptor → raw Student input interceptor → global DTO pipe → Document handler/service. Staff's existing class-level raw interceptor allows the initial multipart pass when body is absent; its route-level counterpart checks parsed raw input after FileInterceptor. Existing authorization ordering is retained.

## 5. Student Contract

| Route | Text fields | Actual parts | Files | Inclusive file bytes |
| --- | ---: | ---: | ---: | ---: |
| Create | ≤3 | ≤4 | ≤1 | ≤10,485,760 |
| New version | 0 | ≤1 | ≤1 | ≤10,485,760 |

Create permits only scalar string `title`, `documentType`, optional `targetProgramId`. Raw validation rejects unknown/protected keys and array/object values before whitelist can discard them. The unchanged DTO requires title and documentType and validates targetProgramId. Duplicate scalar names accumulate into a non-string and are rejected; bracket nesting is rejected by the parser first. Missing/empty files and disallowed types retain their validation contract. Replacement rejects every text field, including previously ignored fields.

Actual part limits include skipped multipart parts, not just retained fields. Finite field counts plus the existing fieldSize truncation bound prevent unbounded retained Student text accumulation in the tested fixtures. Student fieldSize remains the default 1 MiB: MAX-field−1 passes, equality/+1 reject with 400; no new title-length policy was introduced.

Fresh 184-test Student HTTP/PostgreSQL/MinIO suite passes. File/field order, zero/one/two/three allowed fields, optional owned program, required fields, duplicates/unknown/nested keys, fourth field, replacement extra fields, skipped-part overflow and bounded resource fixtures are exercised.

| File size | Student create | Student new version | Download equality |
| --- | ---: | ---: | --- |
| MAX−1 | 201 | 200 | Exact source bytes |
| MAX | 201 | 200 | Exact source bytes |
| MAX+1 | 413 | 413 | No new row, audit, intent or SDK call |
| MAX+2 | 413 | 413 | No new row, audit, intent or SDK call |

PDF/JPEG/PNG structural/MIME validation and public response fields are unchanged. The independent four-MAX probe additionally verifies exact JWT downloads in a separate client process. If multiple constraints fail, the first parser error can determine 400 versus 413; no successful mutation follows the rejected request.

The extra-field refusal is an intentional Phase 5A.1 compatibility change. A frontend/mobile client sending old ignored metadata must stop sending it; local backend tests do not replace that sign-off.

## 6. Staff Contract

Both upload routes were separately verified by the fresh 216-test Staff HTTP/PostgreSQL/MinIO suite.

| Route | Text fields | Actual parts | Files | fieldSize | Inclusive file bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Staff create | ≤3 | ≤4 | ≤1 | 1024 | ≤10,485,760 |
| Staff new version | ≤2 | ≤3 | ≤1 | 1024 | ≤10,485,760 |

The prior parts settings 5/4 under Busboy equality translated to 4/3 actual parts; the new settings 4/3 under Multer's inclusive behavior preserve those budgets. Valid fields-first/file-first requests and equality/overflow of actual parts pass the expected success/400 cases.

Staff create returns 201 at MAX−1/MAX and 413 at MAX+1/MAX+2; replacement returns 200/200/413/413. Successful files match authenticated downloaded bytes; parser failures retain full documents/audits/intents and every SDK-operation count. Snapshot/CAS input rules, exact expectedUpdatedAt/version, current ADMIN/active assigned EXPERT authorization, foreign portrait/document refusals and archived-object restrictions are preserved. Tests cover concurrent mutations, revocation during upload, mandatory audit rollback, old-object retention, uncertain outcomes and archive/idempotency behavior. No Staff CRUD business code was altered.

## 7. Other Multipart Endpoints

Source search found exactly ten multipart routes: four Document uploads and the six below. No additional MulterModule configuration, custom runtime multer invocation or other File/Files/Any/NoFiles consumer was found outside the listed sites. All receive the bridge before parsing.

| Consumer | Previous → current parser limits | Fresh evidence and limits of evidence |
| --- | --- | --- |
| Billing Payment webhook | NoFiles; no explicit count/parts/size limits → same | Actual controller/NoFiles HTTP probes retain ordinary and unknown signed scalar fields, return XML/200, reject a file/missing boundary/truncated text with 400. Payment service is stubbed in those probes. Standard integration separately exercises real payment verification/settlement with existing fixtures. No claim of complete provider multipart acceptance. |
| Contract Scan | fileSize 10 MiB exclusive, files 1 → fileSize 10 MiB−1 inclusive, files 1 | Actual controller probe: 10,485,759 succeeds, 10,485,760/761 return 413, successful parser bytes identical. Scan business service is stubbed for this boundary probe; real access/scan scenarios pass standard PostgreSQL integration with its existing storage fixture. |
| Organisation logo | No explicit parser limits → same; service ≤512 KiB | Actual controller and actual service methods with stubbed repo/upload dependencies: exact business maximum succeeds, maximum+1/MIME/missing file return 400; uploaded bytes identical. |
| Organisation cover | No explicit parser limits → same; service ≤2 MiB | Same evidence as logo; inclusive service maximum preserved. |
| QS Import | FileInterceptor(file), no explicit parser limits → same | Actual controller/service with stubbed queue/repo: generated valid XLSX enqueues byte-exact base64 and coerced valid limit; invalid DTO returns 400. Existing missing-file 500 remains 500, not hidden by the bridge. Full asynchronous import completion is not verified by this probe. |
| Student Task file | FileInterceptor(file), no explicit parser limits → same | Actual controller/TaskService/UploadService with stubbed repo/MinIO dependency: valid upload preserves bytes; missing/empty file 400. |

Additional ordinary probes across every file route reject unexpected/duplicate files, missing boundary and 1 MiB text truncation with 400, without dependency mutations. There are **43 independent probe assertions**, including unknown-error handling; none is added to repository-test totals. Authentication guards are substituted only in this supplementary fixture, so it is parser/service-boundary evidence rather than fresh RBAC proof for these six consumers.

No unintended ordinary byte/field/part-limit regression was observed. Default unbounded aggregate fields/file bytes on some non-Document routes remain inherited operational exposure; the global update does not establish comprehensive resource hardening there. New WHATWG decoding for escaped names/filenames is a real upstream behavior change. Compatibility of clients relying on literal escaped names or unusual filenames is **NOT VERIFIED**; normal supported keys are verified. No external frontend/browser/provider sign-off was supplied.

## 8. Authorization/DB/Storage Safety

The unchanged installed Nest lifecycle and actual Document JWT/Roles/mutation guards execute before multipart parsing. Student/Staff tests cover no JWT →401, foreign ownership refusal, blocked/deleted users or roles, inactive/unassigned EXPERT and archived documents under existing status contracts. A forged JWT role does not replace current database authorization.

Parser and validation tests compare all Document rows and all AuditLog rows, including technical storage intents, rather than only business-row counts. SDK instrumentation observes every send call, including reads, Put and Delete. The independent separate-process fixture hashes complete ordered row/journal serialization before/after and compares that hash and SDK count; tested bounded fields, duplicate/unknown/nested keys, replacement extra text, no JWT, foreign actor and MAX+1 leave them unchanged. Source and permanent tests provide the broader blocked/deleted/staff matrix.

Authorization guards can perform database reads; the claim is no Document/business/journal mutation and no MinIO SDK operation on the tested early refusals. Source hashes confirm no edits to DocumentService, CAS, journal, storage/recovery, private old-object retention or soft-delete. Existing concurrency, audit rollback and storage-security tests all pass.

Late storage outcomes are distinct: after attempted PutObject or uncertain commit, an existing PENDING intent and retained new bytes may be correct recovery safety. Passing parser-refusal snapshots does not change that protocol, prove arbitrary destructive cleanup safe, or authorize automatic recovery. Existing regression fixtures retain this distinction.

## 9. Resource Verification

Docker was checked before side effects: context `desktop-linux`; Unix socket `/Users/johnycarlson/.docker/run/docker.sock`; local daemon `docker-desktop`, ID `e81f8b6b-b538-4244-af19-5f28df16c535`; no DOCKER_HOST/DOCKER_CONTEXT override. No remote context or existing application container was used.

This audit created owner-labelled disposable PostgreSQL 16.0 and Redis 8-alpine, published only on loopback, with 1 GiB / 256 MiB memory bounds. Existing storage runners built the unchanged checksum-pinned MinIO test image from release `2025-10-15T17-29-55Z` and owned/cleaned their own loopback containers. A separate audit-owned MinIO with a 512 MiB bound served the independent resource probe. All data/credentials were synthetic, dotenv was disabled and no external business providers were invoked.

Existing bounded Student fixtures (100,000 small fields; 64 half-MiB fields; four concurrent finite field-heavy requests) passed with bounded retained fields and unchanged snapshots/SDK operations. These were existing requested regression scenarios, not an added stress/OOM campaign. Correct small files, parser count/part refusal and 400/413 contracts continue working.

An additional bounded probe used actual compiled Document services/guards, real PostgreSQL/MinIO, a separate Nest server process and a separate HTTP client process. Four concurrent 10,485,760-byte valid PDF uploads all returned 201 and produced distinct rows. Every JWT download returned 200 and byte-exact contents (SHA-256 `b92fefee483c75a2f2fce3d147bcbf87c4e9f0637f4df13c62548aa8ae772937`).

| Server-only measurement | Baseline bytes | Sampled peak bytes |
| --- | ---: | ---: |
| RSS | 321,994,752 | 419,184,640 |
| heapUsed | 78,350,672 | 83,383,432 |
| external | 27,531,679 | 100,938,202 |
| arrayBuffers | 21,172,683 | 94,579,262 |

Batch upload wall time: **431.80 ms**. Individual upload latencies: **412.19, 426.08, 427.94, 426.54 ms**. Forty samples at a 10 ms interval; sampling is not an exact instantaneous maximum. Measurements include Nest, Prisma and SDK in the server process, exclude the client, and describe one synthetic local run. Existing repository benchmarks include client/server in one process and are explicitly not substituted for these server-only figures.

Ingress total-body limits, request/idle timeouts, parser error draining and aggregate concurrent Buffer/storage-copy memory still require operator budgets. The parser drains an errored request before completion; finite retained fields do not cap arbitrary incoming wire bytes or a slow sender. No production capacity conclusion follows from four uploads or local latency. No destructive/OOM probes or special parser process-crash scenarios were run.

All three audit-owned containers were removed only after exact owner-label and loopback-binding verification. Runner-owned containers were cleaned by their unchanged ownership-aware runners. Pre-existing containers and user files were left untouched. Evidence: `infra-evidence.json`, `resource-results.json`, and existing benchmark records in `private-api.log`.

## 10. Full Regression Results

Tests ran from the byte-identical temporary project `/private/tmp/oxus-phase5a12-review/project`. Every database runner created fresh migrated disposable databases; standard integration also checked migration drift. Environment was explicit synthetic loopback configuration with `DOTENV_CONFIG_PATH=/dev/null`. No repository mutation was needed to obtain these results.

| Gate | Fresh result | Unique-test treatment |
| --- | --- | ---: |
| Full Jest | PASS; 54 suites, 720 tests | 720 |
| Standard integration | PASS; 24 TAP summaries, 407 tests; smoke exit 0 | 407 |
| Student HTTP/PostgreSQL/MinIO | PASS; 184 tests | 184 |
| Staff HTTP/PostgreSQL/MinIO | PASS; 216 tests | 216 |
| MinIO foundation | PASS; 20 tests | 20 |
| Storage runner security | PASS; 13 tests | 13 |
| Observation runner | PASS; CLI 26 + PostgreSQL 25 | Already included in integration |
| Document HTTP security runner | PASS; 80 tests | Already included in integration |
| OpenAPI / Document schema migration | PASS; 18 / 4 tests, plus standard migration/drift checks | Already included in integration |
| Prisma validate / generate | PASS / PASS | — |
| Nest build / TypeScript noEmit | PASS / PASS | — |
| TS / all test MJS lint | PASS / PASS | — |
| Clean immutable Yarn install | PASS; full install with scripts, unchanged manifest/lock | — |
| Git unstaged/cached diff checks | PASS / PASS; empty index | — |

**720 + 407 + 184 + 216 + 20 + 13 = 1560 unique passing repository tests.** Repeated observation/security runners, 43 supplementary assertions and the independent resource probe are excluded. There is no unfinished mandatory local regression gate.

Evidence is fresh in `/private/tmp/oxus-phase5a12-review/`: `prepare-gates.json`, `checks-gates.json`, `jest-gates.json`, `jest-results.json`, `integration-gates.json`, `private-gates.json`, `supplementary-gates.json`, `tap-summary.json`, individual logs, `other-multipart-results.json`, `resource-results.json` and integrity/infra manifests. Temporary artifacts are local evidence, not trusted hosted CI or release artifacts.

Execution limitations were handled without code edits: sandbox denied Docker socket access and Prisma engine-cache access; those actions were rerun with approval. Initial Prisma sandbox failure was environmental; the approved final validate/generate/build all passed. The first Docker readiness inspection occurred while the PostgreSQL image pull was still running; readiness was subsequently verified before any DB gate. Neither attempt is counted as a passing test. No test/assertion was changed to turn a failure green.

## 11. Findings P0–P3

| Finding | Severity / status | Review disposition |
| --- | --- | --- |
| New P0/P1/P2 in combined scope | None confirmed | No observed authorization regression, contract failure or ambiguous runtime resolution |
| F-5A-R01: unbounded Student retained fields/parts | Inherited P2; CLOSED for reviewed implementation | Finite counts/actual parts, raw admission, fresh bounded fixtures and snapshots confirm remediation |
| Parser field-construction exception escaping callback | Inherited availability defect; CLOSED for targeted remediation | Fixed installed upstream callback path, zero Document nesting and safe synthetic exception regression; historical problematic payload deliberately not replayed |
| F-5-01: exact 10 MiB Student rejection | Previously remediated; remains CLOSED | Fresh four-route MAX−1/MAX/MAX+1/MAX+2 matrix and real downloads pass |
| F-5A12-N01: Nest exact dependency pin versus root resolution | P3 maintenance note; OPEN | Single fixed runtime parser and clean immutable installation verified; retain reviewed Yarn install discipline and reevaluate override on upgrades |

Closing the targeted parser finding does not assert that every possible multipart payload is safe. No historical failure result or previous self-check was counted as fresh evidence. No new backend fix is required by this review.

## 12. Remaining Risks

- **Operational gaps:** C01–C14 Test operator evidence, ingress body/time/draining/concurrency budgets, actual storage IAM/version compatibility, trusted hosted CI, immutable digest and release controls remain open. These cannot be closed by source review or local test success.
- **External evidence unknown:** browser/mobile/provider sign-off, old clients sending extra Student metadata, and clients relying on literal WHATWG-escaped field/filename spelling. Ordinary route probes establish a narrower compatibility claim.
- **Dependency maintenance:** exact-pin override is deliberate; `npm ls` remains non-clean. Types do not fully describe new optional Multer settings/codes; current runtime configuration and compile checks pass. No switch to npm installation is approved by this review.
- **Inherited resource exposure:** some non-Document consumers retain unbounded aggregate parser fields/file bytes and business validation after buffering. No general concurrency limiter or ingress control was added. Local bounds do not establish production memory safety at arbitrary concurrency.
- **Storage/deployment compatibility:** source-built October MinIO with synthetic root credentials verifies the relevant local S3 behaviors, not the actual Test June binary, architecture, least-privilege identity/policies or production environment. PG16.0/Redis8 local evidence is not exact CI/server configuration attestation.
- **Inherited safety constraints:** legacy public retention/exposure, old objects/orphan capacity, observation freshness/cost, arbitrary-writer cleanup and existing recovery design gaps remain. PENDING after unknown Put/commit outcome is expected; it is not a parser regression.

U1/U2/G1 and automatic destructive recovery remain **NOT APPROVED**. Legacy migration, rollback activation and production rollout were not approved or exercised.

## 13. Backend Commit Gate

**PASS WITH NOTES.** Phase 5A.1 and Phase 5A.2 are independently confirmed within the reviewed local backend scope. Runtime parser identity, callback/error handling, Student/Staff limits, ordinary multipart compatibility and existing security/storage contracts pass the fresh gates. No blocking new P0/P1/P2 was identified.

The combined candidate is suitable for a **separate authorized Git task**. Recommended packaging: **one combined commit** for the current reviewed worktree. The Multer upgrade/resolution, inclusive byte/part configuration and compatibility bridge must travel together. Omitting the resolution can retain an old Nest parser; omitting the limit adaptation changes budgets; omitting the bridge changes public errors. Phase 5A.1/5A.2 also share controller/test hunks. This review approves the final combined state, not an independently reconstructed intermediate state. Separate phase commits would require review/testing of every intermediate tree.

No Git add/commit/push was executed. The note about the ignored report is informational; nothing was force-added. Release/deployment permission does not follow from this commit gate.

Direct answers: **(1)** both phases confirmed for this scope; **(2)** Nest uses the single Multer 2.4.0; **(3)** known parser errors are safely mapped, unknown errors remain diagnostic; **(4)** Student/Staff budgets and inclusive 10 MiB hold; **(5)** no ordinary regression observed in other routes, unusual/external clients remain unverified; **(6)** authorization/CAS/audit/storage guarantees exercised by the existing suites remain intact; **(7)** 1560 unique tests; **(8)** no new confirmed P0/P1/P2; **(9)** ready for a separate Git task with notes; **(10)** one combined commit recommended; **(11)** Test blockers below remain.

## 14. Test Deployment Gate

**NOT READY.** Independent local review is now complete, but it does not supply external/operator/release evidence. Required controls remain those in the [deployment readiness plan](student-documents-test-deployment-readiness.md) and [Phase 5 rehearsal report](student-documents-phase5-test-rehearsal-report.md):

| Control | Outstanding actual Test evidence |
| --- | --- |
| C01 | Exact release authority, branch/environment protections and hold before SSH |
| C02 | Trusted installed scripts/Compose/overrides, file permissions and server identity |
| C03 | Effective Test configuration, origins, separate JWT/storage settings |
| C04 | Test-only DB/storage/queues/accounts/providers and absence of live business effects |
| C05 | Actual migration ledger/checksums/schema/constraints and reviewed pending SQL |
| C06 | Checkpoint, retained backup, matching-version real restore receipt and RPO/RTO |
| C07 | Actual private storage policy/ACL/anonymous denial and application IAM compatibility |
| C08 | Matching server images/architecture/configuration and accepted capacity budgets |
| C09 | Trusted publish, provenance and immutable backend/migrator registry digest |
| C10 | TLS/auth/CORS/client boundary, body/time/concurrency/draining budgets |
| C11 | Maintenance/writer freeze, timeout/escalation and verified rollback/roll-forward plan |
| C12 | Prepared synthetic acceptance smoke and actual release/client/QA sign-off |
| C13 | Explicit temporary legacy exposure/retention acceptance; no migration/delete authorization |
| C14 | Effective recovery/observation state, private monitoring and manual escalation |

Also required: external frontend/browser/mobile compatibility sign-off for stricter Student fields and changed parser behavior; trusted CI of the eventual committed candidate; reviewed immutable artifact/digest; release controls and separate deployment authorization. No Test connection, policy change, migration or smoke write occurred here. Local closure of F-5A-R01/F-5-01 does not close C01–C14.

## 15. Production Deployment Gate

**NOT READY.** Actual operator/client/release controls, production IAM/backup/restore/proxy/capacity/monitoring and compatible recovery/roll-forward evidence remain outstanding. Test acceptance would be a later prerequisite, not automatic production approval.

U1/U2/G1, legacy migration and automatic destructive recovery remain **NOT APPROVED**. This review authorizes no deployment, automatic rollback or destructive recovery action.
