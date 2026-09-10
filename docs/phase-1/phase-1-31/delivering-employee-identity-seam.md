# P1-31 — the delivering-employee identity seam (P-17)

What was published, why the table had to be new, and — separated explicitly, because the two were
conflated in the first draft of this slice — which statements are **Owner decisions**, which are
**engineering choices**, which are **recommendations pending Owner approval**, and which are
**verified facts** measured by a suite. Plus the one operator act this slice creates and does not
perform.

|                              |                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Phase**                    | P1-31 — Vehicle Delivery, Warranty, and Reporting Frontend                                                                                                         |
| **Authority**                | Owner decision of **2026-09-10** and the Owner clarification of the same day, delivering employee. Prerequisite **P-17** of [`a0-preflight.md`](./a0-preflight.md) |
| **Lane**                     | `remediation/p1-31-backend-delivering-employee-identity`, ownership profile `p1-31-backend`                                                                        |
| **Baseline**                 | protected `develop` **07193258**; `main` untouched                                                                                                                 |
| **Change control**           | [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) — **CC-29**, PROVISIONAL                                                                          |
| **Closes no canonical task** | P-17 is an execution prerequisite. The 29 remain 29, each still owing its own evidence                                                                             |

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

| clause                      | structure                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| tenant-owned identity       | `org.employees`, RLS enabled and forced; READ tenant-wide, WRITE `tenant/company/branch`                                 |
| distinct from the account   | `user_account_id` is **NULLABLE**                                                                                        |
| distinct from the actor     | `created_by` on the delivery is the session principal; the suite asserts the two differ                                  |
| server-validated reference  | `fk_delivery_records_delivering_employee` on `(tenant_id, delivering_employee_id)`                                       |
| server-validated assignment | `sal.stamp_delivering_employee_identity`, a `BEFORE INSERT` trigger, refuses a retired, deleted or other-tenant employee |
| historical attribution      | `delivering_employee_display_name`, stamped server-side and frozen by `tg_delivery_records_immutable`                    |
| not HR                      | no contract, salary, contact detail, document, department, grade or reporting line — seven columns and the lifecycle     |

## 2a. The Owner clarification of 2026-09-10, and what it changed

Three statements, and each one is labelled below in the register of section 3 so that no reader has
to guess whose decision it was.

**OWNER DECISION.** An employee's **home branch must not become a restriction** against authorized
work in another branch of the same tenant. A colleague sent to another site to hand a vehicle over
is a normal day. So the reference from `sal.delivery_records` names `(tenant_id, id)` and nothing
narrower, the eligibility trigger does not read the employee's company or branch at all, and the
`employee_branch_mismatch` refusal that the first draft of this slice shipped was **removed with the
rule it enforced**. `org.employees.branch_id` remains as the informational, transferable home
branch.

**OWNER DECISION.** A legacy `delivering_employee_id` that resolves to nobody is **left exactly as
it is**. It is not replaced by the migrating actor, no person is fabricated for it, and the
migration does not fail. It is recorded in `sal.delivery_legacy_identity_review` so the Owner can
see which handovers carry an unresolved identity, and `delivering_employee_display_name` is
`NULL` for it — which is what `NULL` means in that column and the only thing it means.

**OWNER DECISION (already approved).** Employee identity is **independent of a login**. That is A-1
below and it is not pending anything.

**ENGINEERING CHOICE that follows from the first.** `sel_employees_tenant` reads **tenant-wide**,
on the `iam.user_accounts` precedent. It has to: the delivery module's pre-check and the trigger
both resolve the employee under the caller's own RLS, so a branch predicate on the read would have
made a cross-branch handover impossible for every branch-restricted operator — the rule would have
survived in the policy after being removed from the constraint. Write policies keep their
company/branch predicates, and the register's own row-addressed operations re-authorize the row's
company and branch in the application, answering a scope refusal with the same not-found an absent
id gets.

## 3. The register: who decided what

Four labels, used exactly as written. Nothing in this document is left for a reader to classify.

| id      | statement                                                                        | label                                                          | if it is answered the other way                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A-1** | An employee may exist with **no user account**                                   | **OWNER DECISION — approved**                                  | Making `user_account_id` mandatory is a new migration and removes the only reason this table exists                                                                        |
| **A-2** | The home branch is **informational and transferable**, never a restriction       | **OWNER DECISION — approved 2026-09-10**                       | `branch_id` is absent from the immutable guard and from every rule; reinstating a branch rule is a migration                                                               |
| **A-3** | Rows minted by the backfill are **`inactive`**                                   | **ENGINEERING CHOICE — recommendation pending Owner approval** | **Recommendation: keep `inactive`.** A legacy account proves a handover happened once, not that the person is on the roster today; an operator reinstates the ones who are |
| **A-4** | `employment_ref` is **optional**, opaque, and **unique per tenant** when present | **ENGINEERING CHOICE — recommendation pending Owner approval** | **Recommendation: keep both properties.** Mandatory would exclude every employee with no external record, and non-unique would stop it identifying anybody                 |
| **A-5** | Administering an employee stays **branch-scoped**, while reading is tenant-wide  | **ENGINEERING CHOICE — recommendation pending Owner approval** | **Recommendation: keep the split.** Choosing a colleague is not the same authority as editing the roster; widening the write is a policy change, not a code change         |

Every other statement in this document is either an **OWNER DECISION** quoted in section 2, or a
**VERIFIED FACT** — a property a case in `tests/backend/p1-31-delivering-employee-seam.test.ts` or
`tests/db/org-employees.test.ts` asserts, named where it is claimed.

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

On the delivery side the same principle produces two DISTINCT rules, and the distinction is
deliberate:

| rule                | when                                             | the operator's correction    |
| ------------------- | ------------------------------------------------ | ---------------------------- |
| `custom`            | not visible — absent, deleted, or another tenant | check the identifier         |
| `inactive_employee` | the employee is retired                          | reinstate, or choose another |

`custom` is reserved for the first because naming a more specific rule there would confirm that an id
exists somewhere the caller cannot see.

There is deliberately **no third rule for a branch**, and its absence is asserted rather than
described: case **P17-D4** now creates an employee in another branch and expects a **201** with the
snapshot stamped. It replaced a case that expected a refusal.

## 7. The database is the authority, not the application

`sal.stamp_delivering_employee_identity` is `SECURITY INVOKER` with an empty `search_path`, so its
lookup runs under the caller's own RLS and an employee of another tenant is invisible before the
foreign key is ever consulted. It enforces both rules for **every** writer — the application, a
future job, and `psql` alike. It reads the employee's `display_name`, `status` and nothing else:
a rule that never loads company or branch cannot drift back into comparing them.

The service's two refusals are a **translation** of that trigger for a caller, not a second rule.
They exist so an operator is told which of two different mistakes they made, in the field-level
shape a form can render, instead of receiving one opaque refusal. If the two ever disagree the
trigger wins, and `toDomainFailure` maps its `22023` to the same `ERR-VAL-001` the pre-check
produces — which is what a retirement landing between the check and the insert looks like.

## 8. The backfill mints where it can, REPORTS where it cannot, and never invents

Legacy `delivering_employee_id` values were unconstrained uuids, so each distinct
`(tenant, value)` is judged on its own — which is the Owner clarification, and it is why the
migration no longer has a single all-or-nothing answer:

| the legacy value                                | what migration 141 does                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| matches an `iam.user_accounts` id of the tenant | mints one `org.employees` row **carrying the legacy uuid as its own `id`**, linked to that account, named from it, `status = 'inactive'` (A-3) |
| matches nothing                                 | **leaves it untouched**, lists the delivery in `sal.delivery_legacy_identity_review`, and leaves its `delivering_employee_display_name` `NULL` |

One employee is minted per distinct `(tenant, legacy value)`, so a value used in two branches still
becomes exactly one person. The home branch of that minted row is taken from the employee's earliest
delivery and is **informational** (A-2), which is why an id appearing in two branches is no longer
ambiguous and no longer a reason to refuse. The `created_by` of the minted row is that same account,
because there is no other honest actor to name.

The foreign key is added **`NOT VALID`** and a `DO` block validates it **only when the review list
is empty**. The consequences are exact and worth stating plainly:

- a fresh database, and any database whose history all resolves, ends with the key **fully
  validated** — every past row proved, every future row bound;
- a database carrying unresolved history keeps the key **`NOT VALID`**, which still binds every
  future row, and the migration emits a `RAISE NOTICE` with the count rather than a silent pass;
- nothing is ever rewritten to make the constraint validate. The alternative — substituting the
  migrating actor, or minting a placeholder person — would have produced a green constraint over a
  **falsified custody history**, which is the one outcome this seam exists to prevent.

`sal.delivery_legacy_identity_review` is tenant-scoped, RLS-forced, and **read-only to every
application role**: no role holds `INSERT`, `UPDATE` or `DELETE` on it. It is written once, by the
migration. Evidence a tenant can edit is not evidence.

`delivering_employee_display_name` is therefore **NULLABLE**, and `NULL` has exactly one meaning:
this handover's delivering identity was never resolved. Every row created after this migration
carries a name, because the trigger stamps one or refuses the insert. The immutable guard freezes the
column either way — a `NULL` snapshot cannot be filled in by an application write, which is why the
unresolved rows are listed for the Owner instead of being quietly completed.

`tests/db/org-employees.test.ts` replays the migration's **own** mint and review statements, sliced
out of the committed file rather than retyped, against legacy-shaped rows written inside a
transaction that drops the key and the guard and then puts them back. Both halves are proved: a
resolvable value mints a linked row and the key then validates; an unresolvable one survives
untouched, appears in the review table, and the key lands `NOT VALID` while `VALIDATE` fails with
`23503`. A transcription would have proved that a copy behaves.

## 9. What was proved, on real rows

- Every case in `tests/backend/p1-31-delivering-employee-seam.test.ts` goes through the real route
  handler, so the permission gate, the deferred scope check, the version guard, the idempotency
  reservation and the validation all run.
- Every case in `tests/db/org-employees.test.ts` runs at the database on the runtime connection
  under RLS. Admin behaviour is used only to provision, and never as evidence.
- An employee created with **no** `userAccountId` completes a handover, which is the property the
  whole table exists for.
- The snapshot survives a retirement on both published delivery reads.
- **VERIFIED FACT.** An active employee based in another branch of the same tenant is **accepted**
  and stamped, at the route (P17-D4) and at the primitive (`tests/db/org-employees.test.ts`
  obligation 4). Both cases also assert that the delivery stays in the work order's branch: the
  employee's branch is copied nowhere.
- **VERIFIED FACT.** An employee of another tenant is refused identically to an absent one, at both
  levels — which is what replaced the branch rule rather than merely what survived it.
- **VERIFIED FACT.** A branch-restricted session can READ an employee of another branch and still
  cannot UPDATE one, asserted on the runtime connection under RLS.
- **VERIFIED FACT.** On this database the foreign key is `convalidated` and the review table is
  empty, read from `pg_constraint` rather than from the printed definition.

## 10. What this does not close, and the one operator act it creates

- **No rename and no transfer command.** Both are legitimate and neither has an Owner decision
  behind it: a rename must say what happens to the snapshots already taken, and a transfer must say
  what happens to deliveries recorded in the branch being left. `branch_id` is left mutable by the
  schema so a transfer command needs no second migration.
- **No delete, at any level.** No application role holds `DELETE` and
  `fk_delivery_records_delivering_employee` is `ON DELETE RESTRICT`.
- **No operation over `sal.delivery_legacy_identity_review`, and no resolution command.** The table
  is readable by a runtime or read-only connection and by nothing else; resolving an unresolved
  historical identity would have to say who decides the person, which is an Owner question this
  slice does not answer. Reading the list needs no new code — it needs a decision about who may.
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
