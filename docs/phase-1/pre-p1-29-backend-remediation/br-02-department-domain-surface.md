# BR-02 — Department Domain Surface

|                      |                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Closes               | `BE-7` · `DEP-B1` · finding `INS-23` (**BLOCKER**, P1-27 `INT-042`) · Owner requirements 3 and 4 |
| Depends on           | **PRE-P1-29 Wave C (hard, admin half only)**                                                     |
| Database change      | **yes** — one nullable column, one index, one FK                                                 |
| New permission codes | **none** — `org.department.manage` is already seeded and orphaned                                |
| Complexity           | **M**                                                                                            |

---

## 1. Problem statement

Owner requirement 3 is _"multiple departments may work on one vehicle"_ and requirement 4 is
_"configurable department list"_. Neither can be expressed. Not because departments are unmodelled
— they are modelled thoroughly — but because the table holds no rows, no route mentions it, and no
work-domain record carries a `department_id`.

**The superseded claim that departments do not exist is false and must not be repeated.** It
appears in a P1-27 discovery lane and in the shape of `INT-042`. Repeating it would cause this
slice to be sized as schema design when it is almost entirely contract work plus one column.

## 2. Existing repository evidence

### The table

`org.departments` — `supabase/migrations/20260717104000_org_operational_structure.sql:109`:

```
id, tenant_id, company_id, branch_id, department_code, name, status,
record_version, created_at/by, updated_at/by, deleted_at/by, archived_at, archived_by
```

| constraint           | value                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| scope                | `fk_departments_branch (tenant_id, company_id, branch_id) → org.branches (tenant_id, company_id, id)` RESTRICT                        |
| code format          | `ck_departments_code_format CHECK (department_code ~ '^[a-z][a-z0-9_]{1,62}$')`                                                       |
| status               | `ck_departments_status CHECK (status IN ('active','inactive'))`                                                                       |
| live-code uniqueness | `uq_departments_branch_code_live (tenant_id, company_id, branch_id, department_code)` — the comment states _"archive frees the code"_ |
| RLS                  | enabled **and** forced; three scope policies; grants to `app_runtime`/`app_readonly`                                                  |

**Archival semantics are already decided** — two orthogonal axes, `status` for operational
availability and `archived_at` for retirement, with archival releasing the code for reuse. See
[C-07](repository-corrections.md#c-07--department-archival-is-already-modelled). This slice
implements them; it does not design them.

### The authorization layer implements department scope end to end

This is the part that makes the slice cheap, and it is easy to miss.

| artefact                                 | evidence                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scope vocabulary                         | `ck_grant_scopes_type CHECK (scope_type IN ('company','branch','department'))` — `20260718092000_iam_role_grants_and_scopes.sql:141`                                                         |
| shape constraint                         | `ck_grant_scopes_shape` requires all three ids when the type is `department` — `:142+`                                                                                                       |
| referential integrity                    | `fk_grant_scopes_department FOREIGN KEY (tenant_id, company_id, branch_id, department_id) REFERENCES org.departments (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT` — `:138-140` |
| the FK target index                      | `uq_departments_scope_id UNIQUE (tenant_id, company_id, branch_id, id)` — added at `:58` **for exactly this purpose**                                                                        |
| resolution                               | `iam.has_permission_in_scope(text, uuid, uuid, uuid)` — a **fourth** parameter, resolving `scope_type = 'department'` — `20260718097000:125-130`, `:207`                                     |
| delegation backstop                      | `20260727090000:159`, `:182` — _"branch covers its departments; department covers itself"_                                                                                                   |
| a shipped consuming policy               | `20260815093000_rec_receiving_employee_identity.sql:168`                                                                                                                                     |
| the HTTP surface that already accepts it | `apps/api/src/app/api/v1/iam/grants/route.ts` and `iam/grants/[grantId]/scopes/route.ts` accept `scopeType: 'department'` with a `departmentId`                                              |

### The permission code

`org.department.manage` — `supabase/seeds/04_iam_permission_catalog.sql:21`, risk `medium`.
**Declared by zero operations.** It is one of the thirteen orphans in `BE-5`'s reverse direction,
and one of the five `org.` orphans that PRE-P1-29 Wave C is scoped to close (`scope.md:49`, `:176`).

### What is measurably absent

```
$ grep -rln "department_id" supabase/migrations/
20260718092000_iam_role_grants_and_scopes.sql      (7 hits)
20260718097000_iam_context_and_permission_functions.sql  (1)
20260727090000_iam_grant_delegation_scope_backstop.sql   (2)

$ grep -rli "department" apps/api/src/app/api/v1/
iam/grants/route.ts
iam/grants/[grantId]/scopes/route.ts
```

**Three IAM migrations, zero `wo`/`dia`/`tech`/`qms` tables, two IAM routes.** `org.departments`
holds zero rows.

## 3. Gap

| gap                                                                                 | class                                                 |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| no department row can be created through any API                                    | **API** — _owned by PRE-P1-29 Wave C_                 |
| `org.department.manage` is declared by no operation                                 | **Authorization** — same owner                        |
| no work-domain record can belong to a department                                    | **Domain model** + **DB** — _owned by this slice_     |
| no read lists a branch's departments for a picker                                   | **Contract**                                          |
| a department-scoped grant can be issued against a department that cannot be created | **Governance** — the FK makes it unusable, not unsafe |

**The split is the most important thing in this contract.** `BE-7`'s ownership field says the
management surface belongs to PRE-P1-29's organisation-administration dimension — the same gap that
already covers companies and branches, which likewise cannot be created through the API at all.
Only the relationship half is P1-29's.

The frozen gate says that half depends on _Wave B_. **Three PRE-P1-29 documents say Wave C, and
this plan follows them** (`AMB-11`); the gate line is the one to correct.

## 4. Proposed architecture

**Two halves, two owners, one hard edge between them.**

### Half A — administration (PRE-P1-29 Wave C, _not_ this slice)

Create / list / read / update / archive `org.departments`, consuming the already-seeded
`org.department.manage`. Recorded here as a dependency so that P1-29 does not build it, and so that
Wave C knows P1-29 is a consumer.

### Half B — the work-domain relationship (this slice)

**`department_id` goes on `wo.jobs`, nullable.** Three reasons, in order of weight:

1. **A department works a job, not a whole order.** Owner requirement 3 is literally _"multiple
   departments may work on one vehicle"_; one work order with two jobs in two departments is the
   only shape in this schema that expresses it. Putting the column on `wo.work_orders` would make
   the requirement inexpressible.
2. **`wo.jobs` already carries the exact composite key the FK needs** — `(tenant_id, company_id,
branch_id, ...)` NOT NULL, and `org.departments` already carries `uq_departments_scope_id` on
   the matching tuple. The FK is a transcription, not a design.
3. **Nullable is required, not preferred.** Every existing job has no department and there is no
   honest value to backfill. A NOT NULL column would need a default department, which would be
   fabricated business data — forbidden by the standing policy and, for this table, meaningless.

**Rejected placements**, with the reason each fails:

| placement                                | why rejected                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wo.work_orders.department_id`           | cannot express "multiple departments on one vehicle" — the requirement itself                                                                                                                                                                                                                |
| `wo.job_assignments.department_id`       | conflates _who_ with _which unit_; an assignment already names a technician, and a job without an assignment would lose its department                                                                                                                                                       |
| `tech.technician_profiles.department_id` | a technician's home unit is a roster fact, not a routing fact; it would make the department of a job depend on who happened to be assigned, and it would be immutable (see [C-01](repository-corrections.md#c-01--a-technicians-branch-and-user-are-immutable-so-transfer-is-not-an-update)) |
| a normalised `wo.job_departments` join   | a job is worked by one department at a time; a many-to-many models a situation nobody has asked for and makes every read a join                                                                                                                                                              |
| `dia`/`qms` tables                       | diagnostics and QC are activities on a job, not units of organisation; they inherit the job's department by parentage                                                                                                                                                                        |

**`DEP-B1`'s disposition is binding and constrains the frontend, not the backend:** _"Do not add a
department picker to any operational screen."_ This slice makes the relationship _storable and
readable_; whether any P1-29 screen offers to set it is a separate, later decision that Half A
gates.

## 5. Database impact

**One migration. Additive only.**

```sql
ALTER TABLE wo.jobs
  ADD COLUMN department_id uuid NULL;

ALTER TABLE wo.jobs
  ADD CONSTRAINT fk_jobs_department
    FOREIGN KEY (tenant_id, company_id, branch_id, department_id)
    REFERENCES org.departments (tenant_id, company_id, branch_id, id)
    ON DELETE RESTRICT;

CREATE INDEX ix_jobs_department
  ON wo.jobs (tenant_id, company_id, branch_id, department_id);
```

| property         | value                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nullable         | **yes** — no backfill, no default, no fabricated row                                                                                                                |
| FK behaviour     | `RESTRICT`, matching every other FK in the domain                                                                                                                   |
| index            | required — `contract-archaeology.md` §10.1 records **zero unindexed FKs** across all four schemas, and the P1-28 reception work shipped six. Do not be the seventh. |
| scope safety     | the composite FK makes a cross-branch department reference **structurally impossible**, exactly as every other parentage in this domain                             |
| RLS              | unchanged — `wo.jobs` policies are tenant/company/branch and need no edit                                                                                           |
| grants           | unchanged — `app_runtime` already holds UPDATE on `wo.jobs`                                                                                                         |
| immutability     | **do not** add `department_id` to `wo.jobs`'s immutable-columns guard. Re-routing a job to another department is a legitimate operational act.                      |
| migration prefix | must continue the filename series; `forbiddenMigrationPrefix` is a filename series, not an ordinal                                                                  |

**Rollback.** `DROP CONSTRAINT`, `DROP INDEX`, `DROP COLUMN`. Safe while the column is nullable and
unread. Once jobs carry departments, dropping the column destroys routing history that nothing else
records — so the rollback window closes as soon as the first non-null value is written. State that
in the migration header.

## 6. API impact

Two operations in this slice. The administration operations belong to Wave C and are **not**
specified here.

### `wo.job-department-set`

| field             | value                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| **method**        | `PATCH`                                                                         |
| **route**         | `/api/v1/jobs/{jobId}` — **extends the existing `wo.job-update`**, no new route |
| **purpose**       | Route a job to a department, or clear its routing.                              |
| **permission**    | `wo.job.manage` (existing, risk `medium`)                                       |
| **scope**         | `branch` (resolved from the job)                                                |
| **path params**   | `jobId` (uuid)                                                                  |
| **request body**  | adds `departmentId?: string \| null` to the existing body                       |
| **success**       | `200` · `JobView` (extended with `departmentId`)                                |
| **version guard** | **yes** — `wo.job-update` is already `versionGuarded`; unchanged                |
| **idempotency**   | no — `wo.job-update` is version-guarded and **not** idempotent; unchanged       |

**Why extend rather than add.** A separate `POST /jobs/{jobId}/department` would be a second write
path to one column, with its own version guard and its own audit record, for no gain. `wo.job-update`
already carries `wo.job.manage`, already guards the version, and already writes `wo.jobs`. Adding a
field is the smaller and safer change — and `wo.job-update`'s body already proves the pattern:
`jobType` is `string | null | undefined`, so the three-way optional/nullable distinction the mirror
must reproduce is already present in this exact body.

### `org.department-list`

| field            | value                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **method**       | `GET`                                                                                                                                                            |
| **route**        | `/api/v1/departments`                                                                                                                                            |
| **purpose**      | List a branch's departments, for a picker and for rendering a name against a job's `departmentId`.                                                               |
| **permission**   | `org.department.manage`? **No — see §7.** Reuse `wo.work_order.read`.                                                                                            |
| **scope**        | `branch`                                                                                                                                                         |
| **query params** | `companyId` (uuid, **required**), `branchId` (uuid, **required**), `status?` (`active` \| `inactive`), `includeArchived?` (boolean, default false) — `.strict()` |
| **success**      | `200` · `{items: DepartmentSummary[]}` — `ItemsOnly<T>`                                                                                                          |
| **pagination**   | none — a branch's departments are a picker-sized set, matching `rec.catalogue-visit-reason-list`                                                                 |
| **sorting**      | `department_code` ascending, server-fixed                                                                                                                        |

`DepartmentSummary` = `{id, departmentCode, name, status}`. **No `tenantId`, `companyId` or
`branchId` in the projection** — the multi-tenant UX rule is that no screen displays those
identifiers, so a read that returns them invites a screen to.

**Ownership note.** If Wave C ships a department read of its own, this operation is redundant and
should be dropped rather than duplicated. `BR-02` must check Wave C's delivered surface before
implementing it. Building both is the failure `README.md` §1 exists to prevent.

### Error cases

| condition                                           | status | code                                                                                                                                                        |
| --------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `departmentId` names a department in another branch | 422    | `ERR-VAL-001` — the FK would raise `23503`; the service must refuse it before the database does, so the caller gets a violation path rather than a SQLSTATE |
| `departmentId` names a non-existent department      | 422    | `ERR-VAL-001`                                                                                                                                               |
| `departmentId` names an archived department         | 422    | `ERR-VAL-001` — routing new work to a retired unit is a validation failure, not a conflict                                                                  |
| job not found or out of scope                       | 404    | `ERR-RES-001`                                                                                                                                               |
| stale `If-Match`                                    | 409    | `ERR-CON-001`                                                                                                                                               |
| `If-Match` absent                                   | 428    | `ERR-CON-002`                                                                                                                                               |

## 7. Permission model

**Mint nothing.**

| operation               | code                 | justification                                                                                                                |
| ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `wo.job-department-set` | `wo.job.manage`      | routing a job is editing a job; `wo.job.manage` is exactly _"create and update a job"_ and is already the code on this route |
| `org.department-list`   | `wo.work_order.read` | **a picker read is not a management authority**                                                                              |

**The `org.department.manage` decision, stated because it is counter-intuitive.** The seeded code
is risk `medium` and reads _"manage departments"_. It is the right code for Wave C's create/update
/archive surface. It is the **wrong** code for a list a job-routing screen needs: requiring it would
mean every workshop supervisor who routes a job must also hold the authority to create and archive
departments. That is a privilege escalation dressed as a convenience, and it is precisely the shape
`permission-matrix.md` §5 catalogues as a separation-of-duty pair.

The precedent is shipped: `rec.catalogue-visit-reason-list` is a picker read behind an ordinary
read code, while `rec.catalogue.manage` gates authoring — _"Template administration is not a
receptionist function"_.

| actor                 | routing a job                                           | listing departments              | creating a department |
| --------------------- | ------------------------------------------------------- | -------------------------------- | --------------------- |
| Owner / company admin | yes, if they hold `wo.job.manage`                       | yes                              | yes (Wave C)          |
| branch manager        | yes                                                     | yes                              | Wave C's decision     |
| service advisor       | only with `wo.job.manage`                               | yes with `wo.work_order.read`    | no                    |
| technician            | no                                                      | yes if they hold work-order read | no                    |
| cross-tenant          | refused by tenant resolution                            | refused                          | refused               |
| cross-branch          | refused by the composite FK **and** by scope evaluation | refused by scope evaluation      | refused               |

## 8. Security requirements

| abuse case                                                    | required behaviour                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **cross-branch routing**                                      | a job in branch X cannot be routed to a department in branch Y — enforced by `fk_jobs_department` on the full composite, so it is structural rather than checked          |
| **cross-tenant**                                              | same FK; a cross-tenant tuple does not exist                                                                                                                              |
| **forged foreign id**                                         | `departmentId` is validated against the job's own scope before the write; the FK is the backstop, not the control                                                         |
| **mass assignment**                                           | the `wo.job-update` body is `.strict()`; `departmentId` is the only field added                                                                                           |
| **IDOR**                                                      | `jobId` resolves under RLS; an out-of-scope job is 404, indistinguishable from absent                                                                                     |
| **privilege escalation**                                      | no new code; `org.department.manage` is deliberately _not_ required for the read                                                                                          |
| **archived-department routing**                               | refused at validation — an archived department's code may have been reused by a live one, so routing to the archived id would attach work to a unit that no longer exists |
| **department-scoped grant against an uncreatable department** | pre-existing and unchanged by this slice; the FK makes such a grant unwritable, so it is inert rather than dangerous. Recorded, not fixed here.                           |
| **race**                                                      | two callers routing the same job — second receives `ERR-CON-001` via the existing version guard                                                                           |

**One escalation this slice must not create.** `iam.has_permission_in_scope` resolves
`scope_type = 'department'`, and the delegation backstop says _"branch covers its departments"_.
Once jobs carry departments, a department-scoped grant becomes a _usable_ narrowing for the first
time. Nothing in this slice consumes it — no `wo` RLS policy reads `department_id`, and none should
be added here — but a test must assert that a department-scoped grant does **not** widen anything,
because the combination has never been exercised against a table that actually carries the column.

## 9. Validation

| concern                 | rule                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ids                     | `departmentId`: `schemas.uuid.nullable().optional()` — the three-way distinction matters and `z.toJSONSchema` reproduces it faithfully |
| enums                   | `status`: `z.enum(['active','inactive'])` on the list query                                                                            |
| relationship validation | the department must belong to the **job's** `(tenant_id, company_id, branch_id)`, resolved from the job, never from the request        |
| foreign ownership       | resolved server-side; the request never names a company or branch for the department                                                   |
| state compatibility     | `archived_at IS NULL` and `status = 'active'` required to _set_; clearing to `null` is always allowed                                  |
| empty / partial update  | omitting `departmentId` leaves it unchanged; sending `null` clears it. These are different and must be tested separately               |
| duplicate prevention    | not applicable — a job has at most one department by column arity                                                                      |
| lengths / timestamps    | none in this contract                                                                                                                  |

Export the `Body` and `Query` schemas (standing requirement, `BR-01` §9).

## 10. Error contract

**No new error codes.**

| condition                                      | HTTP | code          | frontend behaviour                                                                                |
| ---------------------------------------------- | ---- | ------------- | ------------------------------------------------------------------------------------------------- |
| department not found / wrong branch / archived | 422  | `ERR-VAL-001` | field error on the department control, key not prose                                              |
| job not found or out of scope                  | 404  | `ERR-RES-001` | `error` — existence is not disclosed                                                              |
| not permitted                                  | 403  | `ERR-IAM-001` | `denied` + correlation id                                                                         |
| stale version                                  | 409  | `ERR-CON-001` | `conflict`, **warning** tone — re-read, re-render, let the user decide. Never auto-retry (`T-06`) |
| version header absent                          | 428  | `ERR-CON-002` | a client defect; surface as an error with the correlation id                                      |

## 11. Audit and history behaviour

`wo.job-update` already declares `auditClass: privileged`; routing a job inherits it unchanged.

**What must be historically visible, and what deliberately is not:**

- The **work-order transactional history** requirement is met by the existing job history surface —
  `GET /jobs/{jobId}/history` returns `{origin, transitions[]}` with `from_state`, `to_state`,
  `reason`, `correlation_id`, `actor_id`, `occurred_at`.
- **`wo.job_status_history` records state transitions, not column edits.** A department change is
  not a state transition and will therefore **not** appear in the job timeline. This is a real
  limitation and must be stated rather than assumed away: a job's routing history is recoverable
  only from the audit log, not from any read this platform publishes.
- **Do not add a department column to the history table to fix that.** It would change a P1-9
  append-only structure to serve a P1-29 convenience, and the audit trail already carries the actor
  and correlation id. If routing history is an Owner requirement, it is a separate slice with its
  own table.

## 12. Tests

### Positive

| #   | case                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------- |
| P1  | a job is routed to an active department in its own branch; `JobView.departmentId` reflects it                               |
| P2  | routing is cleared by sending `departmentId: null`                                                                          |
| P3  | omitting `departmentId` from the body leaves an existing routing unchanged                                                  |
| P4  | `GET /departments` returns the branch's active departments, sorted by code                                                  |
| P5  | **the Owner requirement, end to end**: one work order, two jobs, two departments, both readable in `WorkOrderDetail.jobs[]` |

### Negative

| #   | case                                            | expected          |
| --- | ----------------------------------------------- | ----------------- |
| N1  | no auth                                         | 401               |
| N2  | caller lacks `wo.job.manage`                    | 403               |
| N3  | `departmentId` is a uuid that does not exist    | 422               |
| N4  | `departmentId` names an **archived** department | 422               |
| N5  | `departmentId` names an `inactive` department   | 422               |
| N6  | `If-Match` omitted                              | 428               |
| N7  | `If-Match` stale                                | 409               |
| N8  | unknown body key                                | 422 (`.strict()`) |
| N9  | `GET /departments` without `branchId`           | 422               |

### Security

| #   | case                                                                                                                                          | expected                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| S1  | **cross-branch**: route a branch-X job to a branch-Y department                                                                               | 422 at validation; and if validation were removed, `23503` from `fk_jobs_department` — assert **both** layers |
| S2  | **cross-tenant**: department id from tenant B                                                                                                 | 422; no row is written                                                                                        |
| S3  | **IDOR**: `PATCH` a job in a branch the caller holds no grant over                                                                            | 404, not 403 — existence not disclosed                                                                        |
| S4  | **mass assignment**: body carries `tenantId`/`companyId`/`branchId`                                                                           | 422                                                                                                           |
| S5  | **department-scoped grant does not widen**: a caller granted at department scope reads only what a branch-scoped equivalent would, never more | run as a restricted user; this combination has never been exercised against a table carrying the column       |
| S6  | `GET /departments` from another branch returns that branch's departments only                                                                 | restricted user                                                                                               |

### Regression — must remain green

- Every existing `wo.job-update` test — the body gains one optional field and must otherwise behave identically.
- `WorkOrderDetail` consumers — `JobView` gains a field; any test asserting an exact key set will need updating, and that update must be reviewed rather than auto-applied.
- The **unindexed-FK assertion** across the four schemas, if one exists; if it does not, this slice adds one.
- `structuralTotals` in the CI baseline — a new column and index move it, and it **cannot be reproduced locally** because Supabase schemas inflate it. Take the figure from a CI run.

## 13. Definition of Done

- [ ] One additive migration: nullable `wo.jobs.department_id`, composite FK to `org.departments`, covering index.
- [ ] Zero FKs without a covering index across `wo`/`dia`/`tech`/`qms`, asserted.
- [ ] `department_id` is **not** in `wo.jobs`'s immutable-columns guard.
- [ ] `wo.job-update` accepts `departmentId?: string | null`; `JobView` returns it.
- [ ] `GET /api/v1/departments` published under `wo.work_order.read`, **or** dropped in favour of a Wave C read that already exists — the choice recorded in the slice's evidence.
- [ ] **Zero** permission codes added.
- [ ] `org.department.manage` remains declared by the Wave C administration surface only.
- [ ] Positive P1–P5, negative N1–N9, security S1–S6 all pass.
- [ ] S1 asserts refusal at **both** the validation layer and the FK.
- [ ] S5 executed as a restricted user, not asserted.
- [ ] The migration header states the rollback window closes at the first non-null write.
- [ ] The slice's evidence records plainly that department routing changes do **not** appear in the job timeline.
- [ ] No file under `apps/web` is changed.
- [ ] Wave C's department administration surface exists and is proven **before** any P1-29 screen offers a department control.
