# P1-27 journey archaeology — quality control and rework

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Read at:** `develop` `a56eeea0a10d56cd17827ec443dd5ecff40f8c0d`

## Verdict

The module is called **`quality`** and it owns the **`qms`** schema. It exposes
**thirteen** operations, all Phase 1-19, all `scope: 'branch'`, behind **seven**
distinct permission codes of which every one is seeded — the five `qms.` codes,
plus `wo.work_order.transition` on the reopen attempt (§6) and
`iam.sensitive.view` on the two cost operations (§12, §13). What it can support today is
real and complete as far as it goes: a checker can open a quality-control record
against an open work order, record `pass`/`fail`/`na` against individual
configured checks, and finalise the record as `passed` or `failed` — with the
checker's identity and the finalisation time stamped by the database from the
session and then frozen, so a pass can never be attributed to someone who did
not perform it and a failure can never be edited into a pass. Corrective work is
a **second work order** of `kind = 'rework'` on the same reception visit, linked
to the closed original by `qms.rework_links`, carrying root cause, corrective
action, responsibility, a lead technician and a safety-critical flag, with an
independent sign-off that a CHECK constraint refuses from the technician who did
the work. A reopen attempt is recorded and refused, always. Closure is gated on
six blockers, of which two (B5, B6) are answered from `qms`.

What it **cannot** support, and what will break screens if guessed:

1. **There is no operation of any kind on `qms.qc_checks`.** The catalogue that
   defines what a quality check _is_ has no create, no list, no read and no
   update route anywhere in the API, and **no seed inserts a single row into
   it**. Consequently: `unresolvedMandatory` is always empty on a fresh tenant,
   closure blocker B5b can never fire, and — most damaging — a screen has **no
   way to obtain a `qcCheckId`**, which is a path parameter of the only
   operation that records a check outcome. The one response that could ever
   surface one is `unresolvedMandatory` on §3, and it is empty for as long as
   the catalogue is (see §3 for the exact reachability). The QC checklist screen therefore
   cannot be built from the contract as it stands. This is the same shape as the
   diagnostics template gap and it is worse, because here the parameter is in
   the URL.
2. **None of the four list operations is paginated.** `{ items }` and nothing
   else — no `nextCursor`, no `hasMore`, no `limit`, no query parameters read at
   all. Every live record, attempt or link is returned in one unbounded
   response.
3. **`qms.qc_status_history` is not routed.** The append-only QC status ledger
   exists in the database, is trigger-written, and has no read operation. "When
   did this record change and why" cannot be answered.
4. **The QC record's `notes` are write-only.** `notes` is accepted on open and
   on finalisation and is stored, but the projection returned to callers
   (`QcRecordView`) does not include it. Nothing can read a QC note back.
5. **`qms.rework.manage` and `qms.rework.sign_off` name technician _profile_
   ids**, not user ids, and **no `qms` response resolves either id to a person**.
   A branch roster of profile ids _does_ exist — `GET /technicians/available`
   enumerates every active `tech.technician_profiles` row in the named branch and
   `skills`/`certifications` are optional — but it requires a `from`/`to` window
   the picker has no reason to state, caps at 50, and returns **no name**. The two
   person pickers can therefore be populated with opaque uuids and nothing else.
6. **Seven of the thirteen operations declare `idempotent: true`**, which makes
   the `idempotency-key` header **mandatory** — the identical trap that produced
   P1-26-F-015.

On the assigned question "does QA block delivery in the contract, or only by
convention": it blocks **in the contract, but only in the application layer**.
`sal.complete_delivery` reads no quality-control outcome whatsoever. The block
exists because `DeliveryReadService.readQualityFact` calls
`qualityModule().gate.evaluate` and `DeliveryService.completeDelivery`
re-composes eligibility **inside the delivery row's lock** before completing.
Delete that composition and the database will hand over a vehicle whose quality
control failed, without complaint.

## Operations that exist

All thirteen were confirmed in four places: the route module under
`apps/api/src/app/api/v1/**/route.ts`, the service under
`apps/api/src/modules/quality/application/*.ts`, the repository at
`apps/api/src/modules/quality/data/quality-repository.ts`, and
`docs/api/openapi.v1.json`. Two further operations owned by the `work-order`
module — `wo.work-order-closure-eligibility` and `wo.work-order-closure` — are
reported here as §14 and §15 because the assigned question about the closure
gate cannot be answered without them.

Facts shared by all thirteen, stated once rather than repeated:

- **Scope** is `'branch'` on every one. `/quality-controls/{recordId}` and
  `/rework-links/{reworkLinkId}` name **no branch in the path**, so the
  pre-handler check has nothing to narrow by and would degrade to a scope-blind
  `iam.has_permission` (recorded as `P1-18-A-01`). Both services therefore carry
  `companyId`/`branchId` on the row and re-authorise against the row's own scope
  — `QualityControlService.requireRecord`, `ReworkService.requireLink`, and the
  two `lock*` paths.
- **Idempotency**: `idempotent: true` requires the `idempotency-key` header,
  8–200 characters (`apps/api/src/server/http/idempotency.ts:41`, `:60`).
  Absent or malformed is `ERR-INT-002`; a replay under the same key with a
  different fingerprint is `ERR-INT-001`.
- **Concurrency**: `versionGuarded: true` requires `If-Match`. The route raises
  `ERR-CON-002` (**428**) when absent; a stale value is `ERR-CON-001` (409).
- **Error codes present on essentially every operation**: `ERR-VAL-001` (422 —
  a `.strict()` rejection or a domain shape refusal), `ERR-RES-001` (404 —
  absent **or** out of scope, never distinguished), `ERR-IAM-001` (**403**, not
  permitted), `ERR-IAM-002` (401, no authenticated principal).
- **Owning phase**: Phase 1-19 for all thirteen. The underlying tables are
  Phase 1-9 (`supabase/migrations/20260722104000_qms_quality_control.sql` and
  `20260722105000_qms_rework_closure_gate.sql`).
- **Documented response status**: `docs/api/openapi.v1.json` records `200` for
  every one of the thirteen, including the three that actually return **`201`**
  (§1, §6, §8). A client asserting `status === 200` on those three will treat a
  success as a failure. The OpenAPI response schema is `{"type": "object"}` on
  all thirteen — it carries **no field names at all**, so the exact shapes below
  come from the service projections and are the only authority.

### 1. `qms.qc-record-open`

|                 |                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.qc-record-open`                                                                                                                                                                                                                                                                                  |
| Route           | `/work-orders/{workOrderId}/quality-controls`                                                                                                                                                                                                                                                         |
| Method          | `POST`                                                                                                                                                                                                                                                                                                |
| Permission      | `qms.quality_control.record` — seeded, `supabase/seeds/04_iam_permission_catalog.sql:221`, risk `medium`                                                                                                                                                                                              |
| Request schema  | Path `workOrderId` (uuid). Body `.strict()`, **one optional field**: `notes` (string, trimmed, min 1, max `MAX_QC_NOTE` = 2000). The route sends `body ?? {}`, so a **missing or unparsable body is accepted** as `{}`. `checkerId` and `finalizedAt` are **not accepted** — the database stamps both |
| Response schema | **`201`** (OpenAPI says 200). `QcRecordView`: `id` (uuid), `workOrderId` (uuid), `overallResult` (string, always `"pending"` here), `checkerId` (uuid\|null — null here), `finalizedAt` (ISO string\|null — null here), `recordVersion` (number). **`notes` is not returned**                         |
| Scope           | `branch`, resolved through `workOrderModule().workOrders.requireWorkOrder`                                                                                                                                                                                                                            |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                   |
| Idempotency     | **Required** (`idempotent: true`)                                                                                                                                                                                                                                                                     |
| Concurrency     | None (`versionGuarded` absent)                                                                                                                                                                                                                                                                        |
| Audit           | `auditClass: 'privileged'`, `auditAction: 'qms.quality_control.opened'`. Details: `work_order_id` (`internal`)                                                                                                                                                                                        |
| Error codes     | `ERR-TRN-001` (409) — the work order's state is terminal, or its state code is not in the catalogue; `ERR-RES-001` (404) — work order not visible; `ERR-VAL-001` (422)                                                                                                                                |
| Event           | None                                                                                                                                                                                                                                                                                                  |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:336` (opens pending with no checker and no finalisation time), `:351` (a SECOND record on the same work order is allowed), `:449` (terminal work order refused; unpermitted and cross-scope callers refused), `:489` (one record on an idempotent replay) |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                  |

The terminal refusal is an **application** rule, stated as such in the service:
`qms.quality_control_records` references the work order and never reads its
state, so the database would accept a QC record opened after closure.

### 2. `qms.qc-record-list`

|                 |                                                                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.qc-record-list`                                                                                                                                                                                                                                 |
| Route           | `/work-orders/{workOrderId}/quality-controls`                                                                                                                                                                                                        |
| Method          | `GET`                                                                                                                                                                                                                                                |
| Permission      | `qms.quality_control.read` — seeded, catalogue line 228, risk `low`                                                                                                                                                                                  |
| Request schema  | Path `workOrderId` (uuid). **No query parameters are read** — the route never constructs a `URL`                                                                                                                                                     |
| Response schema | `200`. `{ items: QcRecordView[] }` — **and nothing else**                                                                                                                                                                                            |
| Scope           | `branch`                                                                                                                                                                                                                                             |
| Pagination      | **NONE.** Bare `{ items }`; **no `nextCursor`, no `hasMore`, no `total`, no `limit`**. Ordering is fixed in SQL at `quality-repository.ts:336` as `ORDER BY created_at, id` — **oldest first**. There is no cursor column because there is no cursor |
| Idempotency     | n/a (read)                                                                                                                                                                                                                                           |
| Concurrency     | None                                                                                                                                                                                                                                                 |
| Audit           | `auditClass: 'none'`                                                                                                                                                                                                                                 |
| Error codes     | `ERR-RES-001` (404) — work order not visible; `ERR-IAM-001` (403)                                                                                                                                                                                    |
| Event           | None                                                                                                                                                                                                                                                 |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:382` (refuses every read on this surface to an unpermitted, out-of-branch or cross-tenant caller)                                                                                                        |
| Owning phase    | 1-19                                                                                                                                                                                                                                                 |

Note the deliberate asymmetry with the gate's own read: `recordsFor`
(`quality-repository.ts:232`) orders `created_at DESC`, but that path is
internal to `QualityGateService.evaluate` and is never returned to a caller.

### 3. `qms.qc-record-detail`

|                 |                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.qc-record-detail`                                                                                                                                                                                                                                                                                                                          |
| Route           | `/quality-controls/{recordId}`                                                                                                                                                                                                                                                                                                                  |
| Method          | `GET`                                                                                                                                                                                                                                                                                                                                           |
| Permission      | `qms.quality_control.read` — seeded, catalogue line 228, risk `low`                                                                                                                                                                                                                                                                             |
| Request schema  | Path `recordId` (uuid). No body, no query parameters                                                                                                                                                                                                                                                                                            |
| Response schema | `200`. `QcRecordDetail`: `record` (`QcRecordView`, as §1), `results` (`QcCheckResultRow[]`: `id`, `qcCheckId`, `checkCode`, `result` — one of `pass`/`fail`/`na`, `note` string\|null, `recordVersion`), `unresolvedMandatory` (`QcCheckRow[]`: `id`, `code`, `name`, `isMandatory`, `isSafetyCritical`). `ETag` carries `record.recordVersion` |
| Scope           | `branch`, re-authorised against the record's own `companyId`/`branchId` because the path names no branch (`P1-18-A-01`)                                                                                                                                                                                                                         |
| Pagination      | n/a — `results` and `unresolvedMandatory` are unbounded arrays                                                                                                                                                                                                                                                                                  |
| Idempotency     | n/a (read)                                                                                                                                                                                                                                                                                                                                      |
| Concurrency     | None on the read; the `ETag` it publishes is what makes §5 reachable                                                                                                                                                                                                                                                                            |
| Audit           | `auditClass: 'none'`                                                                                                                                                                                                                                                                                                                            |
| Error codes     | `ERR-RES-001` (404) — record not visible; `ERR-IAM-001` (403)                                                                                                                                                                                                                                                                                   |
| Event           | None                                                                                                                                                                                                                                                                                                                                            |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:426` (reports which mandatory checks have no result yet), `:474` (isolates the record read by branch and by tenant)                                                                                                                                                                                 |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                            |

**`unresolvedMandatory` lists only checks that are `isMandatory` AND unanswered.**
A non-mandatory check that has not been answered appears **nowhere** in this
payload. Combined with the absence of any catalogue operation (§ "Operations the
journey needs that do not exist"), this response is the **only** response in the
platform that carries `qcCheckId` values, and the only one that can _discover_
them is `unresolvedMandatory` — which is the mandatory subset. `results` also
carries a `qcCheckId` per row, but only for a check that has **already** been
answered, so it can never bootstrap the first outcome on a non-mandatory check.

`unresolvedMandatory` is **reported, not enforced**: `wo.guard_work_order_closure`'s
B5b asks only whether a `passed` record exists when any mandatory check is
configured; it never inspects per-check results
(`20260722105000_qms_rework_closure_gate.sql:438-447`). Do not render it as a
closure blocker.

### 4. `qms.qc-check-result`

|                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.qc-check-result`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Route           | `/quality-controls/{recordId}/checks/{qcCheckId}`                                                                                                                                                                                                                                                                                                                                                                                                              |
| Method          | `PUT`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Permission      | `qms.quality_control.record` — seeded, catalogue line 221, risk `medium`                                                                                                                                                                                                                                                                                                                                                                                       |
| Request schema  | Path `recordId` (uuid), `qcCheckId` (uuid). Body `.strict()`, exactly two keys: **`result`** — `z.enum(QC_CHECK_RESULTS)`, members verbatim **`'pass'`, `'fail'`, `'na'`** (CHECK constraint `ck_qc_check_results_result`, `20260722104000_qms_quality_control.sql:146`); **`note`** — optional string, trimmed, min 1, max 2000 (`ck_qc_check_results_note_not_blank`). The body is **required** — `parseOrFail(Body, body, 'body')` with no `?? {}` fallback |
| Response schema | `200`. `QcCheckResultRow`: `id` (uuid), `qcCheckId` (uuid), `checkCode` (string — joined from `qms.qc_checks.code`), `result` (string), `note` (string\|null), `recordVersion` (number)                                                                                                                                                                                                                                                                        |
| Scope           | `branch`, re-authorised against the **locked** record's own scope                                                                                                                                                                                                                                                                                                                                                                                              |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Idempotency     | **Required** (`idempotent: true`)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Concurrency     | None (`versionGuarded` absent). The record is `SELECT … FOR UPDATE`-locked before its status is read, so a concurrent finalisation cannot commit between the read and the write                                                                                                                                                                                                                                                                                |
| Audit           | `auditClass: 'privileged'`, `auditAction: 'qms.quality_control.check_recorded'`. Details: `check_code` (`public`), `result` (`public`)                                                                                                                                                                                                                                                                                                                         |
| Error codes     | `ERR-QMS-001` (409) — the record is already finalised (`assertNotFinalized`); `ERR-RES-001` (404) — record not visible, **or** the `qcCheckId` is not in this tenant's active catalogue; `ERR-VAL-001` (422) — a `result` outside the three members, or an unknown key; `ERR-IAM-001` (403)                                                                                                                                                                    |
| Event           | None                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:506` (records and replaces one outcome while pending), `:531` (`na` accepted as a recorded fact; a value outside the vocabulary refused), `:548` (a check outside the tenant catalogue refused; a finalised record refused), `:571` (unpermitted/cross-scope refused, writes once on replay)                                                                                                                       |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

`na` is a **first-class recorded outcome**, not a gap — a check that does not
apply to this vehicle is a fact. `PUT` rather than `POST` because the outcome is
1:1 with the check (`uq_qc_check_results_record_check`, a **partial** unique
index over live rows) and a checker correcting a mis-click should not need a new
record. `fk_qc_check_results_check` references `qms.qc_checks (id)` with **no
tenant column**, so the foreign key alone would accept another tenant's
check — the catalogue read in the service is the only thing that refuses it.

### 5. `qms.qc-record-finalize`

|                 |                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.qc-record-finalize`                                                                                                                                                                                                                                                                                                                                                                                              |
| Route           | `/quality-controls/{recordId}/finalization`                                                                                                                                                                                                                                                                                                                                                                           |
| Method          | `POST`                                                                                                                                                                                                                                                                                                                                                                                                                |
| Permission      | `qms.quality_control.finalize` — seeded, catalogue line 222, risk **`high`**. Deliberately **not** the same code as §1/§4                                                                                                                                                                                                                                                                                             |
| Request schema  | Path `recordId` (uuid). Header `If-Match` **mandatory**. Body `.strict()`, exactly two keys: **`overallResult`** — `z.enum(['passed', 'failed'])`; **`notes`** — optional string, trimmed, min 1, max 2000. `'pending'` is in the CHECK vocabulary `ck_quality_control_records_result` (`'pending'`, `'passed'`, `'failed'`) but is **deliberately not settable**. `checkerId` and `finalizedAt` are **not accepted** |
| Response schema | `200`. `QcRecordView` re-read **from the row after the write**, so `checkerId` and `finalizedAt` are the database's stamps, not reconstructions                                                                                                                                                                                                                                                                       |
| Scope           | `branch`, re-authorised against the locked record's own scope                                                                                                                                                                                                                                                                                                                                                         |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Idempotency     | **Required** (`idempotent: true`)                                                                                                                                                                                                                                                                                                                                                                                     |
| Concurrency     | **`versionGuarded: true`.** Missing `If-Match` → `ERR-CON-002` (428), raised by the route itself. A stale version → `ERR-CON-001` (409), raised twice: once by the service comparing `record.recordVersion`, once by the `record_version = $6` predicate on the UPDATE                                                                                                                                                |
| Audit           | `auditClass: 'approval'`, `auditAction: 'qms.quality_control.finalized'`. Details: `overall_result` (`public`, with `previousValue`), `work_order_id` (`internal`)                                                                                                                                                                                                                                                    |
| Error codes     | `ERR-QMS-001` (409) — already finalised; `ERR-CON-002` (428); `ERR-CON-001` (409); `ERR-RES-001` (404); `ERR-VAL-001` (422); `ERR-IAM-001` (403)                                                                                                                                                                                                                                                                      |
| Event           | **`quality-control.finalized`** — `EVT-QMS-001`, schema version 1, aggregate type `qms.quality_control_record`, owner `qms`, registered at `apps/api/src/server/events/envelope.ts:383`. `eventKey` is `quality-control.finalized:{recordId}` with **no version segment**, because finalisation happens at most once per record. Payload: `qualityControlRecordId`, `workOrderId`, `overallResult`                    |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:598` (stamps checker and time from the session, publishes once), `:619` (freezes a finalised record against re-judgement, driven to the deployed guard), `:651` (`pending` as a target, a stale version and a missing `If-Match` all refused), `:675` (a caller with `.record` but not `.finalize` refused), `:705` (finalises once on an idempotent replay)              |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                                                  |

**A failure is permanent on that record.** `qms.guard_qc_finalize()`
(`20260722104000_qms_quality_control.sql:65`) stamps `checker_id` from
`iam.current_user_id()` and `finalized_at` from `now()` on the
`pending → passed|failed` edge, then raises `check_violation` on any later change
to result, checker or time. Clearing closure blocker B5 after a failure means
opening a **new** record (§1) and passing it; the schema has no unique index on
`(work_order_id)` precisely so that is possible, and the failure stays in the
ledger.

### 6. `qms.reopen-attempt`

|                 |                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.reopen-attempt`                                                                                                                                                                                                                                                                                                                                                                                                |
| Route           | `/work-orders/{workOrderId}/reopen-attempts`                                                                                                                                                                                                                                                                                                                                                                        |
| Method          | `POST`                                                                                                                                                                                                                                                                                                                                                                                                              |
| Permission      | **`wo.work_order.transition`** — seeded, catalogue line 178, risk `medium`. **Not a `qms.` code.** The act attempted is a work-order state change, so the authority required to attempt it is the authority to move one                                                                                                                                                                                             |
| Request schema  | Path `workOrderId` (uuid). Body `.strict()`, **one required field**: `reason` (string, trimmed, min 1, max `MAX_REOPEN_REASON` = **1000**). `ck_reopen_attempts_reason_not_blank` backs the non-blank rule; the 1000 is an application bound                                                                                                                                                                        |
| Response schema | **`201`** (OpenAPI says 200). `{ attempt: ReopenAttemptView, refusal: string }` where `ReopenAttemptView` is `id` (uuid), `workOrderId` (uuid), `reason` (string), `outcome` (string — **always `"rejected"`**, `ck_reopen_attempts_outcome` fixes it to that single value), `requestedBy` (uuid — a **user** id), `requestedAt` (ISO string). `refusal` is a prose sentence naming the alternative                 |
| Scope           | `branch`                                                                                                                                                                                                                                                                                                                                                                                                            |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Idempotency     | **Required** (`idempotent: true`)                                                                                                                                                                                                                                                                                                                                                                                   |
| Concurrency     | None                                                                                                                                                                                                                                                                                                                                                                                                                |
| Audit           | `auditClass: **'security'**`, `auditAction: 'qms.work_order.reopen_refused'`. Details: `reopen_attempt_id` (`internal`), `outcome` (`public`, `'rejected'`), `reason` (`internal`)                                                                                                                                                                                                                                  |
| Error codes     | `ERR-TRN-001` (409) — **the work order is not closed, so there is nothing to reopen**; `ERR-RES-001` (404); `ERR-VAL-001` (422) — blank reason; `ERR-IAM-001` (403); `ERR-SYS-001` — the recorded row could not be read back (documented as unreachable)                                                                                                                                                            |
| Event           | None                                                                                                                                                                                                                                                                                                                                                                                                                |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:808` (records the attempt, refuses it, leaves the work order untouched), `:850` (an order that is NOT closed is a different fact), `:866` (blank reason, unpermitted caller, cross-scope callers refused), `:887` (one attempt on an idempotent replay); `tests/db/qms-closure-rework.test.ts:175` (records a rejected attempt and never mutates the closed work order) |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                                                |

**What a "reopen attempt" is.** BR-WO-002 admits no reopen. The request is not a
reopen; it is a request to **record that someone tried**. `qms.attempt_reopen`
(`20260722105000_qms_rework_closure_gate.sql:312`) is `SECURITY INVOKER`, granted
to `app_runtime`, and is the only writer of `qms.reopen_attempts`; it inserts one
row with `outcome = 'rejected'` and **never touches `wo.work_orders`**.
`requested_by` and `requested_at` are stamped by `qms.stamp_reopen_attempt()`
from the session, so an attempt cannot be attributed to someone else.

The operation therefore **returns 201 rather than throwing**, and the service
header records why an earlier draft that threw was strictly worse: the throw
aborted the request transaction and rolled back the very ledger row the endpoint
exists to write — the refusal was real and the record was not. So the **request**
succeeds (an attempt was asked for and one was recorded) and the **response**
says the reopen was refused. A UI must render a 201 here as "recorded and
refused", not as "reopened".

The only path that is a genuine error is an order that is **not closed**:
`qms.attempt_reopen` raises `check_violation`, mapped to `ERR-TRN-001` with the
message "there is nothing to reopen".

### 7. `qms.reopen-attempt-list`

|                 |                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.reopen-attempt-list`                                                                                                                                                               |
| Route           | `/work-orders/{workOrderId}/reopen-attempts`                                                                                                                                            |
| Method          | `GET`                                                                                                                                                                                   |
| Permission      | `qms.quality_control.read` — seeded, catalogue line 228, risk `low`. Note the asymmetry with §6                                                                                         |
| Request schema  | Path `workOrderId` (uuid). No query parameters read                                                                                                                                     |
| Response schema | `200`. `{ items: ReopenAttemptView[] }`                                                                                                                                                 |
| Scope           | `branch`                                                                                                                                                                                |
| Pagination      | **NONE.** Bare `{ items }`; no `nextCursor`, no `hasMore`, no `total`. Ordering fixed in SQL at `quality-repository.ts:505` as `ORDER BY requested_at DESC, id DESC` — **newest first** |
| Idempotency     | n/a (read)                                                                                                                                                                              |
| Concurrency     | None                                                                                                                                                                                    |
| Audit           | `auditClass: 'none'`                                                                                                                                                                    |
| Error codes     | `ERR-RES-001` (404); `ERR-IAM-001` (403)                                                                                                                                                |
| Event           | None                                                                                                                                                                                    |
| Existing tests  | Covered inside `tests/backend/p1-19-quality-rework.test.ts:808` and `:887`, which read the list back to assert the count                                                                |
| Owning phase    | 1-19                                                                                                                                                                                    |

`qms.reopen_attempts` is **append-only** — the migration grants
`SELECT, INSERT` only, and there is no `deleted_at` column, no `record_version`
and no update path.

### 8. `qms.rework-create`

|                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.rework-create`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Route           | `/work-orders/{workOrderId}/rework` — `workOrderId` is the **ORIGINAL**, closed order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Method          | `POST`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Permission      | `qms.rework.manage` — seeded, catalogue line 226, risk **`high`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Request schema  | Path `workOrderId` (uuid). Body `.strict()`, exactly five keys — verbatim: **`rootCause`** (string, trimmed, min 1, max `MAX_ROOT_CAUSE` = 2000, **required**); **`correctiveAction`** (string, trimmed, min 1, max `MAX_CORRECTIVE_ACTION` = 2000, **required**); **`responsibility`** (string, trimmed, min 1, max 2000, optional — **free text, there is NO enum and no vocabulary behind it**); **`leadTechnicianId`** (uuid, optional — a **`tech.technician_profiles` id**, not a user id); **`isSafetyCritical`** (boolean, optional, defaults to `false` in the service) |
| Response schema | **`201`** (OpenAPI says 200). `{ reworkWorkOrderId: uuid, link: ReworkLinkView }`. `ReworkLinkView`: `id`, `originalWorkOrderId`, `reworkWorkOrderId`, `rootCause`, `correctiveAction`, `responsibility` (string\|null), `leadTechnicianId` (uuid\|null), `isSafetyCritical` (boolean), `independentSignOffBy` (uuid\|null), `signOffAt` (ISO string\|null), `recordVersion` (number). `ETag` carries `link.recordVersion`                                                                                                                                                       |
| Scope           | `branch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Idempotency     | **Required** (`idempotent: true`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Concurrency     | None (`versionGuarded` absent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Audit           | `auditClass: 'privileged'`, `auditAction: 'qms.rework.created'`. Details: `original_work_order_id` (`internal`), `rework_work_order_id` (`internal`), `root_cause` (`internal`), `corrective_action` (`internal`), `is_safety_critical` (`public`)                                                                                                                                                                                                                                                                                                                               |
| Error codes     | `ERR-VAL-001` (422) — `isSafetyCritical` true with no `leadTechnicianId` (`path: 'body.leadTechnicianId'`, `rule: 'required'`); `ERR-RES-001` (404) — original not visible, **or** the lead technician profile is not in the original's company **and** branch; `ERR-TRN-001` (409) — the original is not closed, **or** the original's state is a **cancellation**, or `qms.guard_rework_link_coherence` refused between the pre-check and the insert; `ERR-RES-002` (409) — `uq_rework_links_rework_wo`, one link per rework order (documented as unreachable from this path)  |
| Event           | **`rework.linked`** — `EVT-QMS-002`, schema version 1, aggregate type `qms.rework_link`, owner `qms`, registered at `apps/api/src/server/events/envelope.ts:392`. `eventKey` is `rework.linked:{reworkWorkOrderId}`. Payload: `reworkLinkId`, `originalWorkOrderId`, `reworkWorkOrderId`, `isSafetyCritical`                                                                                                                                                                                                                                                                     |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:905` (opens a rework order sharing the original's visit and links the two), `:951` (an original that is not CLOSED refused), `:963` (a CANCELLED original refused — which the database alone would accept), `:997` (safety-critical with no lead technician refused, writing nothing), `:1020` (out-of-scope lead technician refused), `:1036` (unpermitted/cross-scope refused; creates once on replay), `:1065` (rollback: a failed creation leaves neither the rework order nor a link)                                           |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**What creates rework.** This operation, and nothing else. It is the second and
last path in the platform that inserts a `wo.work_orders` row. Both writes — the
rework work order (through `workOrderModule().workOrders.openRework`, because
`wo.work_orders` belongs to that module) and the `qms.rework_links` row — land in
**one transaction**, so a rework order can never exist without the link that
explains it.

Three preconditions are enforced by `qms.guard_rework_link_coherence`
(`20260722105000_qms_rework_closure_gate.sql:162`): the original must be
**closed** (`wo.work_order_states.is_closed`), the rework order must have
`kind = 'rework'`, and both must share the original's `reception_visit_id`. The
**cancellation** refusal is an additional application rule, and the reason is
recorded explicitly: the seeded `cancelled` state carries `is_closed = true` as
well as `is_cancellation = true`, so the database on its own would accept rework
against an abandoned order.

`wo.work_orders.kind` is frozen to exactly two values by `ck_work_orders_kind` —
**`'ordinary'` and `'rework'`**. There is no `warranty` and no `internal` kind.

The display number is allocated through the shared number sequence
`{ sequenceCode: 'work_order' }`, and only **if the tenant has provisioned that
sequence**; otherwise `display_number` is `null`, which is legal
(`uq_work_orders_active_display_number` is partial on `display_number IS NOT
NULL`). A rework order with no visible number is therefore an expected state, not
a defect.

### 9. `qms.rework-list`

|                 |                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.rework-list`                                                                                                                                                                                                                                        |
| Route           | `/work-orders/{workOrderId}/rework`                                                                                                                                                                                                                      |
| Method          | `GET`                                                                                                                                                                                                                                                    |
| Permission      | `qms.quality_control.read` — seeded, catalogue line 228, risk `low`                                                                                                                                                                                      |
| Request schema  | Path `workOrderId` (uuid). No query parameters read                                                                                                                                                                                                      |
| Response schema | `200`. `{ items: ReworkLinkView[] }` — links whose **ORIGINAL** is this work order. There is **no** operation that lists links whose **rework side** is a given order (that direction exists only as `QualityGateService.reworkLinks`, an internal port) |
| Scope           | `branch`                                                                                                                                                                                                                                                 |
| Pagination      | **NONE.** Bare `{ items }`; no `nextCursor`, no `hasMore`, no `total`. Ordering fixed in SQL at `quality-repository.ts:608` as `ORDER BY created_at, id` — **oldest first**                                                                              |
| Idempotency     | n/a (read)                                                                                                                                                                                                                                               |
| Concurrency     | None                                                                                                                                                                                                                                                     |
| Audit           | `auditClass: 'none'`                                                                                                                                                                                                                                     |
| Error codes     | `ERR-RES-001` (404); `ERR-IAM-001` (403)                                                                                                                                                                                                                 |
| Event           | None                                                                                                                                                                                                                                                     |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:905` reads the list back after creating a link                                                                                                                                                               |
| Owning phase    | 1-19                                                                                                                                                                                                                                                     |

### 10. `qms.rework-detail`

|                 |                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.rework-detail`                                                                                                                                              |
| Route           | `/rework-links/{reworkLinkId}`                                                                                                                                   |
| Method          | `GET`                                                                                                                                                            |
| Permission      | `qms.quality_control.read` — seeded, catalogue line 228, risk `low`                                                                                              |
| Request schema  | Path `reworkLinkId` (uuid). No body, no query parameters                                                                                                         |
| Response schema | `200`. `ReworkLinkView` (fields as §8). `ETag` carries `recordVersion` — this read is what makes §11 reachable. The **restricted cost is deliberately not here** |
| Scope           | `branch`, re-authorised against the link's own `companyId`/`branchId` (`P1-18-A-01`)                                                                             |
| Pagination      | n/a                                                                                                                                                              |
| Idempotency     | n/a (read)                                                                                                                                                       |
| Concurrency     | None on the read                                                                                                                                                 |
| Audit           | `auditClass: 'none'`                                                                                                                                             |
| Error codes     | `ERR-RES-001` (404); `ERR-IAM-001` (403)                                                                                                                         |
| Event           | None                                                                                                                                                             |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:1474` (keeps a tenant-B rework case out of tenant A's reach)                                                         |
| Owning phase    | 1-19                                                                                                                                                             |

### 11. `qms.rework-sign-off`

|                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.rework-sign-off`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Route           | `/rework-links/{reworkLinkId}/sign-off`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Method          | `POST`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Permission      | `qms.rework.sign_off` — seeded, catalogue line 227, risk **`high`**. Deliberately **separate** from `qms.rework.manage`: raising a rework case and independently certifying it are the two halves BR-QMS-001 keeps apart                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Request schema  | Path `reworkLinkId` (uuid). Header `If-Match` **mandatory**. Body `.strict()`, **one required field**: **`signOffBy`** (uuid — a **`tech.technician_profiles` id**, not a user id). `signOffAt` is **not accepted**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Response schema | `200`. `ReworkLinkView` re-read from the row after the write, so `signOffAt` is the database's stamp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Scope           | `branch`, re-authorised against the locked link's own scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Idempotency     | **Required** (`idempotent: true`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Concurrency     | **`versionGuarded: true`.** Missing `If-Match` → `ERR-CON-002` (428); stale → `ERR-CON-001` (409), checked twice (service comparison, then `record_version = $5` on the UPDATE)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Audit           | `auditClass: 'approval'`, `auditAction: 'qms.rework.signed_off'`. Details: `independent_sign_off_by` (`internal`), `is_safety_critical` (`public`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Error codes     | `ERR-QMS-001` (409) — signed off by the technician who performed the work; carries `safeDetails.violations` `{ path: 'body.signOffBy', rule: 'not_independent' }` **only** when the CHECK raised it (a non-safety-critical link the domain pre-check declines to police), and no `safeDetails` when `assertIndependentSignOff` refused it first. The domain's "safety-critical rework requires an independent sign-off" branch is **unreachable over HTTP** — `signOffBy` is a required uuid in the `.strict()` body, so it can never be null; `ERR-TRN-001` (409) — **already signed off**; `ERR-RES-001` (404) — link not visible, or the signer's profile is not in the link's company and branch; `ERR-CON-002` (428); `ERR-CON-001` (409); `ERR-IAM-001` (403) |
| Event           | None — the event catalogue's `rework.linked` description says "linked … or signed off", but this method publishes nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:1122` (blocks the rework order's closure until signed off), `:1184` (a sign-off by the technician who did the work refused — the CHECK, driven end to end), `:1214` (reaches the CHECK itself on a NON-safety-critical link, where the pre-check declines to look), `:1254` (makes the signature write-once), `:1281` (missing permission, stale version, cross-scope refused), `:1311` (signs off once on an idempotent replay); `tests/db/qms-closure-rework.test.ts:191`                                                                                                                                                                                                                                             |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**The separation is a database CHECK, not an application rule.**
`ck_rework_links_signoff_distinct`
(`20260722105000_qms_rework_closure_gate.sql:146`) refuses
`independent_sign_off_by` equal to `lead_technician_id`.
`ck_rework_links_safety_lead` (line 144) makes a lead technician mandatory when
`is_safety_critical`. `org.guard_immutable_columns` freezes `lead_technician_id`,
so the lead cannot be swapped afterwards to make a signature legal, and
`qms.guard_rework_signoff` (line 201) stamps `sign_off_at` and makes the
signature **write-once**.

`assertIndependentSignOff` in the domain refuses first **only** so the caller
gets a readable reason instead of a bare `23514`, and it deliberately declines to
police non-safety-critical links — the CHECK still does, which is why the test at
`:1214` exists.

### 12. `qms.rework-cost-record`

|                 |                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.rework-cost-record`                                                                                                                                                                                                                                                                                                                                                                     |
| Route           | `/rework-links/{reworkLinkId}/cost`                                                                                                                                                                                                                                                                                                                                                          |
| Method          | `PUT`                                                                                                                                                                                                                                                                                                                                                                                        |
| Permission      | **`qms.rework.manage` AND `iam.sensitive.view`** — both seeded (catalogue lines 226 and **31**, both risk `high`). `defineOperation` treats the list as a **conjunction**, so this is a real second requirement checked before any row is touched                                                                                                                                            |
| Request schema  | Path `reworkLinkId` (uuid). Body `.strict()`, exactly two keys: **`reworkCost`** — a **decimal STRING**, regex `^\d{1,10}(\.\d{1,4})?$` (never a `number`); **`costCurrency`** — string, regex `^[A-Z]{3}$`                                                                                                                                                                                  |
| Response schema | `200`. `ReworkCostRow`: `id` (uuid), `reworkLinkId` (uuid), **`reworkCost` (STRING)**, `costCurrency` (string), `classification` (string — CHECK-fixed to **`'restricted'`**), `recordVersion` (number)                                                                                                                                                                                      |
| Scope           | `branch`, re-authorised against the link's own scope                                                                                                                                                                                                                                                                                                                                         |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                          |
| Idempotency     | **Required** (`idempotent: true`)                                                                                                                                                                                                                                                                                                                                                            |
| Concurrency     | None (`versionGuarded` absent)                                                                                                                                                                                                                                                                                                                                                               |
| Audit           | `auditClass: 'privileged'`, `auditAction: 'qms.rework.cost_recorded'`. Details: `classification` (`public`), `cost_currency` (`public`), `cost_recorded` (`internal`, literal `'true'`). **The figure itself is deliberately NOT audited** — `iam.audit_records` is not gated by `iam.sensitive.view`, so copying it there would publish it to every auditor                                 |
| Error codes     | `ERR-IAM-001` (403) — refused by the operation's permission conjunction, or by RLS as `42501` mapped to `ERR-IAM-001`; `ERR-RES-001` (404); `ERR-VAL-001` (422) — a malformed figure or a currency that is not three upper-case letters                                                                                                                                                      |
| Event           | None                                                                                                                                                                                                                                                                                                                                                                                         |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:1343` (records and reads for a caller holding `iam.sensitive.view`), `:1370` (a caller with the functional permission but WITHOUT `iam.sensitive.view` refused), `:1393` (does not put the figure into the audit trail), `:1422` (malformed figure and unknown currency refused), `:1443` (isolates by branch and tenant; writes once on replay) |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                         |

**Column type.** `qms.rework_link_details.rework_cost` is **`numeric(14,4)`**
(`20260722105000_qms_rework_closure_gate.sql:259`), which is why it crosses the
wire as a decimal string — IEEE-754 cannot represent every value it holds.
`cost_currency` is `text` defaulting to `'JOD'` with
`ck_rework_link_details_currency` `~ '^[A-Z]{3}$'`; `ck_rework_link_details_cost`
is `>= 0`.

**What this figure is not.** An internal cost-of-quality KPI. It is explicitly
**not a billing artifact** — nothing here invoices anything and no customer sees
it. All three RLS policies on the table additionally require
`iam.has_permission('iam.sensitive.view')`, for reading **and** writing, which is
why it is a separate surface rather than a field on `ReworkLinkView`.

### 13. `qms.rework-cost-read`

|                 |                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `qms.rework-cost-read`                                                                                                                                                                                                                                    |
| Route           | `/rework-links/{reworkLinkId}/cost`                                                                                                                                                                                                                       |
| Method          | `GET`                                                                                                                                                                                                                                                     |
| Permission      | **`qms.quality_control.read` AND `iam.sensitive.view`** — both seeded (catalogue lines 228 and 31)                                                                                                                                                        |
| Request schema  | Path `reworkLinkId` (uuid). No body, no query parameters                                                                                                                                                                                                  |
| Response schema | `200`. `ReworkCostRow` as §12 — `reworkCost` a **decimal string**                                                                                                                                                                                         |
| Scope           | `branch`                                                                                                                                                                                                                                                  |
| Pagination      | n/a                                                                                                                                                                                                                                                       |
| Idempotency     | n/a (read)                                                                                                                                                                                                                                                |
| Concurrency     | None — this response carries **no `ETag`** (the route returns `{ body }` with no `recordVersion`), even though the body includes `recordVersion`                                                                                                          |
| Audit           | `auditClass: **'security'**`, `auditAction: 'qms.rework.cost_read'`. Recorded **only on a read that succeeded**; a refusal is already recorded by the authorization pipeline and a second record would double-count. Details: `classification` (`public`) |
| Error codes     | `ERR-RES-001` (404) — the link is not visible, **or the link has no recorded cost**. The two are not distinguished by status; only the message differs; `ERR-IAM-001` (403)                                                                               |
| Event           | None                                                                                                                                                                                                                                                      |
| Existing tests  | `tests/backend/p1-19-quality-rework.test.ts:1343`, `:1370`, `:1443`                                                                                                                                                                                       |
| Owning phase    | 1-19                                                                                                                                                                                                                                                      |

### 14. `wo.work-order-closure-eligibility` — **the closure gate reporter**

|                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `wo.work-order-closure-eligibility`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Route           | `/work-orders/{workOrderId}/closure-eligibility`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Method          | `GET`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Permission      | `wo.work_order.read` — seeded, catalogue line 172, risk `low`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Request schema  | Path `workOrderId` (uuid). No body, no query parameters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Response schema | `200`. `ClosureEligibility`: `workOrderId` (uuid), `state` (string), `eligible` (boolean), `blockers` (array of `{ code, message, enforcedBy }`, **in registry order, never discovery order**), `alreadyTerminal` (boolean), `deferred` (`{ owner: string, conditions: string[], reason: string }`), `inventoryCommitments` (`{ activeReservations: number, openIssues: number, blocking: boolean }`)                                                                                                                                                                                 |
| Scope           | `branch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Idempotency     | n/a (read)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Concurrency     | None; **no `ETag`** — the route returns `{ status: 200, body }` with no `recordVersion`, so this read cannot supply the `If-Match` that §15 requires. That must come from `wo.work-order-detail`                                                                                                                                                                                                                                                                                                                                                                                      |
| Audit           | `auditClass: 'none'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Error codes     | `ERR-RES-001` (404); `ERR-IAM-001` (403); `ERR-VAL-001` (422)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Event           | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Existing tests  | `tests/backend/p1-19-closure-gate-matrix.test.ts:237` (baseline order closes, so every later refusal is the condition added and not the fixture), `:249` (B5b alone), `:271` (B1 alone), `:290` (B1 clears), `:303` (B2 alongside B1), `:367` (B3 alone), `:403` (B4 alone), `:428` (B5a alone, superseded by a pass), `:465` (B6 alone — blocks the REWORK order, not the original), `:508` (cancellation bypasses all six while still recording history); `tests/db/p1-19-closure-blocker-reconciliation.test.ts:45` reconciles the registry against the **deployed** function body |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**The six closure blockers, enumerated exactly.** The registry is
`CLOSURE_BLOCKER_REGISTRY` in
`apps/api/src/modules/work-order/domain/work-order.ts:213`. Every entry declares
`enforcedBy: 'wo.guard_work_order_closure'`, and
`tests/db/p1-19-closure-blocker-reconciliation.test.ts` fails the build if the
codes drift from the deployed function.

| code | `message` returned verbatim                                             | what the guard actually tests (`20260722105000_qms_rework_closure_gate.sql`)                                                                                                                                                                      | evaluated by                                                                                      |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `B1` | `A job on this work order is not in a terminal state.`                  | line 379 — a live `wo.jobs` row whose `state` has no `wo.job_states` row with `is_terminal`                                                                                                                                                       | `WorkOrderRepository.structuralBlockers` (`work-order-repository.ts:1705`)                        |
| `B2` | `A labor session on this work order is still running.`                  | line 392 — a live `tech.labor_sessions` row on any job of the order with `ended_at IS NULL`                                                                                                                                                       | `structuralBlockers`                                                                              |
| `B3` | `A required additional-work request is still unresolved.`               | line 403 — a live `wo.additional_work_requests` row with `is_required` and (`state = 'pending'` **or** `state = 'approved' AND fulfillment_state = 'unfulfilled'`)                                                                                | `structuralBlockers`                                                                              |
| `B4` | `A job requiring diagnostics has no completed diagnostic report.`       | line 413 — a live job with `requires_diagnostic` and no `dia.diagnostic_reports` row at `status = 'completed'`                                                                                                                                    | `structuralBlockers`                                                                              |
| `B5` | `Required quality control has not passed.`                              | **two independent tests under one code.** B5a, line 426: a `failed` QC record exists AND no `passed` record exists. B5b, line 438: any active mandatory `qms.qc_checks` row exists for the tenant AND no `passed` QC record exists for this order | `qualityModule().gate.evaluate` → `QualityGateStatus.failedWithoutPass` / `.mandatoryPassMissing` |
| `B6` | `Safety-critical rework on this work order lacks independent sign-off.` | line 450 — a live `qms.rework_links` row whose **`rework_work_order_id`** is this order, with `is_safety_critical` and `independent_sign_off_by IS NULL`                                                                                          | `qualityModule().gate.evaluate` → `.unsignedSafetyCriticalRework`                                 |

Facts a screen must not get wrong:

- **B5's two halves collapse into one code in `blockers`.** The split survives
  only inside `QualityGateStatus`, which is not on the wire. A caller cannot tell
  "quality control failed" from "a mandatory check never ran" through this
  operation, and the remedies differ.
- **B6 blocks the REWORK order's own closure, not the original's.** It reads the
  `rework_work_order_id` side. A screen that shows B6 against the original order
  is wrong.
- **A passing record clears BOTH halves of B5.** The guard treats any `passed`
  record as superseding an earlier `failed` one, which is what makes a re-check
  the correct remedy rather than an edit.
- **The gate runs only when the TARGET state is terminal, and a cancellation
  bypasses B1–B6 entirely** (`IF v_cancel THEN RETURN NEW`, line 374). An order
  already terminal reports `alreadyTerminal: true` with an **empty** blocker
  list, and `eligible: false` — three distinguishable states:
  `{eligible: true, alreadyTerminal: false, blockers: []}`,
  `{eligible: false, alreadyTerminal: false, blockers: [...]}` and
  `{eligible: false, alreadyTerminal: true, blockers: []}`.
- **There is a SEVENTH blocking condition that is not in `blockers`.** Open
  inventory commitments. It is reported in `inventoryCommitments` (from
  `inventoryModule().reads.openCommitmentsFor`) and it does affect `eligible`,
  but it carries no `Bn` code and it is enforced by the **application**, inside
  the locked transaction in `WorkOrderService.move`, not by the guard. A screen
  that renders only `blockers` will show "eligible" reasons that do not explain
  an `ERR-TRN-001` refusal naming reservations and unreturned issues.
- **`deferred`** always reports `owner: 'P1-21'` and
  `conditions: ['active-reservation', 'open-part-issue']` with the reason string
  from `DEFERRED_CLOSURE_BLOCKERS`. These are the two conditions the guard cannot
  express; they are now evaluated (see the previous point) but remain absent from
  the registry, and a reconciliation test pins that.
- **This is a reporter, never an enforcer.** `eligible: true` is a statement
  about the moment it was read.

### 15. `wo.work-order-closure`

|                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation ID    | `wo.work-order-closure`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Route           | `/work-orders/{workOrderId}/closure`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Method          | `POST`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Permission      | **`wo.work_order.transition` AND `wo.work_order.close`** — both seeded (catalogue lines 178 `medium` and 181 **`high`**), evaluated as a conjunction                                                                                                                                                                                                                                                                                                                                        |
| Request schema  | Path `workOrderId` (uuid). Header `If-Match` **mandatory**. Body `.strict()`, exactly two keys: **`toState`** — string, regex `^[a-z][a-z0-9_]{1,62}$`, **required and deliberately not defaulted to `'closed'`** (a tenant may define more than one terminal non-cancellation state); **`reason`** — optional string, min 1, max `MAX_REASON` = **500** (an application bound, not a schema fact)                                                                                          |
| Response schema | `200`. `TransitionResult` — `{ state, recordVersion }`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Scope           | `branch`, authorised against the **locked** row                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Pagination      | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Idempotency     | **Required** (`idempotent: true`)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Concurrency     | **`versionGuarded: true`.** Missing `If-Match` → `ERR-CON-002` (428); stale → `ERR-CON-001` (409)                                                                                                                                                                                                                                                                                                                                                                                           |
| Audit           | `auditClass: 'privileged'`, `auditAction: 'wo.work_order.closed'`. Details: `state` (`public`, with `previousValue`), `reason` (`internal`) when supplied                                                                                                                                                                                                                                                                                                                                   |
| Error codes     | **`ERR-WO-001` (409, "Work order cannot be closed yet")** — the pre-report found blockers; `safeDetails.violations` carries one entry per blocker as `{ path: 'closure.B5', rule: 'closure_blocked' }`; `ERR-TRN-001` (409) — open inventory commitments, with the counts in the message, or a graph refusal; `ERR-VAL-001` (422) — `toState` is not a closing state (`rule: 'not_a_closing_state'`), or the edge is unknown; `ERR-CON-002` (428); `ERR-CON-001` (409); `ERR-RES-001` (404) |
| Event           | **`work-order.closed`**, `eventKey` `work-order.closed:{workOrderId}` (no version segment — a terminal row is frozen)                                                                                                                                                                                                                                                                                                                                                                       |
| Existing tests  | `tests/backend/p1-19-closure-gate-matrix.test.ts:237` and the nine cases after it; `tests/db/qms-closure-rework.test.ts:73`–`:164` drive B1–B5 and a clean close at the database                                                                                                                                                                                                                                                                                                            |
| Owning phase    | 1-19                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Closure is a **separate command behind a second permission**, and it is not an
alternate write path: both `transition` and `closure` funnel through one private
`move()` which checks the target state against the command it arrived on. A
terminal non-cancellation target is reachable **only** here; asking
`.../transition` for a closing state is refused with
`rule: 'closure_requires_closure_operation'`. Cancellation stays on
`.../transition` even though it is terminal, because the guard exempts a
cancellation from B1–B6.

### Does QA block delivery?

**Yes, in the contract — but the enforcement is entirely in the application.**

`sal.complete_delivery` enforces exactly three preconditions: an authorized
receiver row exists, every mandatory checklist item has a `passed` or `waived`
result, and at least one signature exists. It reads **no work-order state, no
quality-control outcome and no financial balance at all** — stated in
`apps/api/src/modules/delivery/application/delivery-read-service.ts:6-19` and
verified there against the deployed function body in
`supabase/migrations/20260724094000_sal_delivery.sql`.

The quality block therefore exists only because:

1. `DeliveryReadService.readQualityFact` (`delivery-read-service.ts:340`) calls
   `qualityModule().gate.evaluate(db, workOrderId)` and returns
   `passed: !failedWithoutPass && !mandatoryPassMissing && !unsignedSafetyCriticalRework`;
2. `composeEligibility` (`delivery/domain/delivery.ts:178`) pushes the blocker
   code **`quality_control_not_passed`** when that is false;
3. `DeliveryService.completeDelivery` **re-composes** eligibility inside the
   delivery row's lock and calls `assertEligible(decision)`
   (`delivery-service.ts:962`) before the write.

Three consequences for the journey:

- The blocker vocabulary is closed and the quality entry is a **single code**.
  All three `qms` conditions (B5a, B5b, B6) collapse into
  `quality_control_not_passed`, with `source: '@/modules/quality — gate.evaluate
(B5a, B5b, B6)'` on the `facts` array. A screen cannot say **which** one bit.
- `OVERRIDABLE_BLOCKERS` contains **exactly one** entry —
  `financial_balance_outstanding`, requiring `sal.delivery.complete`.
  **`quality_control_not_passed` is not overridable**, and
  `CompleteDeliveryInput` has no field through which it could be named.
- The eligibility read is `GET /deliveries/{deliveryId}/eligibility`
  (`sal.delivery-eligibility-read`, permissions `sal.delivery.view` **and**
  `sal.finance.view`), and it is the re-read that supplies the `If-Match` the
  completion requires.

## Fields the journey needs that the contract does not carry

| field the journey needs                                                          | nearest existing thing                                                                                                                                                | verdict                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The list of quality checks to tick off (code, name, mandatory, safety-critical)  | `qms.qc_checks` table; `QualityGateService.checks(db)` and `QualityRepository.qcChecks(db)` both exist and return `{ id, code, name, isMandatory, isSafetyCritical }` | **ABSENT from the contract.** No route calls `qualityModule().gate.checks` — grep of `gate\.checks` over `apps/api/src` returns **zero** hits outside the service itself. The checklist screen has no source, and `PUT /quality-controls/{recordId}/checks/{qcCheckId}` cannot be addressed                                                                          |
| Any seeded quality check at all                                                  | `qms.qc_checks`                                                                                                                                                       | **ABSENT.** Grep `INSERT INTO qms.qc_checks` and `qc_checks` over `supabase/seeds/` → **zero** matches. Only `tests/backend/p1-19-helpers.ts` and three DB test files insert rows. On a fresh tenant the catalogue is empty, so `unresolvedMandatory` is always `[]` and B5b can never fire                                                                          |
| Non-mandatory checks that have not been answered                                 | `unresolvedMandatory` filters on `check.isMandatory` (`quality-control-service.ts:149`)                                                                               | **ABSENT.** Optional checks that were never answered appear in neither `results` nor `unresolvedMandatory`. They are invisible                                                                                                                                                                                                                                       |
| The QC record's own notes                                                        | `qms.quality_control_records.notes` — accepted on §1 and §5, stored, `ck_quality_control_records_notes_not_blank`                                                     | **ABSENT from every response.** `QC_RECORD_COLUMNS` (`quality-repository.ts:112`) does not select `notes`, and `QcRecordView` has no such field. Write-only                                                                                                                                                                                                          |
| When a QC record changed result, and why                                         | `qms.qc_status_history` — trigger-written by `qms.emit_qc_status_history()`, with `from_state`, `to_state`, `reason`, `actor_id`, `occurred_at`, `seq`                | **ABSENT from the contract.** No route, no service method, no repository method reads it. Grep `qc_status_history` over `apps/api/src` → **zero** hits                                                                                                                                                                                                               |
| The checker's name                                                               | `QcRecordView.checkerId` (uuid)                                                                                                                                       | Present **as an opaque user uuid only.** Nothing in this domain resolves it to a person                                                                                                                                                                                                                                                                              |
| The lead technician's and signer's names                                         | `ReworkLinkView.leadTechnicianId`, `.independentSignOffBy` (uuids into `tech.technician_profiles`)                                                                    | Present **as opaque uuids only.** A branch roster of profile ids exists (`GET /technicians/available` — see the next table) but **carries no name either**: its items are `{ technicianProfileId, eligible, findings }`. **Nothing anywhere in this domain or in `tech`'s routed surface resolves a technician profile id to a person's name**                       |
| Who requested a reopen                                                           | `ReopenAttemptView.requestedBy` (uuid — a **user** id, from `iam.current_user_id()`)                                                                                  | Present as an opaque uuid. Note the deliberate inconsistency with rework, which names **technician profiles**                                                                                                                                                                                                                                                        |
| When a rework case was raised                                                    | `qms.rework_links.created_at` exists in the table                                                                                                                     | **ABSENT from the response.** `REWORK_COLUMNS` (`quality-repository.ts:142`) does not select `created_at`, and `ReworkLinkView` has no `createdAt`. Only `signOffAt` carries a time                                                                                                                                                                                  |
| When a QC record was opened                                                      | `qms.quality_control_records.created_at` exists                                                                                                                       | **ABSENT from the response.** `QcRecordView` carries only `finalizedAt`, which is null until finalisation. A list of records has no date to sort or display                                                                                                                                                                                                          |
| A responsibility category to choose from (supplier, technician, parts, process…) | `qms.rework_links.responsibility` — `text NULL`, `ck_rework_links_responsibility_not_blank` only                                                                      | **FREE TEXT. There is no enum, no CHECK vocabulary and no catalogue table.** Inventing a picker list here would repeat the `ADDRESS_TYPES` failure exactly                                                                                                                                                                                                           |
| The state of the rework work order (is the rework done?)                         | `ReworkLinkView.reworkWorkOrderId` (uuid)                                                                                                                             | **ABSENT from this domain's responses.** The link carries no state, no status and no completion flag. Progress must be read from `GET /work-orders/{reworkWorkOrderId}` in the work-order domain                                                                                                                                                                     |
| The original work order's number or the vehicle it belongs to                    | `ReworkLinkView.originalWorkOrderId` (uuid)                                                                                                                           | **ABSENT.** No display number, no vehicle, no customer on any `qms` projection                                                                                                                                                                                                                                                                                       |
| A "rework is finished" fact                                                      | Nothing in `qms`                                                                                                                                                      | **ABSENT by design.** Rework completion is the **rework work order closing**, which B6 gates on the sign-off. There is no separate resolution, closure or completion field on `qms.rework_links`                                                                                                                                                                     |
| A total count for any list                                                       | Nothing                                                                                                                                                               | **ABSENT.** Pagination is keyset (`{ items, nextCursor, hasMore }`) and **there is no `total` anywhere**; here even the keyset envelope is absent — all four lists return bare `{ items }`                                                                                                                                                                           |
| A cursor or page size on any QC or rework list                                   | Nothing                                                                                                                                                               | **ABSENT.** No list in this domain reads a query parameter of any kind                                                                                                                                                                                                                                                                                               |
| An `ETag` on the rework-cost read or the closure-eligibility read                | Both return `{ body }` with no `recordVersion` passed to the handler                                                                                                  | **ABSENT.** Neither publishes an `ETag`, so neither can supply an `If-Match`                                                                                                                                                                                                                                                                                         |
| Odometer, mileage or vehicle condition at QC                                     | Nothing in `qms`                                                                                                                                                      | **ABSENT from this domain.** Belongs to the Vehicle or Delivery archaeology                                                                                                                                                                                                                                                                                          |
| A photo or attachment on a QC record or a rework case                            | Nothing in `qms`                                                                                                                                                      | **ABSENT.** `qms` has no evidence table. The inspection-side table is **`dia.diagnostic_evidence`** (`supabase/migrations/20260722103000_dia_findings_measurements_evidence.sql:266`) — note the name, there is no `dia.evidence` — and it hangs off a diagnostic report, not a QC record; the generic attachments surface (`/attachments/**`) is a different domain |

## Operations the journey needs that do not exist

| needed operation                                                      | why the journey needs it                                                                                                                                                                                                                        | owning Backend phase                                                          | what exists instead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /quality-checks` (list the tenant's QC check catalogue)          | **The QC screen cannot be built without it.** `qcCheckId` is a **path parameter** of the only operation that records an outcome, and the only other source of one is `unresolvedMandatory`, which shows the mandatory subset of a single record | Phase 1-19 owns `qms`; the catalogue surface was never routed                 | `QualityGateService.checks(db)` and `QualityRepository.qcChecks(db)` — live methods with **no HTTP caller**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST` / `PUT` / `DELETE` `/quality-checks` (configure the catalogue) | A tenant cannot define a single quality check, so quality control is inert out of the box and B5b can never fire                                                                                                                                | Phase 1-19; the table is Phase 1-9 (`20260722093000_dia_qms_catalogs.sql:75`) | **Nothing.** No write path to `qms.qc_checks` exists in the API, and no seed inserts a row. There is also **no permission code** for managing it — grep `qms\.` over the catalogue seed returns exactly five codes, none of them a catalogue-management code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET /quality-controls/{recordId}/history`                            | "When did this record go from pending to failed, and who moved it" cannot be answered                                                                                                                                                           | Phase 1-19                                                                    | `qms.qc_status_history` is trigger-written and reachable from no code path in `apps/api`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A **named** branch roster of technician profiles                      | The rework form needs a `leadTechnicianId` picker and the sign-off needs a `signOffBy` picker, both **technician profile** ids. A picker of bare uuids is unusable by a workshop                                                                | Phase 1-19 (`tech`)                                                           | **`GET /technicians/available` does enumerate the roster** — `tech.technician-available`, permission `tech.technician.read` (seeded, catalogue line 204, risk `low`), `scope: 'branch'`. Query is `.strict()`: **`companyId`, `branchId`, `from`, `to` are REQUIRED**; **`skills` and `certifications` are OPTIONAL**, so omitting them returns every active profile in the branch. Response `{ items: [{ technicianProfileId, eligible, findings }], truncatedAt }`, sorted eligible-first then by id, capped at `MAX_CANDIDATES` = 50 with the cap reported in `truncatedAt` (`technician-eligibility-service.ts:180`, `technician-catalog-repository.ts:205`). What is missing is only the **name** — and the fact that a picker must invent a `from`/`to` window to ask. Also `GET /technicians/{technicianProfileId}/queue` (`tech.technician-queue`), which needs an id you already have |
| A branch-wide QC worklist (`GET /quality-controls`)                   | There is no QA queue. A quality controller cannot see the vehicles awaiting a check; they must already know a work-order id                                                                                                                     | Phase 1-19                                                                    | `GET /work-orders/{workOrderId}/quality-controls` — one work order at a time, **unpaginated**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A branch-wide rework register (`GET /rework-links`)                   | "How much rework did this branch raise this month, and how much is unsigned" has no source. This is the primary quality KPI screen                                                                                                              | Phase 1-19                                                                    | `GET /work-orders/{workOrderId}/rework` — one **original** work order at a time, unpaginated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Listing rework links by their **rework** side                         | Given a rework work order, nothing over HTTP tells you what it corrects or whether B6 is holding it                                                                                                                                             | Phase 1-19                                                                    | `QualityGateService.reworkLinks(db, workOrderId)` — an internal port used by the closure gate, with **no HTTP caller**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Pagination on any of the four lists                                   | Every list returns every live row unbounded. A busy branch's reopen-attempt ledger grows forever and is never truncated (`qms.reopen_attempts` has no soft delete)                                                                              | Phase 1-19                                                                    | Bare `{ items }` on all four                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Correcting or withdrawing a QC record                                 | A record opened against the wrong work order cannot be removed. `deleted_at` exists on the table and **nothing writes it**                                                                                                                      | Phase 1-19                                                                    | Only §5's forward finalisation, which is one-way. A wrongly opened **pending** record stays pending for ever and is invisible to closure (only `passed`/`failed` records matter to B5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Correcting a rework link's root cause or corrective action            | Both are `text NOT NULL` and the service has no update method                                                                                                                                                                                   | Phase 1-19                                                                    | Nothing. `org.guard_immutable_columns` freezes the ids and the lead technician; the two free-text fields are simply never updated by any code path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Withdrawing an incorrect sign-off                                     | A signature applied to the wrong link is permanent                                                                                                                                                                                              | Phase 1-19                                                                    | `qms.guard_rework_signoff` makes it **write-once** by design, and `ERR-TRN-001` is returned on a second attempt. This is intended, not an oversight — but a screen must not offer an undo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Any read that tells a screen **which half of B5** is blocking         | The remedies differ: "re-run quality control and pass it" versus "a mandatory check is configured and no check has ever passed"                                                                                                                 | Phase 1-19                                                                    | `QualityGateStatus` splits them (`failedWithoutPass`, `mandatoryPassMissing`) but is **not on the wire**; `blockers` carries one `B5` with one message                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| An `ETag` on `closure-eligibility`                                    | The closure command is `versionGuarded`, and the natural re-read before closing is the eligibility check — which publishes no version                                                                                                           | Phase 1-19                                                                    | `GET /work-orders/{workOrderId}` (`wo.work-order-detail`) must be called as a second request purely to obtain the `If-Match`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## What I searched and did not find

Exact paths and patterns, so the next reader does not repeat them.

**Module name.** `Get-ChildItem apps/api/src/modules -Directory` → 19 modules.
The quality module is **`quality`** (not `qms`, not `qa`), at
`apps/api/src/modules/quality/`, containing exactly six files:
`index.ts`, `application/quality-control-service.ts`,
`application/quality-gate-service.ts`, `application/rework-service.ts`,
`data/quality-repository.ts`, `domain/quality.ts`. The **schema** it owns is
`qms`. `index.ts` is the only legal import path (ADR-001).

**Routes.** Glob `apps/api/src/app/api/v1/**/route.ts` → 203 files. Filtering the
full list on `rework|quality|qc` yields exactly **eight** files:

- `quality-controls/[recordId]/route.ts`
- `quality-controls/[recordId]/checks/[qcCheckId]/route.ts`
- `quality-controls/[recordId]/finalization/route.ts`
- `rework-links/[reworkLinkId]/route.ts`
- `rework-links/[reworkLinkId]/cost/route.ts`
- `rework-links/[reworkLinkId]/sign-off/route.ts`
- `work-orders/[workOrderId]/quality-controls/route.ts`
- `work-orders/[workOrderId]/rework/route.ts`

plus `work-orders/[workOrderId]/reopen-attempts/route.ts`, found by grepping
`qualityModule` (12 files, 9 of them routes). **There is no `/qa/**`, no
`/quality-checks/**`, no `/qc/**` and no `/quality/**` path segment anywhere.**
The URL vocabulary is `quality-controls`, `rework-links` and `reopen-attempts`.

**Unrouted service surface.** Grep `gate\.checks|qc-checks|qcChecks|gate\.evaluate|gate\.reworkLinks`
over `apps/api/src` → 11 hits. `gate.evaluate` has exactly two callers, both
cross-module (`work-order-service.ts:1206`, `delivery-read-service.ts:344`).
**`gate.checks` and `gate.reworkLinks` have no caller anywhere** — not a route,
not another module. `qcChecks` is called only inside the quality module itself.

**QC check catalogue seeding.** Grep `qms\.qc_checks` repository-wide → **24**
files, one of which is this document. The inserts are in `tests/db/helpers.ts`, `tests/db/foundation.test.ts`,
`tests/db/org-security.test.ts`, `tests/db/p1-09-security.test.ts`,
`tests/backend/p1-19-helpers.ts`, `tests/backend/p1-19-quality-rework.test.ts`
and `tests/backend/p1-22-concurrency.test.ts` — **all tests**. Grep `qc_checks`
over `supabase/seeds/` → **zero matches**. No seed ships a quality check, which
is consistent with the standing no-fake-data policy and means B5b is dormant on
every real tenant.

**QC status history.** Grep `qc_status_history|qc-status-history|/quality-controls/\{recordId\}/history`
over `apps/api/src` → **zero files**. The table is created at
`20260722104000_qms_quality_control.sql:181` and written by
`qms.emit_qc_status_history()` (line 255). Nothing reads it.

**Permissions.** Grep `qms\.` over `supabase/seeds/04_iam_permission_catalog.sql`
→ exactly **five** codes, at lines 221, 222, 226, 227, 228:
`qms.quality_control.record` (medium), `qms.quality_control.finalize` (high),
`qms.rework.manage` (high), `qms.rework.sign_off` (high),
`qms.quality_control.read` (low). Every one is used by a route and every one is
seeded — **no invented code and no orphan**. The **four** non-`qms` codes named
anywhere in this file are also seeded: `iam.sensitive.view` (line 31, high) and
`wo.work_order.transition` (line 178, medium), which the thirteen `qms`
operations use directly; and `wo.work_order.read` (line 172, low) plus
`wo.work_order.close` (line 181, high), which belong to §14 and §15. A fifth,
`tech.technician.read` (line 204, low), gates the technician roster named in the
tables above. There is **no** catalogue- or
check-management permission, which corroborates that the `qms.qc_checks` surface
was never intended to be routed in this phase.

**OpenAPI.** Grep `"operationId": "qms\.` over `docs/api/openapi.v1.json` → **13
entries**, at lines 8934, 8988, 9048, 10080, 10134, 10186, 10246, 13389, 13441,
13501, 13559, 13725, 13783. Exactly the thirteen above: **no documented operation
lacks a route and no route lacks documentation.** The two work-order closure
operations are at lines 13101 and 13167. Every one of the fifteen documents its
success response as `200` with schema `{"type": "object"}` — see the warning
about §1, §6 and §8 returning `201`.

**Rework "status" or "resolution".** `CREATE TABLE qms.rework_links` at
`20260722105000_qms_rework_closure_gate.sql:103`, read in full. Columns are
`id`, `tenant_id`, `company_id`, `branch_id`, `original_work_order_id`,
`rework_work_order_id`, `root_cause`, `corrective_action`, `responsibility`,
`lead_technician_id`, `is_safety_critical`, `independent_sign_off_by`,
`sign_off_at`, `record_version` and the six audit/soft-delete columns.
**There is no status, no resolution, no resolved_at, no closed_by and no
completion flag.** Rework completion is the rework work order closing, and
nothing else.

**Responsibility vocabulary.** `ck_rework_links_responsibility_not_blank` (line 142) is the only constraint on `responsibility`. Grep for a `responsibility`
CHECK with an `IN (...)` list, and for any `RESPONSIBILITY` constant in
`apps/api/src/modules/quality` → **nothing**. It is free text.

**Frozen vocabularies actually present in this domain**, with the CHECK
constraint that fixes each:

| constant (`domain/quality.ts`)           | members verbatim                                      | CHECK constraint                        |
| ---------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| `QC_OVERALL_RESULTS`                     | `'pending'`, `'passed'`, `'failed'`                   | `ck_quality_control_records_result`     |
| `QC_CHECK_RESULTS`                       | `'pass'`, `'fail'`, **`'na'`** (not `not_applicable`) | `ck_qc_check_results_result`            |
| `QC_CHECK_STATUSES`                      | `'active'`, `'inactive'`                              | `ck_qc_checks_status`                   |
| reopen `outcome`                         | `'rejected'` — a **one-member** vocabulary            | `ck_reopen_attempts_outcome`            |
| rework cost `classification`             | `'restricted'` — a one-member vocabulary              | `ck_rework_link_details_classification` |
| `WORK_ORDER_KINDS` (`work-order` domain) | `'ordinary'`, `'rework'`                              | `ck_work_orders_kind`                   |

Length bounds exported from `domain/quality.ts`: `MAX_ROOT_CAUSE` 2000,
`MAX_CORRECTIVE_ACTION` 2000, `MAX_REOPEN_REASON` 1000, `MAX_QC_NOTE` 2000.
These are **application** bounds; the database CHECKs only require non-blank.

**Column types that arrive as strings.** `qms.rework_link_details.rework_cost` is
`numeric(14, 4)` — the **only** numeric-as-string in this domain. It is selected
as `rework_cost::text` in both the write and the read
(`quality-repository.ts:676`, `:719`). `cost_currency` is `text` with a
`^[A-Z]{3}$` CHECK and a `'JOD'` default. `qms.qc_status_history.seq` is
`bigint GENERATED ALWAYS AS IDENTITY` and is **not projected anywhere**. There is
no other `numeric` or `bigint` in `qms`.

**Pagination contract.** `apps/api/src/server/db/pagination.ts` defines `Page<T>`
as `{ items, nextCursor, hasMore }` with **no `total`**. **No operation in this
domain uses it.** All four lists build `{ items: await …() }` inline in the route
and read no query parameters at all.

**Idempotency.** `apps/api/src/server/http/idempotency.ts:41` —
`IDEMPOTENCY_HEADER = 'idempotency-key'`, length 8–200. Missing or malformed →
`ERR-INT-002`; same key with a different fingerprint → `ERR-INT-001`. The
fingerprint binds the **resolved** path parameters, not just the template
(P1-15-SR-002). **Seven** of the thirteen require it: §1, §4, §5, §6, §8, §11 and
§12. The six that do not are all reads (§2, §3, §7, §9, §10, §13). The
work-order closure operation §15 also requires it.

**Error codes.** `apps/api/src/server/errors/catalog.ts` — every code this domain
raises is registered: `ERR-VAL-001` (422), `ERR-IAM-001` (**403**, not permitted),
`ERR-IAM-002` (401, authentication required), `ERR-RES-001` (404),
`ERR-RES-002` (409), `ERR-CON-001` (409), `ERR-CON-002` (**428**),
`ERR-INT-001`/`ERR-INT-002` (idempotency), `ERR-TRN-001` (409, line 296),
**`ERR-WO-001`** (409, "Work order cannot be closed yet", line 306 — the B1–B6
gate, deliberately **not** `ERR-TRN-001`), **`ERR-QMS-001`** (409, "Quality or
rework precondition not satisfied", line 346 — the QMS refusals that are _not_
closure blockers), `ERR-SYS-001`.

**Events.** Grep `quality-control.finalized|rework.linked` repository-wide → **18**
files, three of which are P1-27 journey-archaeology documents written in this
batch (this one, `work-order-core.md`, `histories-and-events.md`); the other
fifteen are the code, the tests and the Phase 1-19 evidence.
The registry is `apps/api/src/server/events/envelope.ts` at lines 383
(`EVT-QMS-001`) and 392 (`EVT-QMS-002`). **These are the only two events this
domain emits.** Nothing is published on opening a record, recording a check
outcome, recording a reopen attempt, signing off rework or recording a cost —
despite `EVT-QMS-002`'s description saying "linked … **or signed off**", which
`ReworkService.signOff` does not honour. `ECR-P1-19-001` at
`docs/phase-1/phase-1-19/change-requests/ECR-P1-19-001-event-catalog.md` is the
recorded change request against the event catalogue and is noted in the standing
memory as **still Open**.

**Delivery coupling.** Grep `gate\.evaluate` → two callers only.
`apps/api/src/modules/delivery/domain/delivery.ts:60` defines `BLOCKER_CODES` as
a closed eight-member vocabulary containing exactly one quality entry,
`quality_control_not_passed`; `OVERRIDABLE_BLOCKERS` (line 90) contains exactly
one entry and it is **not** the quality one.
`apps/api/src/modules/delivery/application/delivery-service.ts:962` calls
`assertEligible(decision)` after recomposing inside the lock.

**Inspections are a different domain.** `dia.diagnostic_reports` and the
`/inspections/**` routes belong to the `diagnostics` module and are covered by
`docs/phase-1/phase-1-27/journey-archaeology/diagnostics-and-inspection.md`. The
only link between them here is closure blocker **B4**, which reads
`dia.diagnostic_reports.status = 'completed'`. There is **no** `qms` table that
references `dia`, and no QC operation reads an inspection.

**Delivery checklists are not QC checks.** `sal.delivery_checklist_results` is
the handover checklist in the `delivery` module — a different table, a different
vocabulary and a different gate. Its `outcome` vocabulary is
**`'passed'`, `'failed'`, `'waived'`** — three members, fixed by
`ck_delivery_checklist_results_outcome`
(`20260724094000_sal_delivery.sql:219`), and **not** the two-member list an
earlier reading of the gate suggested: `passed`/`waived` is the pair that
_clears_ the gate inside `sal.complete_delivery` (line 447), not the set of
values the column accepts. `ck_delivery_checklist_results_waiver` (line 220)
additionally makes `waiver_reason` required exactly when the outcome is
`waived`. The blocker code is `checklist_incomplete`. Do not merge the two
vocabularies on one screen, and do not reuse `pass`/`fail`/`na` here — the QC
vocabulary is a different set of three words.

**Tests.** Four files carry this domain, all located by
`Get-ChildItem -Include *.test.ts` filtered on `qual|qms|rework|reopen|closure|qc`:

- `tests/backend/p1-19-quality-rework.test.ts` — the operation suite, cited per
  operation above; eight `describe` blocks at lines 335, 505, 597, 735, 807, 904,
  1121, 1342.
- `tests/backend/p1-19-closure-gate-matrix.test.ts` — ten cases at lines 237–508
  that isolate each blocker against a baseline order that closes cleanly.
- `tests/db/qms-closure-rework.test.ts` — schema, guards and RLS: blockers at
  lines 73–164, BR-WO-002 at 175, BR-QMS-001 at 191, F10 finalisation
  immutability at 242.
- `tests/db/p1-19-closure-blocker-reconciliation.test.ts` — reconciles
  `CLOSURE_BLOCKER_REGISTRY` against the **deployed** `wo.guard_work_order_closure`
  body: the codes raised (line 45), the declared enforcer (54), the terminal gate
  and cancellation exemption (60), `check_violation` on every blocker (72), the
  B5 split (85), and that **no reservation or part-issue blocker exists** (96).

`tests/foundation/p1-19-module-foundation.test.ts` additionally pins the module
boundary (`quality` may touch only `qms`, line 68), the sibling-schema list
(line 72), the `qms.attempt_reopen` call shape (line 134) and the two event
codes (line 351).
