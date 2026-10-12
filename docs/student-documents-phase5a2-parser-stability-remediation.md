# Phase 5A.2 — Multipart Parser Stability & Compatibility Remediation

Date: 2026-10-10 (Asia/Almaty). Scope: local implementation and regression; independent Final Review remains pending.

## 1. Executive Summary

**Parser field-name stability remediation: implemented and verified for Document uploads. Backend Commit Gate: PASS WITH NOTES, ready for independent Final Review. Test Deployment Gate: NOT READY. Production Deployment Gate: NOT READY.**

Multer is pinned to **2.4.0**, including the copy resolved by Nest platform-express. Its guarded append-field callback converts synchronous field-construction exceptions into the normal middleware error path. Document routes additionally reject bracket nesting before append-field through `fieldNestingDepth: 0`. A focused Nest interceptor maps newly introduced/renamed Multer errors to safe HTTP 400; unrelated errors retain their existing handling and diagnostics.

All four Document upload routes retain the inclusive **10,485,760-byte** file contract. Student create remains at three text fields/four actual parts, replacement at zero text fields/one actual part. Staff text, snapshot, CAS and actual part budgets are preserved. MAX−1/MAX succeed with authenticated byte-exact downloads; MAX+1/MAX+2 return 413 without DB/SDK mutations. Malformed/unknown/duplicate fields return 400; authentication and ownership refusals precede parsing.

**1560 unique repository tests PASS = 1494 baseline + 66 new.** No failing, skipped, cancelled, todo or pending tests in the final runs. No new open P0/P1 identified within this remediation. The inherited parser stability defect is closed in implementation/self-check, subject to independent confirmation. This is not a guarantee of arbitrary upload concurrency or transport capacity.

No commit, staging, push, deployment, Test/Production connection, schema/migration change, recovery activation or user-file deletion occurred. Existing Phase 5A.1 work remains in the worktree. Git index is empty.

## 2. Git/Dependency Baseline

- HEAD before/after: `9088307591ea29c57a599c9d54a4eae16ad952da`.
- Branch: `release/manual-contract-candidate`.
- Initial index: empty. Initial worktree: modified `document.controller.ts`, `document-private-api.test.ts`, `document-security-http.test.ts`; new `student-document-create-input.interceptor.ts`.
- Preflight file copies and tracked-file SHA-256 manifest: `/private/tmp/oxus-phase5a2/baseline/` and `baseline-hashes.json`. No reset/restore/clean/rebase used.
- Before: Nest common/core/platform-express **11.1.21**; Multer **2.1.1**; Busboy **1.6.0**; append-field **1.0.0**; Multer types **2.1.0**; Prisma **7.8.0**; Node **22.15.1**; package manager **Yarn 4.18.0** with node-modules linker and `yarn.lock`.
- After: only Multer changes to **2.4.0**; Nest, Busboy, append-field, types and Prisma versions remain unchanged. Multer no longer depends on concat-stream; its now-unused concat-stream/typedarray lock entries disappear. No unrelated package update.

Read [Phase 5A.1 report](student-documents-phase5a1-multipart-hardening-report.md) and [Phase 5A final review](student-documents-phase5a-final-review.md). Historical evidence from `/private/tmp/oxus-phase5a1-independent-bufi884g/` was inspected: `gates.json`, `real-suites.json`, `probes.json` (144 successful records), and the existing parser-result metadata. The latter records server exit 1 with unchanged DB/no SDK operations. Those historical results are not new successful stability tests and are not added to today's count. No historical failure payload was rerun or copied into this report.

## 3. Root Cause and Compatibility

Installed 2.1.1 called append-field directly in Busboy's asynchronous field listener. Exceptions there escaped the normal Multer callback/Nest pipeline; post-parser raw-field validation could not intercept them. Count limits alone cannot prevent an exception in a single field's construction. The official [crafted-field advisory](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm) identifies versions before 2.3.0 as affected.

The [2.4.0 middleware source](https://github.com/expressjs/multer/blob/v2.4.0/lib/make-middleware.js) wraps append-field in try/catch and uses `INVALID_FIELD_NAME` on failure. Nesting and array-index checks run before append-field when configured. The installed middleware is byte-identical to the downloaded official tag source. append-field itself is still 1.0.0; protection is in its caller. Document `fieldNestingDepth: 0` blocks bracket paths, including numeric indexes, before construction.

The [release changelog](https://github.com/expressjs/multer/blob/v2.4.0/CHANGELOG.md) establishes important compatibility changes: 2.3 makes fileSize inclusive; 2.4 makes parts inclusive and renames the unexpected-file message. Thus retaining previous sentinels would expand actual parser budgets. Text-field count and fieldSize behavior remain unchanged. Filename/name WHATWG decoding is also documented; supported Document scalar keys are unaffected, unusual literal escaped names are not promised identical semantics.

The installed Nest adapter transforms errors by **message**, not Multer code. New `INVALID_FIELD_NAME`, nesting/index limits, `STREAM_DESTROYED`, and renamed unexpected-file errors otherwise fall through as generic 500. Its callback-based FileInterceptor/NoFilesInterceptor APIs and memory-storage contract remain compatible with 2.4.0; real HTTP tests verify that claim.

The [official Nest 11.2.3 manifest](https://registry.npmjs.org/@nestjs%2fplatform-express/11.2.3) still pins Multer 2.2.0, below the crafted-field fix. Upgrading that adapter alone is insufficient. A Nest major migration is outside this task. No other dependency upgrade is needed for the selected remediation.

**Resolution caveat:** Nest 11.1.21 declares exact Multer 2.1.1. Updating only the application's direct dependency could retain a vulnerable nested copy. The documented [Yarn resolutions mechanism](https://yarnpkg.com/configuration/manifest#resolutions) forces all copies to 2.4.0. Yarn `why`, immutable install and a permanent identity/version test confirm the application and Nest resolve the same fixed implementation. `npm ls` labels this deliberate override `invalid` against Nest's declared pin and exits ELSPROBLEMS; it is not being reported as a clean npm tree or native upstream support for this exact version combination. Compatibility is supported by source inspection and the complete local regression. Install with the declared Yarn manager; review the override when updating Nest.

## 4. Selected Remediation

1. Pin direct Multer and root Yarn resolution to 2.4.0; regenerate only the necessary lock entries.
2. Add `MulterExceptionInterceptor` immediately before the built-in multipart interceptor. Apply it to every existing FileInterceptor/NoFilesInterceptor site to avoid introducing new raw-Multer 500 responses elsewhere.
3. Remove obsolete Document byte/part sentinels, maintaining actual previous budgets. Set Document nesting depth to zero; existing DTO/raw-input restrictions already require scalar exact fields.
4. Preserve the separate contract-scan endpoint's previous exclusive parser boundary using an inclusive setting of `10 MiB - 1`. Its prior exact-10-MiB rejection is not silently expanded by the dependency change. Other non-Document endpoint limits are unchanged.
5. Add focused permanent tests; leave all business/storage/auth/schema/recovery code untouched.

Multer 2.2.0 does not include the required exception conversion. 2.3.0 includes it, but 2.4.0 is the current stable release and includes subsequent cleanup fixes; its additional limit/message changes are explicitly accommodated. No vendored parser, fork, global admission limiter or blanket exception handler was added.

## 5. Updated Error Handling

The interceptor uses the documented Nest/RxJS interceptor error path and checks actual `MulterError` instances and codes. New name/nesting/index/stream codes return `BadRequestException("Invalid multipart input")`. The underlying error is retained as `cause` and is not serialized. No stack, parser internals or filenames are exposed in these responses. See [Nest error handling documentation](https://docs.nestjs.com/interceptors) and [exception/cause documentation](https://docs.nestjs.com/exception-filters).

Renamed `LIMIT_UNEXPECTED_FILE` retains the earlier `Unexpected field` public message and standard `statusCode/message/error` JSON shape. Existing `LIMIT_FILE_SIZE` still reaches Nest's 413 mapping; count/key/value/part and recognized Busboy malformed-input errors still use Nest's 400 mapping. Unknown Multer codes, ordinary exceptions and business/storage failures are rethrown unchanged for existing diagnosis; this is not a catch-all conversion of every failure to 400.

JWT/RBAC and mutation guards still run before interceptors. Parser refusal never reaches the Document handler or private-storage service. A disconnected request may have no deliverable HTTP response; no claim of a response on a dead socket is made. No uncaughtException handler or process-level suppression was introduced.

## 6. Student/Staff Contract Preservation

| Route | Text fields | Actual parts | File bytes | Other existing constraints |
| --- | ---: | ---: | ---: | --- |
| Student create | ≤3 | ≤4 | ≤10485760 | title/documentType, optional targetProgramId; unique scalar keys |
| Student new-version | 0 | 1 | ≤10485760 | file-only; ownership guard |
| Staff create | ≤3 | ≤4 | ≤10485760 | strict title/type/program validation, fieldSize 1024 |
| Staff new-version | ≤2 | ≤3 | ≤10485760 | expectedVersion/expectedUpdatedAt snapshot; fieldSize 1024 |

All routes allow one file and reject multiple files. Student fieldSize remains the existing default: values at its truncation boundary still return 400. Existing size/content validator is unchanged. Part budgets count skipped parts, not just file/text values retained in body. New permanent Staff tests verify equality and next-part rejection; existing Student tests verify the same actual bound.

Valid Student/Staff create and replacement with fields-first/file-first retain response serialization, version/CAS behavior and exact private download bytes. Duplicate/unknown/nested fields remain 400. No JWT remains 401; foreign student replacement remains 403. Existing staff role/assignment/portrait authorization matrices pass.

When several constraints are violated, first parser failure still determines the response: extra fields can yield 400 before an oversized file, while an oversized file arriving first can yield 413. This does not authorize or persist the rejected request.

## 7. Regression Evidence

Fresh evidence: `/private/tmp/oxus-phase5a2/`, including `*-gates.json`, `jest-results.json`, `regression-summary.json` and individual gate logs. Runs use explicit synthetic environment, `DOTENV_CONFIG_PATH=/dev/null`, fresh migrated databases and loopback-only services. No project .env or external service configuration is used.

Docker locality was checked before creation: desktop-linux, local Docker Desktop Unix socket, daemon ID `e81f8b6b-b538-4244-af19-5f28df16c535`. This task created its own labeled PostgreSQL 16.0 and Redis 8 containers with memory/CPU bounds; standard storage runners created and removed their own real source-built MinIO containers. Pre-existing audit containers were not reused or altered. Cleanup is restricted to this task's verified owner labels. Exact production MinIO image compatibility is not asserted.

| Gate | Result | Unique count treatment |
| --- | --- | --- |
| Full Jest | 54 suites, **720 PASS** | 720 |
| Standard integration | 24 TAP summaries, **407 PASS**, smoke exit 0 | 407 |
| Student HTTP + PostgreSQL/MinIO | **184 PASS** | 184 |
| Staff HTTP + PostgreSQL/MinIO | **216 PASS** | 216 |
| MinIO foundation | **20 PASS** | 20 |
| Storage runner security | **13 PASS** | 13 |
| Observation runner | CLI 26 + PG 25 PASS | Already in integration |
| Document HTTP security runner | 80 PASS | Already in integration |
| OpenAPI / Document schema migration | 18 / 4 PASS; standard migration drift checks PASS | Already in integration |
| Prisma validate / generate | PASS / PASS, client 7.8.0 | No test count |
| Nest build / TypeScript noEmit | PASS / PASS | No test count |
| TS lint / all test MJS lint | PASS / PASS | No test count |
| Yarn immutable install | PASS; same fixed Multer resolution | No test count |
| Git diff / cached diff check | PASS / PASS; index empty | No test count |

**720 + 407 + 184 + 216 + 20 + 13 = 1560 unique tests.** New: 13 Jest + 25 Student + 28 Staff = **66**. No repeated runner, focused test rerun, prior audit probe or diagnostic attempt is counted twice.

New fixtures are small: non-scalar/malformed field names, absent boundary, field/file ordering, authorization-before-parser and Staff part equality/overflow. Full snapshots compare all Document and AuditLog rows (including intent journal), plus **every SDK call**, proving no writes or other SDK operations for parser rejection. Valid tests use real storage and byte-exact authenticated downloads.

The append-field exception path is tested by injecting a deterministic TypeError into the dependency on a harmless marker field in Jest; production code contains no test hook. Actual Nest FileInterceptor and NoFilesInterceptor return safe 400, skip the handler and successfully process the next valid request. This validates the previously unguarded asynchronous callback path without reproducing an outage payload. Direct code-mapping tests retain diagnostic cause and preserve unrelated errors. The full required repository suites were run unchanged in scope, including existing bounded/resource fixtures; no new destructive/OOM/stress campaign was performed.

Initial diagnostics are not hidden: a sandbox run could not bind a test socket and was rerun with loopback permissions. A new-test assertion caught Nest's absent error-description when supplying cause options; the interceptor now explicitly preserves `Bad Request`. Lint initially found a require-style import and formatting; both were fixed, with focused tests and all final static checks passing. These attempts are excluded from final totals.

## 8. Findings P0–P3

| Finding | Severity / status | Disposition |
| --- | --- | --- |
| F-5A2-PARSER | Inherited availability defect; P1, CLOSED in implementation/self-check | Fixed upstream append-field error path, pre-append Document nesting bound, safe adapter conversion; independent review pending |
| F-5A-R01 | P2 CLOSED in Phase 5A.1 implementation, preserved | Finite Student fields/actual parts and raw exact-key validation remain |
| F-5-01 | P2 CLOSED, preserved | Inclusive four-route 10 MiB matrix and real download bytes pass |
| New open P0/P1 | None identified within this scope | No auth bypass, DB/storage mutation on parser rejection or Student/Staff regression observed |
| Nest exact dependency pin | P3 compatibility/maintenance note | Deliberate Yarn resolution; npm diagnostic documented; remove override only after upstream adapter evaluation |

Historical Phase 5A.1's earlier “no P0/P1” statement is not rewritten; later independent parser evidence exposed the inherited stability defect. This report records its remediation rather than treating old successful multipart probes as proof of safety.

## 9. Changed Files

Phase 5A.2 adds/changes **14 files**:

- `package.json`, `yarn.lock`: exact Multer resolution.
- `src/common/interceptors/multer-exception.interceptor.ts` and `.spec.ts`: focused compatibility handler and 13 tests.
- `src/modules/document/api/document.controller.ts`, `staff-document.controller.ts`: inclusive actual limits, zero nesting, compatibility interceptor.
- `src/modules/billing/api/payment.controller.ts`, `contract/api/contract-scan.controller.ts`, `organisation/api/organisation.controller.ts`, `qs-import/api/qs-import.controller.ts`, `task/api/student-task.controller.ts`: same focused interceptor at existing parsing sites; scan boundary adaptation.
- `test/document-private-api.test.ts`, `test/document-staff-api.test.ts`: 25/28 new tests, existing tests retained.
- This remediation report.

The initial Phase 5A.1 modifications remain. `test/document-security-http.test.ts` and `student-document-create-input.interceptor.ts` are byte-identical to preflight. Student controller changes retain the Phase 5A.1 semantics while updating limits to the new library's equality rules. Hash checks confirm no edits to DocumentService, private MinIO services, JWT/RBAC/ownership implementation, AuditLog, CAS/recovery, Prisma schema/migrations, CI or deployment files. Existing reports are untouched.

Reports under docs are ignored by the existing repository rule; this new report exists on disk and was not staged. Generated/build outputs are not staging candidates. No user files were removed.

## 10. Remaining Risks

- External browser/mobile/client sign-off remains pending. Phase 5A.1's intentional rejection of legacy extra fields must be communicated. Unusual literal WHATWG-escaped field/filename consumers require compatibility review; normal supported fields are verified.
- Non-Document routes receive the new exception bridge, but retain their existing field/nesting/resource configuration. This work does not claim comprehensive resource bounds or capacity guarantees for every upload endpoint.
- Parser limits do not replace proxy body/time/concurrency budgets or bound slow request draining. Existing operational admission/capacity gates remain; no limiter was added.
- The Yarn override is intentional and reproducible, but differs from Nest 11.1.21's declared exact pin. Future Nest/type/parser changes require a new compatibility check. Three pre-existing Prisma Studio peer warnings remain; no Multer peer warning is introduced.
- Historical F-2B1-03/F-2B1-04 and observation capacity/freshness risks remain. General runners were not made safe for arbitrary remote Docker contexts; locality was checked externally for this run.
- Local synthetic regression does not attest hosted CI, release artifacts, actual Test ingress/IAM/backups or production capacity. AV/full decoder validation, legacy public exposure and old-object retention boundaries are unchanged.

## 11. Backend Commit Gate

**PASS WITH NOTES — implementation is ready for independent Final Review.** Source, dependency-resolution and HTTP compatibility are confirmed, all mandatory local checks pass, and protected behavior is preserved. Required next step: independent review of dependency override, narrow error mapping, actual limit equality and regression evidence. No commit authorization is inferred from this gate; no commit/staging was performed.

If independent review does not confirm the override/contract compatibility, return this gate to NOT READY and resolve the blocker before a commit. Do not publish a partially validated candidate.

## 12. Test Deployment Gate

**NOT READY.** Before Test: independent Final Review/sign-off; separate commit/release/deployment authorization; trusted CI and immutable artifact/digest; external client compatibility; C01–C14 actual operator evidence (trusted files/server/config, isolated DB/storage/queues/providers, migration ledger/checksum/drift review, real backup/restore and RPO/RTO, private bucket/IAM/anonymous denial, TLS/proxy/body/time/concurrency budgets, maintenance/writer freeze and preserving roll-forward/rollback plan, synthetic acceptance and monitoring freshness/alerts). No Test connection, workflow dispatch, SSH, smoke write or deployment occurred.

**U1/U2/G1: NOT APPROVED. Automatic destructive recovery: NOT APPROVED.** Existing recovery/retention decisions remain separate.

## 13. Production Deployment Gate

**NOT READY.** Requires completed Test acceptance plus separate Production authorization, immutable release provenance, effective isolation/IAM/private storage, backup/restore, ingress/capacity, monitoring and recovery controls. Local PASS does not authorize Production operations.

**U1/U2/G1 and automatic destructive recovery remain NOT APPROVED.** No push/deployment or remote environment access occurred. HEAD remains unchanged and Git index empty.
