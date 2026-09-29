# Manual contracts and expert lead stages

This release changes the expert's contract workflow. Coordinate the backend and frontend rollout: preparing a new lead contract now returns `contract: null` and a `draft`; it no longer creates a user. Existing user/profile fields and existing records remain intact. All routes below use the `/api/v1` prefix.

## Business rules

- New contracts cost **1,500,000 KZT**, or **750,000 KZT** for Cambridge Line. The selected price identifies Cambridge Line; there is no separate membership checkbox or verification service.
- `paymentType`: `FULL` (default, one payment) or `INSTALLMENT` (expert enters the director-approved count). Installments require an explicit integer count of 2–120; 120 is a technical input limit, not a predefined commercial plan.
- Equal shares are provisional pending the director's confirmation. The backend allocates rounding in tiyn: shares differ by at most 0.01 KZT and sum exactly to the contract price. Preview the schedule instead of calculating it in the browser.
- The expert confirms paper signature and actual receipt of the full amount or first installment. No scan or receipt upload is required to close the lead.
- The new account, portrait, contract, expert assignment, benefits and first receipt commit in one transaction. Account invitation delivery starts only after commit. A reused account keeps its credentials and does not receive a new activation invitation.
- `SIGNED` on a contract with a payment plan means manually signed with an outstanding balance. `PAID` means all scheduled payments have been received. Both appear in the expert's signed-lead tab.
- Further installments are confirmed manually. This release does not charge cards, send collection reminders or block student access for late payments.

## Frontend API

### Prepare or edit a draft

`POST /expert/leads/:id/contract` enters `CONTRACT_PENDING` (На подписании). Repeating POST returns the saved draft. `PATCH` on the same URL replaces the complete draft before the signature is recorded. A signed draft is frozen.

```json
{
  "firstname": "Алия",
  "lastname": "Омарова",
  "middlename": "Сериковна",
  "email": "student@example.test",
  "phone": "+77001234567",
  "subscriptionTier": "EXPERT_MENTORSHIP",
  "price": 1500000,
  "currency": "KZT",
  "paymentType": "INSTALLMENT",
  "installmentCount": 3,
  "parent": {
    "firstname": "Марат",
    "lastname": "Омаров",
    "middlename": "Серикович",
    "phone": "+77007654321"
  }
}
```

Unprefixed identity fields always belong to the student. The `parent` object is required when `lead.role === "parent"`; it is optional for a student lead. Parent email/phone and both patronymics are optional. Original lead contacts and submissions are preserved; names are never split heuristically. Existing optional service dates remain supported.

Response: `{lead, contract: null, draft: {leadId, data, signedAt, createdAt, updatedAt}, invitationRequired: false}`. Read the draft via `GET /expert/leads/:id` (`contractDraft`). Draft edits and signature recording do not change the stage-entry timestamp.

### Preview equal installments

`POST /contracts/payment-schedule/preview` (EXPERT or ADMIN):

```json
{"price":1500000,"currency":"KZT","paymentType":"INSTALLMENT","installmentCount":3,"firstPaidAt":"2026-01-31T15:00:00+05:00"}
```

Returns `price`, `currency`, `paymentType`, `installmentCount`, and `installments` with `number`, decimal-string `amount`, and `dueDate`. Preview does not save or confirm anything; a future proposed date is allowed.

Dates are calculated using **Asia/Almaty**. January 31 → February 28 → March 31. In leap years February 29 is used. `dueDate` is a calendar date, serialized at UTC midnight; display its YYYY-MM-DD part without shifting it to another timezone.

### Record paper signature without closing the lead

`POST /expert/leads/:id/contract/signature`:

```json
{"signedAt":"2026-01-30T15:00:00+05:00"}
```

The expert attests that the paper contract was signed. The lead remains На подписании and no account exists yet. Dates must contain a time and timezone and cannot be in the future.

### Confirm receipt and close the lead

`POST /expert/leads/:id/contract/confirm`:

```json
{"paidAt":"2026-01-31T15:00:00+05:00","amount":500000}
```

`signedAt` may also be supplied here instead of a separate signature call. `amount` must exactly match the full payment or scheduled first installment. `paidAt` is the actual receipt timestamp, not the time of data entry. The monthly schedule always starts from it, even if signature and payment occurred on different days.

Response: `{lead, contract, invitationRequired}`. The lead becomes `CONVERTED`, and `contract` includes the saved payment schedule. Each installment has `number`, `amount`, `dueDate`, `paidAt`, `confirmedAt` and `confirmedByUserId`. The confirmation is idempotent for identical data; changing the recorded payment/signature on retry returns 409.

If both normalized contacts match an existing student, confirmation returns 409 with `code: EXISTING_STUDENT_CONFIRMATION_REQUIRED` and `studentId`. After explicit user confirmation, repeat with `existingStudentId`. Contact mismatches, another expert's student and an existing contract are rejected. Draft preparation alone does not reserve an existing student; ownership is rechecked at confirmation.

### Confirm later payments

`POST /contracts/:id/installments/:number/confirm` with `{paidAt, amount}`. Only the assigned expert or an administrator may confirm. Payments must match the scheduled amount and be confirmed in chronological order. Identical retries do not duplicate receipts or benefits. The last payment sets `Contract.status = PAID` and `paidAt`; it does not move the lead to a new stage or reset its stage timestamp.

### Tabs and counters

`GET /expert/leads?tab=...` and `GET /expert/leads/summary`:

| Tab | Label | Lead statuses |
| --- | --- | --- |
| `NEW` | Новые | `CALL_SCHEDULED`, `OFFICE_INVITED` |
| `FOLLOW_UP` | Дожать | `RECALL` |
| `SIGNING` | На подписании | `CONTRACT_PENDING` |
| `SIGNED` | Контракт подписан | `CONVERTED` |

`CONTRACTS` remains the combined legacy view and counter; `ARCHIVE` remains supported. Do not sum all summary keys because `CONTRACTS` overlaps `SIGNING` and `SIGNED`.

Use `summary.SIGNING` for the dashboard card. All tabs sort by `statusChangedAt DESC, id DESC`; display `statusChangedAt` in the date/time column. This is the latest actual status transition, including repeat visits to a stage. Historical timestamps populated by the September 15 migration may still equal creation time; this release does not invent historical dates. Existing expert-lead realtime refresh events remain in use.

### Upload the scan later from the student profile

Find the contract through existing `GET /contracts/student/:studentId`. Upload using `POST /contracts/:id/scan`, multipart field `file`. EXPERT and ADMIN only; the expert must own the student/lead. Signed or paid contracts accept PDF, JPEG and PNG up to 10 MB. Contents and MIME type are checked. Signature/payment confirmation does not require this upload.

Download through authenticated `GET /contracts/:id/scan`. Only the student, assigned expert or administrator can read it. `scanFileKey` is an internal object key, **not a public URL**. Downloads use `private, no-store` and attachment disposition. Replacement uploads retain the previous private object and an audit reference.

## Existing contracts and compatibility

No existing accounts, contracts, names, dates or historical prices are deleted or rewritten by the migration. Existing pending contracts keep their student IDs. Complete them with:

- `POST /contracts/:id/manual-signature` — `{signedAt}`;
- `POST /contracts/:id/confirm-manual` — `{paidAt, amount, signedAt?}`.

The lead confirmation endpoint also accepts existing linked contracts. A historical contract without a payment plan defaults to full payment. Its original price and currency (KZT/USD/EUR) are retained; the new price restriction applies when creating a contract or explicitly changing its price/currency. Before recording a manual signature, the expert can configure its payment plan through the existing `PATCH /contracts/:id/meta` using `paymentType` and `installmentCount`. Signed/paid terms remain frozen. Historic contracts that already received benefits are not granted them again.

The four legacy OTP/sign routes remain present but return **409 `MANUAL_SIGNATURE_REQUIRED`** for every contract. The frontend must remove those actions for this release. Pending contract-ready emails now instruct recipients to contact their expert for paper signing. New manual confirmations do not email a generated PDF as though it were the scanned original.

The old subscription gateway cannot initiate purchases for manually managed contracts, and an in-flight legacy gateway callback cannot grant their benefits again or mark installments fully paid. Such a callback remains recorded as a gateway transaction and requires reconciliation separately.

Finance responses retain their existing fields. Contract rows additionally return `paidAmount` and `remainingAmount`. Summary/expert earnings count confirmed installments as actual receipts without counting the full contract price after just the first payment. Fully paid contract counts remain separate from actual received amounts.

## Deployment and validation

1. Apply `20260928130000_manual_contracts` before deploying the application. It adds nullable contract fields, draft storage and installment storage without updating or deleting existing records.
2. Deploy the matching frontend before enabling the new workflow for experts. An old UI assuming a non-null contract/student immediately after preparation is incompatible with the explicitly changed account-creation timing.
3. Contract scans use a dedicated private bucket named `${AWS_BUCKET_NAME}-contracts` on the configured MinIO endpoint. The service creates it lazily. Storage credentials need access to that bucket (including bucket creation if it is not pre-created). Do not grant anonymous read access. Include it in backups.
4. For rollback retain the added tables/columns and private files. Once new drafts or receipts exist, do not blindly restore the old workflow: it cannot interpret pre-account drafts or installment receipts. Pause new confirmations and prefer a forward fix.

Checks:

```bash
yarn prisma generate
yarn test --runInBand
yarn build
# DATABASE_URL must refer to an isolated local *_test database with migrations applied.
yarn test:manual-contracts
# Existing CRM regressions additionally require isolated SALES_V2_TEST_REDIS_URL.
yarn test:sales-v2:regression
yarn test:sales-v2:reliability
```
