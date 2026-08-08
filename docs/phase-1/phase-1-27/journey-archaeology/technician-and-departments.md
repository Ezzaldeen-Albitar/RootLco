# P1-27 journey archaeology — technician assignment, departments and work logs

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Read at:** `develop` `a56eeea0a10d56cd17827ec443dd5ecff40f8c0d`

## Verdict

Ten operations exist across this domain and every one of them was opened —
route, service, repository and `docs/api/openapi.v1.json` entry. Together they
support exactly one journey: **given a job that already exists, assign a
technician to it, hand it to another technician, end the assignment, run the
labour clock against it, and read back both the assignment history and the
labour log.** Every one of those is gated on `tech.assignment.manage`,
`tech.labor.record`, `tech.labor.correct` or `tech.technician.read`, and all four
codes are in `supabase/seeds/04_iam_permission_catalog.sql`. What the domain
cannot support is everything that comes _before_ an assignment and everything
that comes _after_ it. **No operation creates, edits, deactivates, lists or reads
a technician** — of the nine `tech` tables, exactly one, `tech.labor_sessions`,
is written by a service, and the three catalogue tables are not even seeded, so
an assignment screen has nothing to populate its picker from and a skill or
certification requirement will match nothing on a fresh installation.
**No operation assigns work to a department, because no operational record can
hold one**: `department_id` exists as a column in exactly one table in the whole
schema, `iam.grant_scopes`, where it narrows a permission grant. **No operation
notifies an assigned employee**: assignment publishes a `job.assigned` outbox
event, and `registerConsumer()` is called by no production file, so nothing
consumes it. And **there is no work-log entry with an action enum at all** — the
only "log" is a labour session with `started_at`, `ended_at` and a `source`
column of three values the caller cannot set; of the seventeen technician actions
the Owner listed, two exist as this domain's operations, thirteen exist only as
operations in other domains that a screen must compose by hand, and two exist
nowhere. One live defect is carried forward into any screen built on this
surface: the labour-log page cursor is minted from a JavaScript `Date` and
**silently drops rows** (§ _Fields the journey needs_).

---

## Operations that exist

Ten operations. All ten were read in four places: the route module, the
application service, the repository, and `docs/api/openapi.v1.json`.

Three facts apply to every row below and are not repeated in each table:

- **Pagination is keyset.** Where a page exists it is
  `{ items, nextCursor, hasMore }` (`apps/api/src/server/db/pagination.ts:45`).
  There is no `total` anywhere in this domain.
- **`limit`** is `z.coerce.number().int().min(1).max(100)`
  (`apps/api/src/server/http/validation.ts:220`), clamped again by
  `resolveLimit()`.
- **`docs/api/openapi.v1.json` is NOT the error surface.** The document declares
  only `401`, `403`, `409`, `422`, `428`, `429` and `500`; the strings `"400":`
  and `"404":` appear **zero times in the whole file**, for any operation in any
  domain. Every `404 ERR-RES-001` and every `400 ERR-INT-002`/`ERR-PAG-001` in
  the tables below is real — it comes from the service and is asserted by a test
  — and is simply absent from the OpenAPI. A client generated from that document
  will have no branch for the two most common failures on this surface. Where a
  row says "OpenAPI at …" it is a **locator for the operation object**, not a
  claim that the listed statuses are declared there.

### 1. `tech.technician-available`

| row                 | value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operation ID**    | `tech.technician-available` — `apps/api/src/app/api/v1/technicians/available/route.ts:72`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Route**           | `/api/v1/technicians/available`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Method**          | `GET`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Permission**      | `tech.technician.read` — in the catalogue at `supabase/seeds/04_iam_permission_catalog.sql:204`, risk `low`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Request schema**  | Query, `.strict()`. `companyId` (uuid, **required**) · `branchId` (uuid, **required**) · `from` (`z.string().datetime({ offset: true })`, **required**) · `to` (same, **required**) · `skills` (optional string, regex `^[a-z0-9_.-]{1,64}:\d{1,4}(,[a-z0-9_.-]{1,64}:\d{1,4})*$` case-insensitive — comma-separated `code:minimumRank` pairs) · `certifications` (optional string, regex `^[a-z0-9_.-]{1,64}(,[a-z0-9_.-]{1,64})*$` case-insensitive) · `limit` (optional). Any other key is a 422 for the whole request.                                                                                                                    |
| **Response schema** | `{ items: [{ technicianProfileId: string, eligible: boolean, findings: [{ reason: string, subject?: string }] }], truncatedAt: number \| null }`. **Not a page.** `findings[].reason` is one of the nine members of `INELIGIBILITY_REASONS` (`apps/api/src/modules/technician/domain/technician.ts:36`): `profile-inactive`, `profile-out-of-scope`, `skill-missing`, `skill-level-insufficient`, `certification-missing`, `certification-expired`, `certification-revoked`, `availability-missing`, `availability-blocked`. `subject` is the catalogue code at fault.                                                                        |
| **Scope**           | `branch`. The target comes from the query through `scopeTargetOption(raw)` (`validation.ts:243`), so `iam.has_permission_in_scope` is evaluated against the named branch. Without both `companyId` and `branchId` the target is absent and the check falls back to scope-blind `iam.has_permission` — which is why both are required.                                                                                                                                                                                                                                                                                                         |
| **Pagination**      | **None.** Bounded instead: `MAX_CANDIDATES = 50`, applied as `Math.min(query.limit ?? 50, 50)` (`available/route.ts:114`). The cap is reported back as `truncatedAt`, whose value is **the effective limit, not always `50`** — `truncatedAt: profiles.length > limit ? limit : null` (`technician-eligibility-service.ts:205`), so a caller sending `limit=10` against a branch holding eleven active profiles gets `truncatedAt: 10`. A screen that hard-codes `50` to detect truncation will miss it; `null` means nothing was truncated. Candidate ordering is `eligible` first, then `technicianProfileId` ascending by `localeCompare`. |
| **Idempotency**     | Not applicable — `idempotent` is not declared on a `GET`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Concurrency**     | None. No `If-Match`, no `recordVersion` in the response.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Audit**           | `auditClass: 'none'` — nothing is written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Error codes**     | `401` · `403` (including a branch the caller is not permitted in) · `422` `ERR-VAL-001` (missing or malformed query, unknown key) · `429` · `500`. Declared identically at `docs/api/openapi.v1.json:11011-11062`. **No 404** — an empty branch answers `{ items: [], truncatedAt: null }`.                                                                                                                                                                                                                                                                                                                                                   |
| **Event**           | None.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Existing tests**  | `tests/backend/p1-19-job-assignments.test.ts:905-1030` — three cases: ranks every active candidate eligible-first; requires the scope and the window and refuses a malformed skill encoding; 401/403/403-for-another-branch.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Owning phase**    | P1-19 (`P1-19-BE-016`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Service: `TechnicianEligibilityService.candidates()`
(`apps/api/src/modules/technician/application/technician-eligibility-service.ts:180`).
Repository: `TechnicianCatalogRepository.activeProfilesInBranch()`, `.heldSkills()`,
`.heldCertifications()`, `.availability()`
(`apps/api/src/modules/technician/data/technician-catalog-repository.ts`).

**Two behaviours a screen must not get wrong.** Availability is judged against
the **union** of a technician's `available` intervals (`coveredByUnion`), so a
split shift covers a window that no single row spans; and an overlapping
`unavailable` row wins outright over any `available` row. Certification expiry is
**inclusive** — a certification expiring on the day of work is valid that day —
and `expires_on` is read as `to_char(expires_on, 'YYYY-MM-DD')`, a calendar date,
never an instant.

### 2. `tech.technician-queue`

| row                 | value                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operation ID**    | `tech.technician-queue` — `apps/api/src/app/api/v1/technicians/[technicianProfileId]/queue/route.ts:30`                                                                                                                                                                                              |
| **Route**           | `/api/v1/technicians/{technicianProfileId}/queue`                                                                                                                                                                                                                                                    |
| **Method**          | `GET`                                                                                                                                                                                                                                                                                                |
| **Permission**      | `tech.technician.read`                                                                                                                                                                                                                                                                               |
| **Request schema**  | Path only: `technicianProfileId` (uuid). **No query parameters at all** — no `limit`, no `cursor`, no state filter. No body.                                                                                                                                                                         |
| **Response schema** | `{ technicianProfileId: string, items: [{ assignmentId, jobId, workOrderId, assignmentRole, validFrom, jobTitle, jobState, workOrderState, displayNumber }] }`. `validFrom` is an ISO string; `displayNumber` is `string \| null`; `assignmentRole` is `primary` or `assist`. All other fields text. |
| **Scope**           | `branch`, evaluated against the **profile's own** `companyId`/`branchId`, resolved through `technicianModule().eligibility.profile()` **before** any `wo` row is read — so an out-of-scope id 404s without touching an assignment.                                                                   |
| **Pagination**      | **None. Unbounded array.** SQL order is `a.valid_from DESC, a.id DESC` (`work-order-repository.ts:1668`); only rows with `valid_to IS NULL` are returned. A technician with a long queue returns every row in one response.                                                                          |
| **Idempotency**     | Not applicable.                                                                                                                                                                                                                                                                                      |
| **Concurrency**     | None.                                                                                                                                                                                                                                                                                                |
| **Audit**           | `auditClass: 'none'`.                                                                                                                                                                                                                                                                                |
| **Error codes**     | `401` · `403` · `404` `ERR-RES-001` (unknown profile, or a profile in another tenant — the two are indistinguishable by design) · `422` (malformed uuid) · `429` · `500`. OpenAPI at `docs/api/openapi.v1.json:10957-11008`.                                                                         |
| **Event**           | None.                                                                                                                                                                                                                                                                                                |
| **Existing tests**  | `tests/backend/p1-19-job-assignments.test.ts:807-900` — three cases, one of which asserts the projection discloses **no** employee-derived detail beyond the profile id the caller named (no user id, no trade, no employment reference, nothing from `tech.technician_certification_details`).      |
| **Owning phase**    | P1-19 (`P1-19-BE-016`)                                                                                                                                                                                                                                                                               |

Service: `JobAssignmentService.queue()`
(`apps/api/src/modules/work-order/application/job-assignment-service.ts:348`).
Repository: `WorkOrderRepository.queueFor()` (`work-order-repository.ts:1640`) —
one query joining `wo.job_assignments`, `wo.jobs` and `wo.work_orders`, so the
queue is not an N+1.

### 3. `wo.job-assignment-create`

| row                 | value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Operation ID**    | `wo.job-assignment-create` — `apps/api/src/app/api/v1/jobs/[jobId]/assignments/route.ts:80` (module `work-order`, permission prefix `tech`)                                                                                                                                                                                                                                                                                                                                                                              |
| **Route**           | `/api/v1/jobs/{jobId}/assignments`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Method**          | `POST`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Permission**      | `tech.assignment.manage` — catalogue line 195, risk `medium`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Request schema**  | Body, `.strict()`: `technicianProfileId` (uuid, **required**) · `assignmentRole` (optional, enum **`'primary'` \| `'assist'`** from `ASSIGNMENT_ROLES`, verbatim from `ck_job_assignments_role`; the service defaults it to `primary`) · `requiredSkills` (optional array, max 20, of `.strict()` `{ skillCode: string 1–64, minimumRank: integer 1–1000 }`) · `requiredCertificationCodes` (optional array of string 1–64, max 20) · `window` (**required**, `.strict()` `{ from, to }`, both ISO 8601 **with offset**) |
|                     | **There is no `reason` field and sending one is a 422.** `wo.job_assignments.reason` is the _end_-of-assignment reason (`ck_job_assignments_end_reason`). There is no `departmentId`, no `priority`, no `instructions` and no `dueAt`.                                                                                                                                                                                                                                                                                   |
| **Response schema** | `201` · `AssignmentView` = `{ id, jobId, technicianProfileId, assignmentRole, validFrom, validTo: string \| null, reason: string \| null, recordVersion: number }`. **`createdBy` is not published.**                                                                                                                                                                                                                                                                                                                    |
| **Scope**           | `branch`, from the **job's** `companyId`/`branchId` after `lockJob()`. The eligibility requirement is built with the job's scope, so a profile in another branch is ineligible by construction; the composite FK to `tech.technician_profiles` is the database backstop.                                                                                                                                                                                                                                                 |
| **Pagination**      | Not applicable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Idempotency**     | **`idempotent: true` — the `Idempotency-Key` header is MANDATORY.** `requireIdempotencyKey()` (`apps/api/src/server/http/idempotency.ts:52`) throws `ERR-INT-002` (**400**) when absent or outside 8–200 characters; a key reused with a different fingerprint is `ERR-INT-001` (**409**).                                                                                                                                                                                                                               |
| **Concurrency**     | No `If-Match`. The response carries `recordVersion`, which becomes the ETag.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Audit**           | `auditClass: 'privileged'`, action **`wo.job.assigned`** (`audit-actions.ts:815`, entity type `wo.job_assignment`). Details: `job_id` (`internal`), `technician_profile_id` (`internal`), `assignment_role` (`public`).                                                                                                                                                                                                                                                                                                  |
| **Error codes**     | `400` `ERR-INT-002` · `401` · `403` · `409` `ERR-RES-002` (`primary_already_assigned`, from the read-before-write and from `uq_job_assignments_active_primary` on a lost race) · `409` `ERR-TRN-001` (terminal job state, or terminal parent work-order state) · `409` `ERR-INT-001` · `404` `ERR-RES-001` (job not visible; technician not visible in scope) · `422` `ERR-TECH-001` (**every** ineligibility reason at once, in `violations[]` with `rule` = the reason code) · `422` `ERR-VAL-001` · `429` · `500`     |
| **Event**           | **`job.assigned`** (`EVT-TEC-001`, `envelope.ts:329`). Aggregate type `wo.job`, aggregate id the **job** id, `aggregateVersion: 1`, producer `wo.job-assignment-service`, event key `job.assigned:{assignmentId}`. Payload: `{ jobId, assignmentId, assignmentRole }`.                                                                                                                                                                                                                                                   |
| **Existing tests**  | `tests/backend/p1-19-job-assignments.test.ts:281-572` — eight cases including "reports EVERY ineligibility reason at once", the split-shift window, the forced primary race, terminal job and terminal parent, and a replayed idempotency key.                                                                                                                                                                                                                                                                           |
| **Owning phase**    | P1-19 (`P1-19-BE-013`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**The requirement is supplied, not stored.** There is no
`wo.job_required_skills` table and nothing on `wo.jobs` holds a skill or
certification requirement. `requiredSkills` and `requiredCertificationCodes` are
evaluated at assignment time and then discarded — they are not persisted and
cannot be re-checked or re-displayed afterwards.

### 4. `wo.job-assignment-list`

| row                 | value                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Operation ID**    | `wo.job-assignment-list` — `apps/api/src/app/api/v1/jobs/[jobId]/assignments/route.ts:130`                                                                                                                   |
| **Route**           | `/api/v1/jobs/{jobId}/assignments`                                                                                                                                                                           |
| **Method**          | `GET`                                                                                                                                                                                                        |
| **Permission**      | **`tech.technician.read`** — not `wo.work_order.read`. A caller who may read the work-order board is not thereby entitled to the roster.                                                                     |
| **Request schema**  | Path only: `jobId` (uuid). No query parameters. No body.                                                                                                                                                     |
| **Response schema** | `{ items: AssignmentView[] }` — the same `AssignmentView` as above, **ended rows included** (`validTo` non-null, `reason` non-null).                                                                         |
| **Scope**           | `branch`, from the job's own scope via `findJob()` then `authorizeScope`.                                                                                                                                    |
| **Pagination**      | **None. Unbounded array.** SQL order `valid_from DESC, id DESC` (`work-order-repository.ts:1628`). The set of rows for a job _is_ its assignment history; nothing is ever deleted.                           |
| **Idempotency**     | Not applicable.                                                                                                                                                                                              |
| **Concurrency**     | None.                                                                                                                                                                                                        |
| **Audit**           | `auditClass: 'none'`.                                                                                                                                                                                        |
| **Error codes**     | `401` · `403` · `404` `ERR-RES-001` · `422` · `429` · `500`. OpenAPI at `docs/api/openapi.v1.json:6615-6666`.                                                                                                |
| **Event**           | None.                                                                                                                                                                                                        |
| **Existing tests**  | `tests/backend/p1-19-job-assignments.test.ts:574-678`, shared with `wo.job-assignment-end`. `scripts/check-operation-test-coverage.mjs:670` declares its required tiers as `denial` and `cross-tenant` only. |
| **Owning phase**    | P1-19 (`P1-19-BE-013`)                                                                                                                                                                                       |

### 5. `wo.job-assignment-end`

| row                 | value                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Operation ID**    | `wo.job-assignment-end` — `apps/api/src/app/api/v1/assignments/[assignmentId]/end/route.ts:31`                                                                                                         |
| **Route**           | `/api/v1/assignments/{assignmentId}/end`                                                                                                                                                               |
| **Method**          | `POST`                                                                                                                                                                                                 |
| **Permission**      | `tech.assignment.manage`                                                                                                                                                                               |
| **Request schema**  | Path: `assignmentId` (uuid). Body, `.strict()`: **`reason`** (string, trimmed, min 1, max **500** = `MAX_REASON`, `work-order.ts:140`) — **mandatory**. No end time is accepted.                       |
| **Response schema** | `200` · `AssignmentView`, returned from the `UPDATE ... RETURNING`, so `validTo` is the database's `now()` and `recordVersion` is the value the touch trigger has just bumped to.                      |
| **Scope**           | `branch`, from the locked assignment row's own `companyId`/`branchId`.                                                                                                                                 |
| **Pagination**      | Not applicable.                                                                                                                                                                                        |
| **Idempotency**     | Not declared. `versionGuarded` instead.                                                                                                                                                                |
| **Concurrency**     | **`versionGuarded: true` — `If-Match` is MANDATORY.** Absent → `ERR-CON-002` (**428**). Mismatch → `ERR-CON-001` (**409**).                                                                            |
| **Audit**           | `auditClass: 'privileged'`, action **`wo.job.assignment_ended`** (`audit-actions.ts:822`). Details: `job_id`, `technician_profile_id`, `reason`, all `internal`.                                       |
| **Error codes**     | `401` · `403` · `404` `ERR-RES-001` · `409` `ERR-CON-001` · `409` `ERR-TRN-001` (already ended) · `422` `ERR-VAL-001` (blank reason) · `428` `ERR-CON-002` · `429` · `500`                             |
| **Event**           | **None.** Ending an assignment publishes nothing — only the audit record exists.                                                                                                                       |
| **Existing tests**  | `tests/backend/p1-19-job-assignments.test.ts:574-678`. Required tiers per `scripts/check-operation-test-coverage.mjs:675`: `success`, `denial`, `cross-tenant`, `isolation`, `audit`, `stale-version`. |
| **Owning phase**    | P1-19 (`P1-19-BE-014`)                                                                                                                                                                                 |

The row is never deleted; `valid_to` is server-stamped with `now()`, so it cannot
be pushed before `valid_from` or used to rewrite when the technician came off the
work. Every other column is frozen by `tg_job_assignments_immutable`.

### 6. `wo.job-reassignment`

| row                 | value                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operation ID**    | `wo.job-reassignment` — `apps/api/src/app/api/v1/jobs/[jobId]/reassignments/route.ts:55`                                                                                                                                                                                                                                                                                                           |
| **Route**           | `/api/v1/jobs/{jobId}/reassignments`                                                                                                                                                                                                                                                                                                                                                               |
| **Method**          | `POST`                                                                                                                                                                                                                                                                                                                                                                                             |
| **Permission**      | `tech.assignment.manage`                                                                                                                                                                                                                                                                                                                                                                           |
| **Request schema**  | Body, `.strict()`: `technicianProfileId` (uuid, **required**) · **`reason`** (string, trimmed, 1–500, **required** — it applies to the END of the outgoing assignment) · `requiredSkills` (optional, same shape as above) · `requiredCertificationCodes` (optional) · `window` (**required**, `{ from, to }`, both ISO with offset). No `assignmentRole` — the new assignment is always `primary`. |
| **Response schema** | `201` · `{ ended: AssignmentView \| null, opened: AssignmentView }`. `ended` is `null` when the job had no incumbent. The ETag is minted from `opened.recordVersion`.                                                                                                                                                                                                                              |
| **Scope**           | `branch`, from the job.                                                                                                                                                                                                                                                                                                                                                                            |
| **Pagination**      | Not applicable.                                                                                                                                                                                                                                                                                                                                                                                    |
| **Idempotency**     | **`idempotent: true` — `Idempotency-Key` MANDATORY** (`ERR-INT-002`, 400, when absent).                                                                                                                                                                                                                                                                                                            |
| **Concurrency**     | No `If-Match`. The incumbent's `recordVersion` is read under `FOR UPDATE` inside the transaction, not supplied by the caller.                                                                                                                                                                                                                                                                      |
| **Audit**           | `auditClass: 'privileged'`, declared action `wo.job.assigned`. **Two records are written in one transaction**: `wo.job.assignment_ended` for the outgoing assignment and `wo.job.assigned` for the new one.                                                                                                                                                                                        |
| **Error codes**     | `400` `ERR-INT-002` · `401` · `403` · `404` `ERR-RES-001` · `409` `ERR-CON-001` · `409` `ERR-TRN-001` · `409` `ERR-INT-001` · `422` `ERR-TECH-001` (ineligible incoming technician — the outgoing assignment is left untouched, the whole transaction rolls back) · `422` `ERR-VAL-001` (`already_assigned` when the named technician already holds the job) · `429` · `500`                       |
| **Event**           | **One** `job.assigned` event for the new assignment. The ending publishes nothing.                                                                                                                                                                                                                                                                                                                 |
| **Existing tests**  | `tests/backend/p1-19-job-assignments.test.ts:680-805` — four cases including the rollback proof.                                                                                                                                                                                                                                                                                                   |
| **Owning phase**    | P1-19 (`P1-19-BE-015`)                                                                                                                                                                                                                                                                                                                                                                             |

It is a distinct operation rather than "end then assign" from the client because
`wo.guard_job_transition` refuses an `assignment_required` state with no active
assignment: two client calls would leave the job untransitionable for the gap
between them, or forever if the second never arrived.

### 7. `tech.labor-session-start`

| row                 | value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Operation ID**    | `tech.labor-session-start` — `apps/api/src/app/api/v1/jobs/[jobId]/labor-sessions/route.ts:39`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Route**           | `/api/v1/jobs/{jobId}/labor-sessions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Method**          | `POST`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Permission**      | `tech.labor.record` — catalogue line 197, risk `low`, described as "Start, **pause, resume** and stop labor sessions". **The catalogue text is wider than the routes: no pause and no resume operation exists.**                                                                                                                                                                                                                                                                                                   |
| **Request schema**  | Path: `jobId` (uuid). Body, `.strict()`: **`technicianProfileId` (uuid) and nothing else.** There is no `startedAt`, no `note`, no `action`, no `description`. `started_at` is the column default, `now()`.                                                                                                                                                                                                                                                                                                        |
| **Response schema** | `201` · `LaborSessionView` = `{ id, technicianProfileId, jobId, startedAt, endedAt: string \| null, source, correctionOfId: string \| null, recordVersion: number }`. `source` is always `'manual'` here — the caller cannot set it; `ck_labor_sessions_source` allows `'manual'`, `'timer'`, `'correction'`, and `'correction'` is written only by `tech.correct_labor_session`.                                                                                                                                  |
| **Scope**           | `branch`, from the **technician profile's** `companyId`/`branchId`. The session's scope is taken from the profile, so a job in another branch is refused by `fk_labor_sessions_job` rather than by this module reading `wo.jobs`.                                                                                                                                                                                                                                                                                  |
| **Pagination**      | Not applicable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Idempotency**     | **`idempotent: true` — `Idempotency-Key` MANDATORY.**                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Concurrency**     | No `If-Match`. `recordVersion` is returned and becomes the ETag.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Audit**           | `auditClass: 'privileged'`, action **`tech.labor.session_started`** (`audit-actions.ts:801`). Details: `job_id`, `technician_profile_id`, `started_at`, all `internal`.                                                                                                                                                                                                                                                                                                                                            |
| **Error codes**     | `400` `ERR-INT-002` · `401` · `403` · `404` `ERR-RES-001` (technician not visible; job not visible in the technician's scope) · `409` `ERR-INT-001` · `409` `ERR-TRN-001` (the job's state does not allow labour, the parent work order is terminal, or the start is outside the backdating window — all three arrive as `check_violation` from `tech.guard_labor_session`) · `422` `ERR-TECH-001` (`profile-inactive`; `session-already-open` from `ex_labor_sessions_overlap`, SQLSTATE `23P01`) · `429` · `500` |
| **Event**           | **`labor.session-changed`** (`EVT-TEC-003`, `envelope.ts:347`). Aggregate type `tech.labor_session`, aggregate id the session id, producer `tech.labor-session-service`, event key `labor.session-changed:{id}:started`. Payload `{ laborSessionId, jobId, technicianProfileId, change: 'started' }`.                                                                                                                                                                                                              |
| **Existing tests**  | `tests/backend/p1-19-labor-sessions.test.ts:312-489` — six cases including the concurrent-start race leaving exactly one open session.                                                                                                                                                                                                                                                                                                                                                                             |
| **Owning phase**    | P1-19 (`P1-19-BE-017`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**At most one open session per technician, across all jobs.**
`ex_labor_sessions_overlap` is a partial GiST `EXCLUDE` over
`tstzrange(started_at, COALESCE(ended_at, 'infinity'))`; two infinite ranges
always overlap, so "no overlapping sessions" and "at most one open session" are
the same constraint. A task board that offers a second timer will be refused by
the database.

### 8. `tech.labor-session-list`

| row                 | value                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operation ID**    | `tech.labor-session-list` — `apps/api/src/app/api/v1/jobs/[jobId]/labor-sessions/route.ts:80`                                                                                                                                                         |
| **Route**           | `/api/v1/jobs/{jobId}/labor-sessions`                                                                                                                                                                                                                 |
| **Method**          | `GET`                                                                                                                                                                                                                                                 |
| **Permission**      | **`tech.technician.read`** — a session says who worked and for how long, which is employee-derived data.                                                                                                                                              |
| **Request schema**  | Path: `jobId` (uuid). Query, `.strict()`: `cursor` (optional, opaque string 1–512) · `limit` (optional). No other key.                                                                                                                                |
| **Response schema** | `Page<LaborSessionView>` = `{ items, nextCursor, hasMore }`. Corrections are included, identified by `source: 'correction'` and a non-null `correctionOfId`. The superseded original is soft-deleted and therefore **absent** from the page.          |
| **Scope**           | `branch`, resolved from the **job's** own company and branch through `workOrderModule().workOrders.jobScope()` before any session row is read. Before the `P1-18-A-01` remediation this read resolved no scope at all and RLS was the only narrowing. |
| **Pagination**      | **Keyset.** Ordering key `tech.labor_sessions:started_at_desc`, direction `desc`; sort column **`started_at`**, tie-break **`id`** (`labor-session-repository.ts:40` and `:150`). No `total`.                                                         |
| **Idempotency**     | Not applicable.                                                                                                                                                                                                                                       |
| **Concurrency**     | None.                                                                                                                                                                                                                                                 |
| **Audit**           | `auditClass: 'none'`.                                                                                                                                                                                                                                 |
| **Error codes**     | `400` `ERR-PAG-001` (bad cursor) · `401` · `403` · `404` `ERR-RES-001` (job not visible, including another tenant's job — asserted at `tests/backend/p1-19-labor-sessions.test.ts:849`) · `422` (malformed `jobId`) · `429` · `500`                   |
| **Event**           | None.                                                                                                                                                                                                                                                 |
| **Existing tests**  | `tests/backend/p1-19-labor-sessions.test.ts:776-850` — two cases, one of which walks two pages at `limit=1`.                                                                                                                                          |
| **Owning phase**    | P1-19 (`P1-19-BE-018`)                                                                                                                                                                                                                                |

**Defect carried into any screen built on this.** The cursor is minted from
`row.startedAt.toISOString()` (`labor-session-repository.ts:171`), a JavaScript
`Date`, which holds milliseconds where PostgreSQL stores microseconds. This is
`P1-27-INT-006`, and this exact file and line are listed as an **unfixed** site
in `docs/phase-1/phase-1-27/findings/p1-27-int-006-cursor-precision.md:124`. Any
two sessions sharing a millisecond at different microseconds will cause the
second page to **silently skip rows** — not duplicate them, skip them, with
`hasMore` and `nextCursor` reporting nothing. The fix mechanism
(`cursorTimestamp()` / `buildPageWithCursors()`) is already merged and proven;
this call site has not adopted it.

**Note on stale prose.** `scripts/check-operation-test-coverage.mjs:711` still
describes a cross-tenant caller receiving "an EMPTY log rather than a 404". The
test at `tests/backend/p1-19-labor-sessions.test.ts:842-849` explicitly records
that this was the defect, not the decision, and asserts **404**. The script's
`note` is documentation only and asserts nothing; the 404 is the contract.

### 9. `tech.labor-session-stop`

| row                 | value                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operation ID**    | `tech.labor-session-stop` — `apps/api/src/app/api/v1/labor-sessions/[sessionId]/stop/route.ts:28`                                                                                                                           |
| **Route**           | `/api/v1/labor-sessions/{sessionId}/stop`                                                                                                                                                                                   |
| **Method**          | `POST`                                                                                                                                                                                                                      |
| **Permission**      | `tech.labor.record`                                                                                                                                                                                                         |
| **Request schema**  | Path: `sessionId` (uuid). **No body at all** — no schema is parsed. `ended_at` is stamped `now()` by the `UPDATE`.                                                                                                          |
| **Response schema** | `200` · `LaborSessionView`, read back after the update because `ended_at` is the database's value.                                                                                                                          |
| **Scope**           | `branch`, from the locked session row.                                                                                                                                                                                      |
| **Pagination**      | Not applicable.                                                                                                                                                                                                             |
| **Idempotency**     | Not declared.                                                                                                                                                                                                               |
| **Concurrency**     | **`versionGuarded: true` — `If-Match` MANDATORY.** Absent → `ERR-CON-002` (**428**). Mismatch → `ERR-CON-001` (**409**).                                                                                                    |
| **Audit**           | `auditClass: 'privileged'`, action **`tech.labor.session_stopped`** (`audit-actions.ts:808`).                                                                                                                               |
| **Error codes**     | `401` · `403` · `404` `ERR-RES-001` · `409` `ERR-CON-001` · `409` `ERR-TRN-001` (already stopped — refused here rather than reaching `tech.guard_labor_session` as a rewrite) · `422` · `428` `ERR-CON-002` · `429` · `500` |
| **Event**           | `labor.session-changed`, event key `labor.session-changed:{id}:stopped`, payload `change: 'stopped'`.                                                                                                                       |
| **Existing tests**  | `tests/backend/p1-19-labor-sessions.test.ts:491-643` — three cases, one of which drives the whole pause/resume cycle.                                                                                                       |
| **Owning phase**    | P1-19 (`P1-19-BE-018`)                                                                                                                                                                                                      |

`ended_at` is **write-once**: `tech.guard_labor_session` refuses any later change
to a non-null `ended_at`. Amending recorded hours is a correction, never an edit.

### 10. `tech.labor-session-correct`

| row                 | value                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operation ID**    | `tech.labor-session-correct` — `apps/api/src/app/api/v1/labor-sessions/[sessionId]/corrections/route.ts:38`                                                                                                                                                                                                                                                          |
| **Route**           | `/api/v1/labor-sessions/{sessionId}/corrections`                                                                                                                                                                                                                                                                                                                     |
| **Method**          | `POST`                                                                                                                                                                                                                                                                                                                                                               |
| **Permission**      | **`tech.labor.correct`** — catalogue line 201, risk **`high`**, separate from `tech.labor.record` because a correction rewrites what a technician was paid for.                                                                                                                                                                                                      |
| **Request schema**  | Path: `sessionId` (uuid). Body, `.strict()`: `startedAt` (ISO 8601 **with offset**, required) · `endedAt` (ISO 8601 **with offset**, required) · `reason` (string, trimmed, 1–**500** = `MAX_UNAVAILABILITY_REASON`, required). **This is the only path in the phase that accepts caller-supplied timestamps.**                                                      |
| **Response schema** | `201` · `LaborSessionView` for the **new** row, with `source: 'correction'` and `correctionOfId` set to the original id.                                                                                                                                                                                                                                             |
| **Scope**           | `branch`, from the locked original session row.                                                                                                                                                                                                                                                                                                                      |
| **Pagination**      | Not applicable.                                                                                                                                                                                                                                                                                                                                                      |
| **Idempotency**     | Not declared.                                                                                                                                                                                                                                                                                                                                                        |
| **Concurrency**     | **`versionGuarded: true` — `If-Match` MANDATORY** and checked twice (route, then service against the locked row).                                                                                                                                                                                                                                                    |
| **Audit**           | `auditClass: 'privileged'`, action **`tech.labor.session_corrected`** (`audit-actions.ts:794`). Details: `correction_of_id`, `started_at` (with `previousValue`), `ended_at` (with `previousValue`), `reason` — all `internal`.                                                                                                                                      |
| **Error codes**     | `401` · `403` · `404` `ERR-RES-001` · `409` `ERR-CON-001` · `409` `ERR-TRN-001` (refused by the labour guard) · `422` `ERR-VAL-001` (`after_start` when `endedAt <= startedAt`; blank reason; timezone-less bound) · `422` `ERR-TECH-001` (`window-overlaps`) · `428` `ERR-CON-002` · `429` · `500` · `500` `ERR-SYS-001` if the correction row is not readable back |
| **Event**           | `labor.session-changed`, event key `labor.session-changed:{newId}:corrected`.                                                                                                                                                                                                                                                                                        |
| **Existing tests**  | `tests/backend/p1-19-labor-sessions.test.ts:645-774` — three cases including "preserves the original and links the replacement, rather than editing".                                                                                                                                                                                                                |
| **Owning phase**    | P1-19 (`P1-19-BE-019`)                                                                                                                                                                                                                                                                                                                                               |

The original is never edited. `tech.correct_labor_session(uuid, timestamptz,
timestamptz, text)` soft-deletes it — which is what frees the partial `EXCLUDE`
range — and inserts a linked replacement, in one statement.

---

### The nine `tech` tables: which are written by a service

The prior survey said nine tables exist and one is written. **Verified: correct.**
Each row below names the repository method, or records that none exists. Method
of verification: `CREATE TABLE tech.` across `supabase/migrations` returned nine
tables; a regex for all nine table names plus the two functions across
`apps/**` returned every SQL reference in the codebase.

| #   | table                                   | created at                                          | written by a service?                  | read by a service?                                                                                                                                                                                                                   |
| --- | --------------------------------------- | --------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `tech.skills`                           | `20260722092000_tech_catalogs.sql:29`               | **No.** No `INSERT`/`UPDATE` anywhere. | `TechnicianCatalogRepository.skills()` (`:76`) and as a `JOIN` in `.heldSkills()` (`:251`). **`skills()` is reachable from no route** — see below.                                                                                   |
| 2   | `tech.skill_levels`                     | `20260722092000_tech_catalogs.sql:79`               | **No.**                                | `.skillLevels()` (`:105`), and a `JOIN` in `.heldSkills()` (`:252`). `skillLevels()` is reachable from no route.                                                                                                                     |
| 3   | `tech.certifications`                   | `20260722092000_tech_catalogs.sql:129`              | **No.**                                | `.certifications()` (`:129`), and a `JOIN` in `.heldCertifications()` (`:290`). `certifications()` is reachable from no route.                                                                                                       |
| 4   | `tech.technician_profiles`              | `20260722094000_tech_profiles_skills_certs.sql:37`  | **No.**                                | `.profile()` (`:166`) and `.activeProfilesInBranch()` (`:205`). Reached by `tech.technician-queue`, `tech.technician-available`, the assignment writes, `tech.labor-session-start`, and `qms` rework/sign-off.                       |
| 5   | `tech.technician_skills`                | `20260722094000_tech_profiles_skills_certs.sql:98`  | **No.**                                | `.heldSkills()` (`:240`) — eligibility only.                                                                                                                                                                                         |
| 6   | `tech.technician_certifications`        | `20260722094000_tech_profiles_skills_certs.sql:157` | **No.**                                | `.heldCertifications()` (`:272`) — eligibility only.                                                                                                                                                                                 |
| 7   | `tech.technician_certification_details` | `20260722094000_tech_profiles_skills_certs.sql:220` | **No.**                                | **Not read either.** The name appears in `apps/**` exactly once, in a comment at `technicians/[technicianProfileId]/queue/route.ts:15`. `ck_technician_certification_details_classification` forces `classification = 'restricted'`. |
| 8   | `tech.technician_availability`          | `20260722094000_tech_profiles_skills_certs.sql:279` | **No.**                                | `.availability()` (`:305`) — eligibility only.                                                                                                                                                                                       |
| 9   | **`tech.labor_sessions`**               | `20260722099000_tech_labor_sessions.sql:32`         | **YES — the only one.**                | `LaborSessionRepository.pageForJob()` (`:150`) and `.lock()` (`:115`).                                                                                                                                                               |

The four writing methods, all on `LaborSessionRepository`
(`apps/api/src/modules/technician/data/labor-session-repository.ts`):

| method                 | statement                                                                                                                                                      | line           | reached by                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------- |
| `open(db, input)`      | `INSERT INTO tech.labor_sessions (...) VALUES (..., 'manual', ...) RETURNING ...`                                                                              | `:96`          | `tech.labor-session-start`   |
| `close(db, id, ver)`   | `UPDATE tech.labor_sessions SET ended_at = now(), updated_by = $3 WHERE ... record_version = $4 AND ended_at IS NULL`                                          | `:140`         | `tech.labor-session-stop`    |
| `correct(db, input)`   | `SELECT tech.correct_labor_session($1::uuid, $2::timestamptz, $3::timestamptz, $4::text)` — the function soft-deletes the original and inserts the replacement | `:197`         | `tech.labor-session-correct` |
| (`lock`, `pageForJob`) | reads                                                                                                                                                          | `:115`, `:150` | —                            |

**Two consequences the assignment screen must plan around.**

1. `TechnicianEligibilityService.skills()`, `.skillLevels()` and
   `.certifications()` exist as service methods and are exported from the module,
   but **no route calls them.** The only three module entry points reached from a
   route or another module are `.candidates()`, `.profile()` and
   `.assertOrThrow()`. There is therefore no catalogue read of any kind.
2. The three catalogue tables are **not seeded.** `supabase/seeds/` contains six
   files (`01_reference_data`, `04_iam_permission_catalog`,
   `05_shared_reference`, `06_wo_job_state_graph`, `07_inv_units_of_measure`,
   `08_sal_payment_methods`); a search for `tech.skills`, `tech.skill_levels`
   and `tech.certifications` across all six returned nothing. So on a fresh
   installation there are no skills, no levels, no certifications, and no
   technician profiles — and no operation to create any of them.

---

## Fields the journey needs that the contract does not carry

Read against the Owner's seventeen attributes of an assigned task
(`docs/product/workshop/department-task-assignment.md:364-388`). Each verdict
below was re-derived from the migration and the route schema, not copied.

| field the journey needs                      | nearest existing thing                                                                                                                                                           | verdict                                                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Department on the work**                   | `org.departments` (`20260717104000_org_operational_structure.sql:109`) and `iam.grant_scopes.department_id`                                                                      | **ABSENT.** No `wo`, `tech`, `rec`, `svc` or `inv` table has a `department_id` column. Not a missing read — a missing fact.                                                 |
| **Priority**                                 | `dia.recommendations.priority` (`low`/`medium`/`high`, `ck_recommendations_priority`); `svc.price_rules.priority` and `svc.price_list_assignments.priority` (tie-break integers) | **ABSENT** in this sense. Neither `wo.work_orders`, `wo.jobs` nor `wo.job_assignments` has a priority column, and the assignment body is `.strict()` so sending one is 422. |
| **Instructions to the technician**           | `wo.job_assignments.reason`                                                                                                                                                      | **ABSENT, deliberately.** `reason` is the _end_-of-assignment reason and the creation schema removed the field rather than accept and discard it.                           |
| **Who assigned it**                          | `wo.job_assignments.created_by` (stored) and the `wo.job.assigned` audit record                                                                                                  | **Stored but not published.** `AssignmentView` has no `createdBy`. Showing it needs either a projection change or an audit read under `iam.audit.view`.                     |
| **Technician name**                          | `wo.job_assignments.technician_profile_id`; `tech.technician_profiles.user_id`                                                                                                   | **ABSENT.** Every projection in this domain carries an id only, and no operation turns a technician profile id into a person.                                               |
| **Due date / expected finish**               | the assignment `window.to` supplied at assignment time                                                                                                                           | **ABSENT.** `window` is used for the availability check and is **not stored**; `wo.job_assignments` has `valid_from`/`valid_to` only, and `valid_to` means "ended".         |
| **Expected duration**                        | `svc.standard_labor_times.standard_minutes`, `numeric(10,2)` → **decimal string**                                                                                                | **Unreachable.** No route publishes it.                                                                                                                                     |
| **Notes on a job or assignment**             | `shared.notes` is generic (`entity_type`, `entity_id`)                                                                                                                           | **ABSENT for jobs.** The only note route in `apps/api/src/app/api/v1/**` is `customers/[customerId]/notes/route.ts`.                                                        |
| **Evidence attached to a task**              | `dia.diagnostic_evidence`, bound to an **inspection**                                                                                                                            | **ABSENT for assignments.** Nothing binds a document to a job or an assignment.                                                                                             |
| **The required skills, after the act**       | `requiredSkills` / `requiredCertificationCodes` on the assignment body                                                                                                           | **Not stored.** Evaluated at assignment time and discarded; the assignment history cannot say what was required.                                                            |
| **A pause on the labour clock**              | `tech.labor_sessions` has `started_at` and `ended_at` and nothing else temporal                                                                                                  | **ABSENT.** A pause is a stop plus a job transition into `paused`, whose reason lands in `wo.job_status_history`. A timer must not offer a pause control.                   |
| **A single labour session read**             | `tech.labor-session-list` by job                                                                                                                                                 | **ABSENT.** There is no `GET /labor-sessions/{sessionId}`; a session is visible only through its job's list.                                                                |
| **A reliable second page of the labour log** | the keyset cursor at `labor-session-repository.ts:171`                                                                                                                           | **DEFECTIVE.** Millisecond cursor over a microsecond column — `P1-27-INT-006`, listed unfixed. Rows are skipped silently.                                                   |

---

## Operations the journey needs that do not exist

| needed operation                                 | why the journey needs it                                                                               | owning Backend phase                                                              | what exists instead                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create / read / update a **department**          | Step 13: route work to mechanical, electrical, body, valeting                                          | Not established. `org` is P1-03 in the database; no Backend phase owns the routes | Nothing. `org.departments` exists as a table; **no route file under `apps/api/src/app/api/v1/**` names it**, and `org.department.manage` (catalogue line 21) is required by no operation.                                                                                                                                                                                                                                                                      |
| **Assign work to a department**                  | Step 13. The Owner's requirement that a task carry a department                                        | Not established                                                                   | Nothing. No operational record can hold a department, so this is a schema change first and a route second.                                                                                                                                                                                                                                                                                                                                                     |
| A **department work queue**                      | Step 13's stated output                                                                                | Not established                                                                   | Nothing. `tech.technician-queue` is per technician, not per department.                                                                                                                                                                                                                                                                                                                                                                                        |
| **Create a technician profile**                  | The assignment picker must be populated from somewhere                                                 | P1-19 owns `tech`; not delivered                                                  | Nothing. `tech.technician_profiles` is read by four service methods and written by none.                                                                                                                                                                                                                                                                                                                                                                       |
| **List or read technician profiles**             | Choose a technician; show who is on a job                                                              | P1-19; not delivered                                                              | `tech.technician-available` returns profile **ids** with verdicts for one branch and one requirement, capped at 50. It is a ranking, not a roster.                                                                                                                                                                                                                                                                                                             |
| **Create a skill, skill level or certification** | An eligibility requirement can only name codes that exist                                              | P1-19; not delivered                                                              | Nothing. The three catalogue tables are neither written nor seeded, and their read methods are reachable from no route.                                                                                                                                                                                                                                                                                                                                        |
| **Grant a technician a skill or certification**  | Eligibility is decided entirely from these rows                                                        | P1-19; not delivered                                                              | Nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Record technician availability**               | `availability-missing` is one of the nine refusal reasons and will fire for everybody until rows exist | P1-19; not delivered                                                              | Nothing. `tech.technician_availability` is read by `.availability()` and written by no method.                                                                                                                                                                                                                                                                                                                                                                 |
| **Notify the assigned employee**                 | Step 15: "This vehicle has been assigned to you"                                                       | P1-15 owns `shared` notifications; the fan-out is unowned                         | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Record a work-log entry with an action**       | Step 16 / the Owner's seventeen actions                                                                | Not established                                                                   | See the action-by-action comparison below. There is no work-log table and no action enum.                                                                                                                                                                                                                                                                                                                                                                      |
| **Record a tool or device used**                 | One of the seventeen actions                                                                           | Not established                                                                   | Nothing. No table, no permission, no operation.                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Escalate**                                     | One of the seventeen actions                                                                           | Not established                                                                   | Nothing. A search of `supabase/migrations` for `escalat` returns only privilege-escalation commentary in IAM migrations.                                                                                                                                                                                                                                                                                                                                       |
| **Pause / resume a labour session**              | The seeded description of `tech.labor.record` promises it                                              | P1-19; deliberately not delivered                                                 | A stop plus `wo.job-transition` into `paused`, and the reverse. Two requests, two permissions, two facts.                                                                                                                                                                                                                                                                                                                                                      |
| **`GET /jobs/{jobId}`**                          | A task card needs one job                                                                              | P1-19; not delivered                                                              | `wo.work-order-detail` returns the parent order's live jobs. A screen wanting one job must fetch the whole work order. **Do not be misled by the file:** `apps/api/src/app/api/v1/jobs/[jobId]/route.ts` **exists** and exports **only `PATCH`** — `wo.job-update` (`:51`), permission `wo.job.manage`, `versionGuarded`, body `.strict()` `{ title (required), jobType (nullable optional), requiresDiagnostic (optional) }`. There is no `GET` export in it. |
| **`GET /labor-sessions/{sessionId}`**            | Re-read a session after correcting it                                                                  | P1-19; not delivered                                                              | `tech.labor-session-list` by job.                                                                                                                                                                                                                                                                                                                                                                                                                              |

### What operation notifies an assigned employee — ABSENT

**Nothing in this domain enqueues anything.** Evidence, in order:

1. `wo.job-assignment-create` and `wo.job-reassignment` call
   `publishSession`/`publishAssigned` → `publishEvent(db, { eventType: 'job.assigned', ... })`
   (`job-assignment-service.ts:452`). That writes a row to the outbox and
   nothing else. There is no notification call anywhere in
   `apps/api/src/modules/work-order/application/job-assignment-service.ts` or
   `apps/api/src/modules/technician/application/labor-session-service.ts`.
2. The outbox worker dispatches through `consumersFor(event.eventType)` at
   `apps/api/src/server/worker/outbox-worker.ts:208` (imported at `:32`);
   the registry function is `apps/api/src/server/worker/consumer-registry.ts:78`.
3. `registerConsumer(` has **seven call sites in the whole repository and all
   seven are in `tests/backend/outbox-worker.test.ts`** (lines 236, 275, 307,
   327, 408, 457, 493). The raw grep returns ten hits: those seven, the
   declaration at `consumer-registry.ts:60`, and two prose mentions in
   `docs/standards/`. **No production file registers a consumer**, so
   `job.assigned` is claimed, matched against an empty consumer list, and
   completed. Nothing is sent.

The nearest existing thing is `shared.notification-enqueue`, `POST /notifications`
(`apps/api/src/app/api/v1/notifications/route.ts:48`, permission
`shared.notification.send`, scope `tenant`, `Idempotency-Key` mandatory,
OpenAPI `docs/api/openapi.v1.json:7500`). Its full contract belongs to the
shared-services archaeology, but three of its constraints bind any assignment
screen and were read directly:

- the body is `.strict()` and **requires** `channel`, `templateVersionId`,
  `locale` (2–10 chars), `dedupeKey` (8–200 chars), `recipientRef` (a **uuid**,
  never an address or telephone number) and `consentEvaluation` (itself
  `.strict()`: `{ granted, consentRecordId, evaluatedAt }`). Three further keys
  are **accepted and optional**: `variables`
  (`z.record(z.string(), z.string()).default({})` — omitting it is legal, it is
  not required), `companyId` and `branchId` (both nullable uuid). Anything else
  is a 422;
- the type accepts `email`, `sms`, `whatsapp`, `in_app`, but
  `SUPPORTED_CHANNELS = ['email', 'in_app']`
  (`apps/api/src/modules/shared-services/domain/notification-policy.ts:39`) and
  `assertSupportedChannel` refuses the other two. **A screen must not offer a
  text message or WhatsApp to a technician**;
- it requires an **approved template version**, and no template ships — a
  message could not be composed today even if something called it.

So notifying an assigned technician today would mean a client making a second,
separate, hand-composed request with a template that does not exist. There is no
fan-out from a job to its assigned technicians in any layer.

### The seventeen technician actions, compared one by one

Read from `docs/product/workshop/vehicle-history-model.md:746-771`, which is the
list of seventeen requested technician actions. Every operation named in the
"expressed as" column below was verified by locating its `defineOperation` block
and reading its declared `permissions`; the fourteen distinct route files are
listed in _What I searched_ below.

**There is no work-log entry and no action enum.** The nearest column in the
whole domain is `tech.labor_sessions.source`, whose `ck_labor_sessions_source`
accepts exactly three values — `manual`, `timer`, `correction` — and **the
caller cannot set any of them**: `open()` hard-codes `'manual'`, `'correction'`
is written only by `tech.correct_labor_session`, and `'timer'` is written by
nothing at all.

| #   | requested action                 | operation that expresses it                                                                                                                                                                           | permission                                        | verdict                                                                            |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | start work                       | `tech.labor-session-start` (`POST /jobs/{jobId}/labor-sessions`)                                                                                                                                      | `tech.labor.record`                               | **Exists, this domain.**                                                           |
| 2   | pause work                       | `tech.labor-session-stop`, then `wo.job-transition` into `paused`                                                                                                                                     | `tech.labor.record`, then `wo.job.transition`     | **Two requests, two facts.** No pause operation.                                   |
| 3   | resume work                      | `wo.job-transition` back to `in_progress`, then `tech.labor-session-start`                                                                                                                            | `wo.job.transition`, then `tech.labor.record`     | **Two requests.** No resume operation.                                             |
| 4   | complete work                    | `wo.job-transition` (`jobs/[jobId]/transition/route.ts:43`)                                                                                                                                           | `wo.job.transition`                               | Exists, work-order domain.                                                         |
| 5   | add an observation               | `dia.diagnostic-finding-record` (`inspections/[inspectionId]/findings/route.ts:55`)                                                                                                                   | `dia.diagnostic.record`                           | Exists, diagnostics domain — needs an **open inspection**, not a job.              |
| 6   | add a diagnosis                  | `dia.diagnostic-finding-record`, `dia.diagnostic-measurement-record` (`.../measurements:64`), `dia.diagnostic-dtc-record` (`.../dtcs:45`)                                                             | `dia.diagnostic.record`                           | Exists, diagnostics domain.                                                        |
| 7   | add a photograph or evidence     | `dia.diagnostic-evidence-record` (`.../evidence:43`); or `shared.attachment-upload-authorize` (`attachments/upload-authorizations/route.ts:36`) then `shared.attachment-link-create` (`.../links:27`) | `dia.diagnostic.record`; `shared.document.manage` | Exists in two other domains; **nothing attaches evidence to a job or assignment**. |
| 8   | record a tool or device used     | —                                                                                                                                                                                                     | —                                                 | **ABSENT.** No table, no operation, no permission.                                 |
| 9   | request a part                   | `wo.required-part-record` (`work-orders/[workOrderId]/required-parts/route.ts:52`)                                                                                                                    | `wo.work_order.line.manage`                       | Exists, work-order domain — on the **work order**, not the job.                    |
| 10  | issue a part                     | `inv.stock-issue-create` (`stock-issues/route.ts:59`)                                                                                                                                                 | `inv.stock.operate`                               | Exists, inventory domain — a different actor (storekeeper).                        |
| 11  | return an unused part            | `inv.stock-return-create` (`stock-returns/route.ts:48`)                                                                                                                                               | `inv.stock.operate`                               | Exists, inventory domain.                                                          |
| 12  | add an external part request     | `inv.external-purchase-part-create` (`external-purchase-parts/route.ts:83`)                                                                                                                           | `inv.external_purchase.record`                    | Exists, inventory domain, audit class `financial`.                                 |
| 13  | add a labour item                | `wo.service-line-record` (`work-orders/[workOrderId]/service-lines/route.ts:49`)                                                                                                                      | `wo.work_order.line.manage`                       | Exists, work-order domain — on the work order.                                     |
| 14  | raise an additional-work request | `wo.additional-work-request` (`work-orders/[workOrderId]/additional-work/route.ts:57`)                                                                                                                | `wo.additional_work.request`                      | Exists, work-order domain.                                                         |
| 15  | record a blocker                 | `wo.work-order-transition` into `awaiting_parts` or `awaiting_customer` (`.../transition:62`)                                                                                                         | `wo.work_order.transition`                        | **A state with a mandatory reason, not a blocker record.** No blocker entity.      |
| 16  | escalate                         | —                                                                                                                                                                                                     | —                                                 | **ABSENT.** No table, no operation, no permission.                                 |
| 17  | submit for quality assurance     | `wo.work-order-transition` into `qc_pending`                                                                                                                                                          | `wo.work_order.transition`                        | Exists, work-order domain — on the work order.                                     |

**Tally: 2 of the 17 are operations in this domain (1, and 2/3 in part). 13 are
operations owned by three other domains — `work-order`, `diagnostics` and
`inventory`, plus `shared-services` if #7 takes the attachment route rather than
the diagnostic-evidence one — and require the screen to compose two requests, two
permissions and two failure paths per user gesture. 2 exist nowhere.**

Of the fifteen that exist, the resource each one is addressed by splits as
follows, read from the route paths and bodies rather than from the domain names:

| keyed on                                                                                                              | actions                          | count |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----- |
| an **inspection** (path `/inspections/{inspectionId}/…`)                                                              | #5, #6, #7                       | 3     |
| the **work order** (path `/work-orders/{workOrderId}/…`, or `workOrderId` in the body as in `inv.stock-issue-create`) | #9, #10, #12, #13, #14, #15, #17 | 7     |
| a **part issue** (`partIssueId` in the body — itself work-order-keyed)                                                | #11                              | 1     |
| the **job** (path `/jobs/{jobId}/…`, or a labour session belonging to one)                                            | #1, #2, #3, #4                   | 4     |
| the **assignment** the technician was given                                                                           | —                                | **0** |

So eleven of the fifteen sit on the work order or an inspection, four on the job,
and **none on the assignment**. A "log what I did on my task" screen therefore
cannot be a single form against a single resource: it must hold a job id, its
parent work-order id and an open inspection id at once, and two of the four
job-keyed actions (#2 pause, #3 resume) are themselves two requests with two
permissions each.

---

## Where department appears in the whole schema — verified, and the prior survey confirmed

The prior survey said `department_id` appears in exactly one place,
`iam.grant_scopes`, where it narrows a permission grant. **Verified and
confirmed.** A recursive search for `department_id` across the whole repository
returned the following, and nothing else. Documentation hits are separated from
code hits.

| kind          | file                                                                          | line(s)                                | what it is                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Column**    | `supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql`           | **125**                                | `department_id uuid NULL` — the **only** `department_id` column in the schema, on `iam.grant_scopes`.                                                       |
| Constraint    | same file                                                                     | 131                                    | `uq_grant_scopes_row UNIQUE NULLS NOT DISTINCT (grant_id, scope_type, company_id, branch_id, department_id)`                                                |
| Constraint    | same file                                                                     | 138–140                                | `fk_grant_scopes_department` → `org.departments (tenant_id, company_id, branch_id, id)`                                                                     |
| Constraint    | same file                                                                     | 143–145                                | `ck_grant_scopes_shape` — `department_id` non-null only when `scope_type = 'department'`                                                                    |
| Index         | same file                                                                     | 155                                    | `ix_grant_scopes_org` over `(tenant_id, company_id, branch_id, department_id)`                                                                              |
| Function body | `supabase/migrations/20260718097000_iam_context_and_permission_functions.sql` | 194                                    | `iam.has_permission_in_scope`: `(s.scope_type = 'department' AND s.department_id = p_department)`. `s` is `iam.grant_scopes`.                               |
| Function body | `supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql`  | 185–186                                | `iam.grant_delegation_within_authority`: `s.department_id` / `a.department_id`. **Both aliases are `iam.grant_scopes`** (`s` at line 161, `a` at line 166). |
| Application   | `apps/api/src/modules/iam/data/authorization-repository.ts`                   | 171, 174, 187, 611, 614, 617, 626, 643 | Selects and inserts on `iam.grant_scopes` only.                                                                                                             |
| Test          | `tests/db/p1-14-grant-scope-containment.test.ts`                              | 214                                    | `INSERT INTO iam.grant_scopes (...)`                                                                                                                        |
| Test          | `tests/db/iam-grants.test.ts`                                                 | 210                                    | `INSERT INTO iam.grant_scopes (...)`                                                                                                                        |
| Documentation | `docs/database/data-dictionary.md`                                            | 742                                    | The `iam.grant_scopes` column entry. Verified in context at lines 730–745 — it is under the `iam.grant_scopes` heading.                                     |
| Documentation | `docs/product/workshop/vehicle-history-model.md`                              | 575, 996                               | Prose restating the gap.                                                                                                                                    |
| Documentation | `docs/product/workshop/frontend-implementation-program.md`                    | 365, 369                               | Prose.                                                                                                                                                      |
| Documentation | `docs/product/workshop/end-to-end-workshop-workflow.md`                       | 555                                    | Prose.                                                                                                                                                      |
| Documentation | `docs/product/workshop/department-task-assignment.md`                         | 165, 678                               | Prose.                                                                                                                                                      |
| Documentation | `docs/product/README.md`                                                      | 213                                    | Prose.                                                                                                                                                      |
| Documentation | `docs/phase-1/phase-1-22/evidence/archaeology.json`                           | 1692                                   | A quoted copy of the `has_permission_in_scope` body.                                                                                                        |
| Documentation | `docs/phase-1/phase-1-20/evidence/completeness-audit.md`                      | 278                                    | Prose.                                                                                                                                                      |

**`org.departments` itself** is created at
`supabase/migrations/20260717104000_org_operational_structure.sql:109`. It keys
itself on `id`, carries `department_code` (`ck_departments_code_format`,
`^[a-z][a-z0-9_]{1,62}$`, immutable), `name` (`ck_departments_name_not_blank`)
and `status` (`ck_departments_status` — exactly `active` or `inactive`, there is
no third value). `uq_departments_branch_code_live` makes the code unique only
among live rows, so archiving frees a code for reuse. `GRANT SELECT, INSERT,
UPDATE ON org.departments TO app_runtime` exists at line 422 — the grant is
there; the route is not.

A search of `apps/api/src` for `org.department` and `departments`
(case-insensitive) returned **two hits, both comments** in
`apps/api/src/modules/iam/domain/delegation-policy.ts` (lines 74 and 178),
describing hierarchical scope coverage. A search of `docs/api/openapi.v1.json`
for `department` returned **one hit**, line 4237, the summary string of
`iam.grant-scope-attach`: "Attach a company, branch, or department scope to a
grant."

**Verdict: refuted nothing, confirmed everything.** Departments are an
authorisation boundary and a name. No operation assigns work to one, and none
could without a schema change first.

---

## What I searched and did not find

Exact searches, so the next reader does not repeat them.

**Route surface.**

- `apps/api/src/app/api/v1/technicians/**` → exactly two route files:
  `available/route.ts` and `[technicianProfileId]/queue/route.ts`. There is no
  `technicians/route.ts`, no `technicians/[id]/route.ts`.
- `path: '/(skills|skill-levels|certifications|technicians|departments|technician-profiles|availability|work-logs)` across
  `apps/api/src/app/api/v1` → **two matches only**, both the technician routes
  above. No `/departments`, no `/skills`, no `/certifications`, no
  `/technician-profiles`, no `/availability`, no `/work-logs`.
- `"/api/v1/technicians`, `"/api/v1/labor-sessions`, `"/api/v1/assignments` in
  `docs/api/openapi.v1.json` → five path objects (lines 639, 7072, 7135, 10956,
  11010), matching the five route files exactly.
- `apps/api/src/app/api/v1/jobs/**` → eight route files. `jobs/[jobId]/route.ts`
  **does exist**, and exports **`PATCH` only** (`wo.job-update`); the four `GET`
  exports under `jobs/` are on `assignments`, `inspections`, `history` and
  `labor-sessions`. `export async function GET` across `apps/api/src/app/api/v1/jobs`
  → four hits, none of them in `[jobId]/route.ts`. **`GET /jobs/{jobId}` does not
  exist**; finding the file is not finding the operation.
- `"400":` and `"404":` across `docs/api/openapi.v1.json` → **zero matches each**.
  The document declares only 401/403/409/422/428/429/500 for every operation in
  every domain, so it cannot be used to enumerate this surface's failures.

**Which `tech` tables are written.**

- `CREATE TABLE tech\.` across `supabase/migrations` → nine tables, listed above.
- `tech\.(skills|skill_levels|certifications|technician_profiles|technician_skills|technician_certifications|technician_certification_details|technician_availability|labor_sessions|correct_labor_session|guard_labor_session)`
  across `apps/**` → every SQL reference in the application. Exactly one
  `INSERT INTO tech.`, exactly one `UPDATE tech.`, both on `tech.labor_sessions`.
  `tech.technician_certification_details` appeared only inside a comment.
- `tech\.(skills|skill_levels|certifications)` across `supabase/seeds` → **no
  matches.** The catalogues are not seeded.
- `registerConsumer\(` across the whole repository → seven hits, all in
  `tests/backend/outbox-worker.test.ts`. **No production consumer exists.**

**Departments.**

- `department_id` across the whole repository → the table above, complete.
- `department` (case-insensitive) across `supabase` → 71 occurrences in 8 files;
  `20260717104000_org_operational_structure.sql` (33) creates the table,
  `20260718092000` (21) and `20260718097000` (3) and `20260727090000` (9) are
  IAM scoping, `20260726090000` (2) is IAM administration,
  `20260717103000`/`20260717106000` (1 each) are FK targets, and
  `04_iam_permission_catalog.sql` (1) is the permission code.
- `org\.department|departments` (case-insensitive) across `apps/api/src` → two
  comment lines in `iam/domain/delegation-policy.ts`. **No SQL, no route.**
- `department` in `docs/api/openapi.v1.json` → one hit, a summary string.

**Work logs and actions.**

- `log_action|logAction|work_log|activity_type|entry_type` (case-insensitive)
  across the whole repository → **no files matched.** There is no work-log table,
  no work-log column and no action enum anywhere.
- `escalat|tool_used|device_used` (case-insensitive) across `supabase` → ten
  hits, all privilege-escalation commentary inside IAM migrations. **No
  escalation entity and no tool-usage entity.**
- `instruction` (case-insensitive) across `supabase/migrations` → three hits,
  all prose in migration headers referring to phase instructions. **No
  `instructions` column.**
- `priority` (case-insensitive) across `supabase/migrations` → eleven hits in
  two files: `dia.recommendations.priority` and the two `svc` pricing tie-break
  integers. **No priority on a work order, job or assignment.**
- `CREATE TABLE wo\.jobs` → `20260722097000_wo_jobs.sql:31`. Its full column list
  is `id, tenant_id, company_id, branch_id, work_order_id, title, job_type,
state, requires_diagnostic, record_version` plus lifecycle metadata. No
  department, no priority, no instructions, no due date, no assignee column.

**Sections read for the Owner's requirement.** `§12` and `§13` were taken to be
journey steps 12 and 13 of
`docs/product/workshop/end-to-end-workshop-workflow.md` (lines 518 and 541:
"Work order created" and "One or more departments assigned"), with steps 14, 15
and 16 read alongside them because the assigned domain spans them. The list of
**seventeen technician actions** was located at
`docs/product/workshop/vehicle-history-model.md:746-771`. A separate list of
**seventeen attributes of an assigned task** is at
`docs/product/workshop/department-task-assignment.md:364-388` and was used for
the missing-fields table. If the orchestrator's `§13` meant a different document,
that document is not in this repository: a search for `seventeen`
(case-insensitive) across `docs` returns 39 occurrences in 24 files, ten of them
inside this file, and none of them is a third list of technician actions.

**Not established, and what would establish it.**

- Whether a department model should attach to the work order, the job, the
  service line or the assignment. Nothing in the repository decides this; an
  Owner decision and a Backend phase would.
- The priority vocabulary a workshop should use. `low`/`medium`/`high` from
  `ck_recommendations_priority` is a precedent, not a deduction.
- How many departments a tenant will configure. No number appears anywhere; a
  pilot-tenant configuration or a written policy would establish it.
