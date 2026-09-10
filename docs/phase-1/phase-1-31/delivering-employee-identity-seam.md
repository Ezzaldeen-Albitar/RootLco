# P1-31 — the delivering-employee identity seam (P-17)

What was published, why the table had to be new, which parts of the Owner decision are settled and
which are working assumptions awaiting confirmation, and the one operator act this slice creates and
does not perform.

|                              |                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Phase**                    | P1-31 — Vehicle Delivery, Warranty, and Reporting Frontend                                                             |
| **Authority**                | Owner decision of **2026-09-10**, delivering employee. Prerequisite **P-17** of [`a0-preflight.md`](./a0-preflight.md) |
| **Lane**                     | `remediation/p1-31-backend-delivering-employee-identity`, ownership profile `p1-31-backend`                            |
| **Baseline**                 | protected `develop` **07193258**; `main` untouched                                                                     |
| **Change control**           | [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) — **CC-29**, PROVISIONAL                              |
| **Closes no canonical task** | P-17 is an execution prerequisite. The 29 remain 29, each still owing its own evidence                                 |

---

## 1. The measured problem

`sal.delivery_records.delivering_employee_id` landed in P1-11 as `NOT NULL` **with no foreign key of
any kind**. Any uuid at all was a legal handover officer, so the column recorded a _claim_ rather
than an identity — and every fixture in this repository proved it, by passing either a LOGIN ACCOUNT
id or `randomUUID()` and being accepted without complaint.

The reception side of the same custody chain had already been closed:
`20260815093000_rec_receiving_employee_identity.sql` bound `receiving_employee_id` to
`iam.user_accounts`, because the person accepting custody at reception signs in. The delivery side
could not be closed the same way, and the reason was measured before anything was proposed:

| candidate                        | column               | why it cannot hold a delivering employee                                           |
| -------------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `tech.technician_profiles`       | `user_id` `NOT NULL` | requires an `iam.user_accounts` row, and it is a technician ROSTER, not a person   |
| `iam.user_employee_links`        | `user_id` `NOT NULL` | requires an `iam.user_accounts` row; it links an account to an external reference  |
| `iam.user_accounts` (as for rec) | —                    | requires a login, which the person handing a vehicle over frequently does not have |

That `NOT NULL` on both `user_id` columns is asserted directly against `pg_attribute` in
`tests/backend/p1-31-delivering-employee-seam.test.ts`, so the justification for a new table is a
measurement in the suite rather than a sentence in this document.

## 2. What the Owner decided, 2026-09-10

> A delivering employee is a **tenant-owned employee identity**, distinct from the login account,
> from the authenticated actor, and from the authorized receiver. The reference and the
> organisational assignment are **validated by the server**. Historical attribution is **preserved**.
> This is **not** an HR module.

Every one of those five clauses has a structure behind it:

| clause                      | structure                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| tenant-owned identity       | `org.employees`, RLS enabled and forced, `tenant/company/branch` policies                                            |
| distinct from the account   | `user_account_id` is **NULLABLE**                                                                                    |
| distinct from the actor     | `created_by` on the delivery is the session principal; the suite asserts the two differ                              |
| server-validated reference  | `fk_delivery_records_delivering_employee` on all four scope columns                                                  |
| server-validated assignment | `sal.stamp_delivering_employee_identity`, a `BEFORE INSERT` trigger, refuses a retired or other-branch employee      |
| historical attribution      | `delivering_employee_display_name`, stamped server-side and frozen by `tg_delivery_records_immutable`                |
| not HR                      | no contract, salary, contact detail, document, department, grade or reporting line — seven columns and the lifecycle |

## 3. ASSUMPTIONS, pending Owner confirmation

These are **assumptions this implementation had to make**, not decisions the Owner recorded. Each is
a shape the schema now commits to and each could have been answered the other way. They are written
here, and in the header of `20260910090000_org_employees.sql`, so that confirming or reversing one is
a deliberate act rather than an archaeology exercise.

| id      | assumption                                                                       | what reversing it would cost                                                                                 |
| ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **A-1** | An employee may exist with **no user account**                                   | Making `user_account_id` mandatory is a new migration and removes the only reason this table exists          |
| **A-2** | An employee has **one home branch**, and it is **transferable**                  | `branch_id` is deliberately absent from the immutable guard. A multi-branch employee would need a join table |
| **A-3** | Rows minted by the backfill are **`inactive`**                                   | Nothing confirmed that a legacy account is a current employee; an operator reinstates the ones that are      |
| **A-4** | `employment_ref` is **optional**, opaque, and **unique per tenant** when present | Making it mandatory needs a value for every existing row, which nothing in the product can supply            |

## 4. The four operations

| operation                 | verb and path                             | permission            | scope    | guards                          |
| ------------------------- | ----------------------------------------- | --------------------- | -------- | ------------------------------- |
| `org.employee-list`       | `GET /org/employees`                      | `org.employee.read`   | `branch` | keyset paging, `expensive-read` |
| `org.employee-detail`     | `GET /org/employees/{employeeId}`         | `org.employee.read`   | `branch` | ETag carries `recordVersion`    |
| `org.employee-create`     | `POST /org/employees`                     | `org.employee.manage` | `branch` | `201`, `Idempotency-Key`        |
| `org.employee-status-set` | `POST /org/employees/{employeeId}/status` | `org.employee.manage` | `branch` | `If-Match` mandatory            |

The list and the detail take the **read** code and the two writes take the **manage** code, on the
`org.department` precedent and for its stated reason: reusing the manage code for the list would
force every handover clerk — anyone who must _choose_ a delivering employee — to hold the authority
to alter the organisation's roster. The suite proves the split from both sides, so collapsing the two
codes into one goes red rather than passing silently.

The create is the only one that trusts the request for its scope, because there is no row to resolve
yet; the other three resolve the row first and re-decide against the row's own company and branch.

## 5. The permissions — two MINTED codes

`org.employee.read` (risk `low`) and `org.employee.manage` (risk `medium`) are new rows in
`supabase/seeds/04_iam_permission_catalog.sql`. Nothing in the catalogue could have been reused: the
register did not exist, so no code named it.

**Both are carried by the tenant administrator provisioning bundle** (76 → 78), on the P-1 rule that
a code is held when a shipped operation declares it and the administrator needs it to exercise or
delegate the journey. Withholding either would be worse here than in any earlier widening:
`sal.delivery-create` now refuses an employee that does not exist, and nothing else in the product
creates one, so a freshly provisioned organisation could not record a single handover.

## 6. Absence, and what a 404 means here

Absent, soft-deleted, out of the caller's reach, and in another tenant are **one** `ERR-RES-001`,
decided before any scope decision. That follows `wty.warranty-policy-read`, the newest read in the
repository to face the same question, and it is what stops the register becoming a way to enumerate
another organisation's people.

On the delivery side the same principle produces three DISTINCT rules, and the distinction is
deliberate:

| rule                       | when                                             | the operator's correction       |
| -------------------------- | ------------------------------------------------ | ------------------------------- |
| `custom`                   | not visible — absent, deleted, or another tenant | check the identifier            |
| `inactive_employee`        | the employee is retired                          | reinstate, or choose another    |
| `employee_branch_mismatch` | the employee belongs to another branch           | choose someone from this branch |

`custom` is reserved for the first because naming a more specific rule there would confirm that an id
exists somewhere the caller cannot see.

## 7. The database is the authority, not the application

`sal.stamp_delivering_employee_identity` is `SECURITY INVOKER` with an empty `search_path`, so its
lookup runs under the caller's own RLS and an employee of another tenant is invisible before the
foreign key is ever consulted. It enforces all three rules for **every** writer — the application, a
future job, and `psql` alike.

The service's three refusals are a **translation** of that trigger for a caller, not a second rule.
They exist so an operator is told which of three different mistakes they made, in the field-level
shape a form can render, instead of receiving one opaque refusal. If the two ever disagree the
trigger wins, and `toDomainFailure` maps its `22023` to the same `ERR-VAL-001` the pre-check
produces — which is what a retirement landing between the check and the insert looks like.

## 8. The backfill mints, and it never invents

Existing `delivering_employee_id` values are `iam.user_accounts` ids. The migration mints one
`org.employees` row per distinct `(tenant, company, branch, delivering_employee_id)`, **carrying the
legacy uuid as its own `id`**, so every historical delivery keeps pointing at exactly the person it
always pointed at. `status` is `inactive` (A-3) and `created_by` is that same account, because there
is no other honest actor to name.

It **RAISES** rather than proceeding in two cases: a legacy value that matches no same-tenant account
(guessing a person would falsify handover history), and a legacy value that appears in more than one
branch of its tenant (the minted row takes the legacy uuid as its primary key, so one value can
become exactly one employee, and choosing a home branch is an Owner decision rather than a
migration's).

`tests/db/org-employees.test.ts` replays the migration's **own** mint statement, sliced out of the
committed file rather than retyped, against a legacy-shaped row written inside a transaction that
drops the key and the guard and then puts them back. A transcription would have proved that a copy
behaves.

## 9. What was proved, on real rows

- Every case in `tests/backend/p1-31-delivering-employee-seam.test.ts` goes through the real route
  handler, so the permission gate, the deferred scope check, the version guard, the idempotency
  reservation and the validation all run.
- Every case in `tests/db/org-employees.test.ts` runs at the database on the runtime connection
  under RLS. Admin behaviour is used only to provision, and never as evidence.
- An employee created with **no** `userAccountId` completes a handover, which is the property the
  whole table exists for.
- The snapshot survives a retirement on both published delivery reads.

## 10. What this does not close, and the one operator act it creates

- **No rename and no transfer command.** Both are legitimate and neither has an Owner decision
  behind it: a rename must say what happens to the snapshots already taken, and a transfer must say
  what happens to deliveries recorded in the branch being left. `branch_id` is left mutable by the
  schema so a transfer command needs no second migration.
- **No delete, at any level.** No application role holds `DELETE` and
  `fk_delivery_records_delivering_employee` is `ON DELETE RESTRICT`.
- **No screen, and no web contract change.** `apps/web` changes only in the generated idempotency
  manifest. The delivery contract mirror still lacks `deliveringEmployeeDisplayName` and its
  docblock still says `deliveringEmployeeId` has no foreign key — false after this slice, and left
  deliberately, because the `p1-31-backend` ownership profile forbids the `web` bucket. See CC-29
  and section 41.3 of the change control; the correction is owed to the frontend lane.
- **No index for the list ordering**, on the `sal.delivery-list` precedent (CC-23): a branch's
  employee register is small, and no measurement has demonstrated a cost a schema change would buy.
- **One operator act, created and NOT performed.** Every organisation already provisioned holds the
  76-code bundle and therefore neither new code. They need one backfill run of the existing tenant
  administrator bundle backfill after this merges. This slice does not run it and makes no claim
  that it has been run.
