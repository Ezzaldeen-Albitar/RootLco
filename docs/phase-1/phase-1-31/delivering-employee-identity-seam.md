# P1-31 — the delivering-employee identity seam (P-17)

What was published, why the table had to be new, and — separated explicitly, because they were
conflated in the first draft of this slice — which statements are **Owner decisions**, which are
**engineering consequences** of one, which are **engineering choices**, which are **recommendations
pending Owner approval**, and which are **verified facts** measured by a suite. Plus the one
operator act this slice creates and does not perform.

|                              |                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Phase**                    | P1-31 — Vehicle Delivery, Warranty, and Reporting Frontend                                                                                                                                                                                 |
| **Authority**                | Owner decision of **2026-09-10** ([`owner-decisions-2026-09-10.md` §1](./owner-decisions-2026-09-10.md)) and the Owner clarification of the same day, delivering employee. Prerequisite **P-17** of [`a0-preflight.md`](./a0-preflight.md) |
| **Lane**                     | `remediation/p1-31-backend-delivering-employee-identity`, ownership profile `p1-31-backend`                                                                                                                                                |
| **Baseline**                 | protected `develop` **ae0e0354**, merged in on 2026-09-12; written on **07193258**; `main` untouched                                                                                                                                       |
| **Change control**           | [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) — **CC-29**, PROVISIONAL                                                                                                                                                  |
| **Closes no canonical task** | P-17 is an execution prerequisite. The 29 remain 29, each still owing its own evidence                                                                                                                                                     |

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

**Measured facts (not part of the decision).** The table above is a measurement, not a decision.
That `NOT NULL` on both `user_id` columns is asserted directly against `pg_attribute` in
`tests/backend/p1-31-delivering-employee-seam.test.ts`, so the finding that no existing personnel
entity is suitable — the finding the Owner's reuse clause in section 2 obliged this lane to
establish before proposing anything — is a measurement in the suite rather than a sentence in this
document.

## 2. What the Owner decided, 2026-09-10 — [`owner-decisions-2026-09-10.md` §1](./owner-decisions-2026-09-10.md)

> A delivering employee is a **tenant-owned employee identity**, distinct from the login account,
> from the authenticated actor, and from the authorized receiver. The reference and the
> organisational assignment are **validated by the server**. Historical attribution is **preserved**.
> This is **not** an HR module. An existing suitable personnel entity is to be **reused** before a
> minimal new schema slice is created.

Those six clauses are the whole of the Owner's decision. Nothing under the sub-heading below is.

### Engineering consequence (not an Owner decision)

Each clause was implemented by a structure this lane chose. The clause on the left is the Owner's
wording; the structure on the right is an engineering consequence of it rather than a second
decision, and replacing a structure that still satisfies its clause needs no new Owner decision.

| Owner clause                | engineering consequence — the structure that implements the clause                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tenant-owned identity       | `org.employees`, RLS enabled and forced; READ tenant-wide, WRITE `tenant/company/branch`                                                                                 |
| distinct from the account   | `user_account_id` is **NULLABLE**                                                                                                                                        |
| distinct from the actor     | `created_by` on the delivery is the session principal; the suite asserts the two differ                                                                                  |
| server-validated reference  | `fk_delivery_records_delivering_employee` on `(tenant_id, delivering_employee_id)`                                                                                       |
| server-validated assignment | `sal.stamp_delivering_employee_identity`, a `BEFORE INSERT` trigger, refuses a retired, deleted or other-tenant employee                                                 |
| historical attribution      | `delivering_employee_display_name`, stamped server-side and frozen by `tg_delivery_records_immutable`                                                                    |
| not HR                      | no contract, salary, contact detail, document, department, grade or reporting line — seven columns and the lifecycle                                                     |
| reuse before creating       | the three candidates of section 1, each measured unfit in the suite before a new table was proposed; `org.employees` is the minimal slice that survived that measurement |

## 2a. The Owner clarification of 2026-09-10, and what it changed

Three Owner statements. Each is separated below from the engineering consequence that implements
it, and each is labelled again in the register of section 3, so that no reader has to guess whose
decision it was.

**OWNER DECISION.** An employee's **home branch must not become a restriction** against authorized
work in another branch of the same tenant. A colleague sent to another site to hand a vehicle over
is a normal day.

**Engineering consequence (not an Owner decision).** The reference from `sal.delivery_records` names
`(tenant_id, id)` and nothing narrower, the eligibility trigger does not read the employee's company
or branch at all, and the `employee_branch_mismatch` refusal that the first draft of this slice
shipped was removed with the rule it enforced. `org.employees.branch_id` remains as the
informational, transferable home branch. The key shape, the trigger's read list and the removed
refusal code are this lane's way of implementing the Owner's sentence; the Owner named none of
them.

**OWNER DECISION.** Legacy values are judged **one at a time**, and a `delivering_employee_id` that
resolves to nobody is **left exactly as it is**. It is not replaced by the migrating actor, no
person is fabricated for it, and the migration does not fail.

**Engineering consequence (not an Owner decision).** The unresolved delivery is recorded in
`sal.delivery_legacy_identity_review` so the Owner can see which handovers carry an unresolved
identity, and `delivering_employee_display_name` is `NULL` for it — which is what `NULL` means in
that column and the only thing it means. The review table, its name, its read-only grants and the
NULL-snapshot semantics are this lane's design; the Owner asked only that nothing be replaced or
fabricated and that the migration survive.

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

**Three** labels are used in the register below, exactly as written — **OWNER DECISION**,
**ENGINEERING CHOICE** and **RECOMMENDATION PENDING OWNER APPROVAL**. Two further labels are used
outside it and nowhere in it: **VERIFIED FACT**, at section 9.4 only, for a property a case
asserts; and **Engineering consequence (not an Owner decision)**, wherever this document states a
design element this lane chose. Nothing in this document is left for a reader to classify.

| id      | statement                                                                                  | label                                                          | if it is answered the other way                                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A-1** | An employee may exist with **no user account**                                             | **OWNER DECISION — approved**                                  | Making `user_account_id` mandatory is a new migration and removes the only reason this table exists                                                                                                                                                                                       |
| **A-2** | The home branch is **informational and transferable**, never a restriction                 | **OWNER DECISION — approved 2026-09-10**                       | `branch_id` is absent from the immutable guard and from every rule; reinstating a branch rule is a migration                                                                                                                                                                              |
| **A-3** | Rows minted by the backfill are **`inactive`**                                             | **ENGINEERING CHOICE — recommendation pending Owner approval** | **Recommendation: keep `inactive`.** A legacy account proves a handover happened once, not that the person is on the roster today; an operator reinstates the ones who are                                                                                                                |
| **A-4** | `employment_ref` is **optional**, opaque, and **unique per tenant** when present           | **ENGINEERING CHOICE — recommendation pending Owner approval** | **Recommendation: keep both properties.** Mandatory would exclude every employee with no external record, and non-unique would stop it identifying anybody                                                                                                                                |
| **A-5** | Administering an employee stays **branch-scoped**, while reading is tenant-wide            | **ENGINEERING CHOICE — recommendation pending Owner approval** | **Recommendation: keep the split.** Choosing a colleague is not the same authority as editing the roster; widening the write is a policy change, not a code change                                                                                                                        |
| **A-6** | An unresolved legacy identity has **no resolution command** and stays listed for the Owner | **RECOMMENDATION PENDING OWNER APPROVAL**                      | **Recommendation: resolve a listed row through one Owner-approved operator command that names a real employee for it and then re-runs `VALIDATE CONSTRAINT`, never inside a migration.** Leaving it undecided keeps the key `NOT VALID` on every database that carries unresolved history |

A-1 and A-2 are **approved** and are pending nothing; the register therefore carries **four**
pending recommendations, not three — **A-3**, **A-4**, **A-5** and **A-6**, each stated once in its
own row above and deliberately not restated here. A-3, A-4 and A-5 are engineering choices the DDL
has already committed to; A-6 commits to nothing and ships no command. What remains open about
branches is A-5's policy split only, never the branch rule itself, which the Owner settled on
2026-09-10.

Every other statement in this document belongs to one of three classes, and the class is written
where the statement is: an **OWNER DECISION** quoted in section 2 or section 2a; an **ENGINEERING
CONSEQUENCE (not an Owner decision)** — a design element this lane chose in order to implement an
Owner decision, which engineering may revisit without a new one; or a **VERIFIED FACT** — a property
a case in `tests/backend/p1-31-delivering-employee-seam.test.ts` or `tests/db/org-employees.test.ts`
asserts, named where it is claimed. Sections 2, 2a, 4, 5, 6, 7, 8 and 10 carry the middle label
explicitly, because the implementing structures, the read-versus-manage permission split, the
bundle widening, the refusal-rule names and the single `ERR-RES-001`, the trigger's security
properties and the service's translated refusals, the `NOT VALID` foreign key, and the
`ON DELETE RESTRICT` / no-`DELETE`-grant / no-index decisions were each readable as Owner decisions
in the first draft of this slice and none of them is one.

## 4. The four operations

| operation                 | verb and path                             | permission            | scope    | guards                          |
| ------------------------- | ----------------------------------------- | --------------------- | -------- | ------------------------------- |
| `org.employee-list`       | `GET /org/employees`                      | `org.employee.read`   | `branch` | keyset paging, `expensive-read` |
| `org.employee-detail`     | `GET /org/employees/{employeeId}`         | `org.employee.read`   | `branch` | ETag carries `recordVersion`    |
| `org.employee-create`     | `POST /org/employees`                     | `org.employee.manage` | `branch` | `201`, `Idempotency-Key`        |
| `org.employee-status-set` | `POST /org/employees/{employeeId}/status` | `org.employee.manage` | `branch` | `If-Match` mandatory            |

**Engineering consequence (not an Owner decision).** The four operations above, their two
permission codes and the read-versus-manage split are this lane's design. The Owner decided that the
reference and the organisational assignment are validated by the server; which codes guard the
register, and where the line between reading and administering falls, the Owner did not say.

The list and the detail take the **read** code and the two writes take the **manage** code, on the
`org.department` precedent and for its stated reason: reusing the manage code for the list would
force every handover clerk — anyone who must _choose_ a delivering employee — to hold the authority
to alter the organisation's roster. The suite proves the split from both sides, so collapsing the two
codes into one goes red rather than passing silently.

The create is the only one that trusts the request for its scope, because there is no row to resolve
yet; the other three resolve the row first and re-decide against the row's own company and branch.

## 5. The permissions — two MINTED codes

**Engineering consequence (not an Owner decision).** The two codes, their names, their risk classes
and the widening of the provisioning bundle from 76 to 78 are this lane's design throughout. No part
of the Owner decision names a permission code or a bundle.

`org.employee.read` (risk `low`) and `org.employee.manage` (risk `medium`) are new rows in
`supabase/seeds/04_iam_permission_catalog.sql`. Nothing in the catalogue could have been reused: the
register did not exist, so no code named it.

**Both are carried by the tenant administrator provisioning bundle** (76 → 78), on the P-1 rule that
a code is held when a shipped operation declares it and the administrator needs it to exercise or
delegate the journey. Withholding either would be worse here than in any earlier widening:
`sal.delivery-create` now refuses an employee that does not exist, and nothing else in the product
creates one, so a freshly provisioned organisation could not record a single handover.

## 6. Absence, and what a 404 means here

**Engineering consequence (not an Owner decision).** Everything in this section is this lane's
design: collapsing absent, soft-deleted, out-of-reach and other-tenant into a single
`ERR-RES-001`, the two rule names `custom` and `inactive_employee`, and the absence of a third
rule for a branch. The Owner decided that the reference and the organisational assignment are
validated by the server and that a home branch never restricts authorized work; the Owner named no
error code and no rule name, and any of them may be revised without a new Owner decision.

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

**Engineering consequence (not an Owner decision).** `SECURITY INVOKER`, the empty `search_path`,
the trigger's two-column read list, and the service's two refusals being a translation of the
trigger rather than a second rule are all this lane's design. The Owner decided that the server
validates; that the validation sits in a `BEFORE INSERT` trigger with these properties, and that
the application restates it in a field-level shape a form can render, the Owner did not say.

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

| the legacy value                                | what the operator command does                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| matches an `iam.user_accounts` id of the tenant | mints one `org.employees` row **carrying the legacy uuid as its own `id`**, linked to that account, named from it, `status = 'inactive'` (A-3) |
| matches nothing                                 | **leaves it untouched**, lists the delivery in `sal.delivery_legacy_identity_review`, and leaves its `delivering_employee_display_name` `NULL` |

One employee is minted per distinct `(tenant, legacy value)`, so a value used in two branches still
becomes exactly one person. The home branch of that minted row is taken from the employee's earliest
delivery and is **informational** (A-2), which is why an id appearing in two branches is no longer
ambiguous and no longer a reason to refuse. The `created_by` of the minted row is that same account,
because there is no other honest actor to name.

**The mint is an operator command, and that is a gate rather than a preference.** Both writes above
are row writes, and `scripts/ci/migration-replay-checks.mjs` refuses a top-level
`INSERT INTO <module schema>.<table>` in any migration — it refused this one on the hosted run of
PR #370. The rule is right and stays: to any scanner and any reviewer, a migration that INSERTs into
`org.employees` is indistinguishable from one that ships fabricated people. So migration 141 creates
**structure only**, and the row-level half lives in
`scripts/platform/backfill-delivering-employee-identity.mjs` — modelled on the tenant administrator
bundle backfill: an explicit target environment, a named scope or `--all`, a dry run, one
transaction per tenant, printed minted and unmatched counts, an evidence JSON, and an authority gate
on the EXISTING `platform.organization.provision` grant, for which no code is minted. It also
**stamps** the snapshot of the rows whose identity it mints, inside the same transaction, with
`tg_delivery_records_immutable` disabled for that statement alone and re-enabled in a `finally`: the
transaction holds `ACCESS EXCLUSIVE` on the table, so no other session ever writes it unguarded.

**Engineering consequence (not an Owner decision).** The foreign key is added **`NOT VALID`**. The
migration's `DO` block validates it **only when `sal.delivery_records` is empty**, and the operator
command validates it after the mint **only when nothing anywhere is left unresolved**. A `NOT VALID`
key with conditional validation is this lane's way of satisfying the Owner's instruction that
nothing be fabricated and that the migration not fail; the Owner named neither the constraint state
nor the condition. The consequences are exact and worth stating plainly:

- a fresh database ends with the key **fully validated** by the migration itself — there is no
  history to judge, and `VALIDATE CONSTRAINT` is DDL, which is why it may live in a migration while
  the mint may not;
- a database carrying history keeps the key **`NOT VALID`** until the operator command runs, which
  still binds every future row, and the migration emits a `RAISE NOTICE` naming that command rather
  than passing silently;
- after the command, a database whose history all resolves ends **fully validated**; one carrying an
  unresolved value keeps the key `NOT VALID` and the command reports the count;
- nothing is ever rewritten to make the constraint validate. The alternative — substituting the
  operator, or minting a placeholder person — would have produced a green constraint over a
  **falsified custody history**, which is the one outcome this seam exists to prevent.

`sal.delivery_legacy_identity_review` is tenant-scoped, RLS-forced, and **read-only to every
application role**: no role holds `INSERT`, `UPDATE` or `DELETE` on it, and it is written by the
operator command on a privileged connection. Evidence a tenant can edit is not evidence. It carries
an INSERT policy all the same — `ins_delivery_legacy_identity_review_refused`, `WITH CHECK (false)`
— because every `sal`, `wty` and `rpt` table owes a SELECT and an INSERT policy and
`tests/db/p1-11-isolation.test.ts` enumerates them from the catalog. The invariant is met the honest
way rather than by exempting the table: the refusal is a declared decision readable in `pg_policy`
instead of an absence a reader has to interpret, while the `42501` that actually stops a runtime
write is the missing grant, asserted unchanged.

`delivering_employee_display_name` is therefore **NULLABLE**, and `NULL` has exactly one meaning:
this handover's delivering identity was never resolved. Every row created after this migration
carries a name, because the trigger stamps one or refuses the insert. The immutable guard freezes the
column either way — a `NULL` snapshot cannot be filled in by an application write, which is why the
unresolved rows are listed for the Owner instead of being quietly completed.

`tests/db/org-employees.test.ts` drives the command's **own** core — `backfillOneTenant`, imported
from the module rather than retyped — against legacy-shaped rows written inside a transaction that
drops the key and the guard and then puts them back. Both halves are proved: a resolvable value
mints a linked row, its snapshot is stamped, the operator act is recorded in that tenant's audit
chain, and the key then validates; an unresolvable one survives untouched with a `NULL` snapshot,
appears in the review table, the command answers `withheld`, and `VALIDATE` fails with `23503`. The
same file asserts that the migration ships **no** `INSERT` into either table. A transcription would
have proved that a copy behaves. `tests/backend/p1-31-delivering-employee-backfill.test.ts` adds the
mechanism: no statement the command can execute is a `DELETE`, a `TRUNCATE` or a `DROP`, its single
`UPDATE` can only fill a `NULL` snapshot, the input gate refuses an unnamed environment, a
mismatched confirmation and an ambiguous scope, and the authority gate refuses both an absent
account and a real account holding no unrevoked grant of the platform code.

**Measured facts (not part of the decision).** The structural movement these two migrations cause —
`structuralTotals`, `schemaHash` and `permissionCount` in
`.github/ci-baselines/schema-baseline.json` — was measured on the local isolation clone described in
section 9.2, while that file designates CI as the authority for those figures. The hosted
`database-migration-replay` job must confirm them, and has **not yet been observed** doing so.

## 9. What was proved, where, and what is merely observed

Three different kinds of statement were conflated in the first draft of this slice, and they are
separated here under their own labels, because a reading of one database on one day is not a proof
about a migration, and neither of them is the status of a constraint.

### 9.1 OBSERVATION — the shared database, read-only, 2026-09-10

Read-only, changing nothing: on the shared local database `sal.delivery_records` held **0** rows.
It therefore held **0** distinct legacy `(tenant_id, delivering_employee_id)` pairs, of which **0**
matched a same-tenant account and **0** did not.

That is an observation of **one environment on one day**. It proves nothing whatever about the
migration's behaviour on data: an empty table exercises neither branch of the backfill, and a count
of zero is precisely the measurement that cannot tell a correct mint from an absent one. It is
recorded here so the number is not later mistaken for evidence.

### 9.2 CONTROLLED PROOF — the disposable clone

Unlike the observation, this environment carries legacy-shaped rows that the cases write
themselves, so both branches of the backfill are exercised.

**Measured facts (not part of the decision) — the runs this section reports.** Every run below was
executed against the disposable clone `p131_employee_20260910`, served on `127.0.0.1:55432` by
container `rootlco-p131-isolation-20260910` and rebuilt from the idle `p131_candidate` template at
**139** migrations before this slice's two were applied and registered, taking
`supabase_migrations.schema_migrations` to **141**. The clone was rebuilt that way twice: on
**2026-09-10** for the first two commits, and again on **2026-09-12** for the integration head.
There are **three** runs at **three different commits**, and each row names the commit its total was
measured at, because a total measured at one head is not a total measured at another:

| commit       | what was run                                                                                                                                 | result      | exit code |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------- |
| **244f868f** | `tests/db/org-employees.test.ts`                                                                                                             | 21 / 21     | 0         |
| **244f868f** | `tests/db/foundation.test.ts`, `tests/db/org-security.test.ts`, `tests/db/sal-delivery.test.ts` and `tests/db/no-fake-data.test.ts`          | 58 / 58     | 0         |
| **244f868f** | the 13 backend files over the delivery and organisation surface, of which `tests/backend/p1-31-delivering-employee-seam.test.ts` was 31 / 31 | 285 / 285   | 0         |
| **750913e3** | `tests/db/org-employees.test.ts`                                                                                                             | 23 / 23     | 0         |
| **750913e3** | `tests/db/org-security.test.ts` and `tests/db/no-fake-data.test.ts`                                                                          | 12 / 12     | 0         |
| **750913e3** | `tests/backend/p1-31-delivering-employee-seam.test.ts`                                                                                       | 31 / 31     | 0         |
| **706ba810** | `tests/backend/p1-31-delivering-employee-seam.test.ts`                                                                                       | 31 / 31     | 0         |
| **706ba810** | `tests/db/org-employees.test.ts`                                                                                                             | 23 / 23     | 0         |
| **706ba810** | `tests/db/foundation.test.ts`, `tests/db/org-security.test.ts`, `tests/db/sal-delivery.test.ts` and `tests/db/no-fake-data.test.ts`          | 37 / 37     | 0         |
| **706ba810** | the WHOLE backend tier, `npm run test:backend` over 137 files                                                                                | 2937 / 2937 | 0         |
| **706ba810** | `node scripts/db/validate-seed-state.mjs` — 8 declared seed files applied twice, every business table empty                                  | OK          | 0         |

The three runs differ because the tree moved between the heads, and every difference is stated
rather than averaged away:

- `tests/db/org-employees.test.ts` went from **21** cases to **23** in commit **d25ca30a**, which
  added section 6 — the review list's tenant isolation and its write refusal. **Those two cases
  were executed at 750913e3 and at no earlier head**; the 21 / 21 at 244f868f predates them.
- The only migration file touched after 244f868f was changed by **f704ec52**, which altered
  **comment text only** — no table, column, constraint, trigger, policy or grant moved.
- The **285 / 285** over the 13 backend files **was not re-run after 244f868f**. What was re-run at
  750913e3 is the seam file alone, which reported the same **31 / 31**.
- The two commits after 750913e3 — **ad6c4fbf** and **be58260d** — changed documentation only.
- **706ba810** is the merge of protected `develop` **ae0e0354** into this slice. At that head the
  WHOLE backend tier was run rather than the 13-file subset, so the **2937 / 2937** row supersedes
  the earlier **285 / 285** as a statement about the current tree instead of repeating it.
- That run found one real integration failure, and it was fixed rather than excluded: develop's own
  `tests/backend/p1-31-delivery-readiness-seam.test.ts` opened its fixture deliveries with a login
  account id, which this slice's foreign key and trigger refuse with `ERR-VAL-001`, so the file
  failed in its hook and its **25** cases reported as skipped. The merge commit routes that fixture
  through the shared helper this slice added, and the file reports **25 / 25**. The 2937 / 2937
  above is the run AFTER that fix.
- The commit after 706ba810 — **4d120670** — re-recorded the `unit` and `web` tiers and
  regenerated the evidence manifest. It moved no executable path, so nothing in this table was
  measured against a tree other than the one this head carries.
- The baseline values were re-measured on the rebuilt clone at that head rather than carried
  forward: **141** migrations, **121** permissions, `tables` **256**, `functions` **534**,
  `policies` **700**, `triggers` **563**, `security_definer` **0**, and `schemaHash` **a25718d7**.
  The same queries against the idle 139-migration template answer 254 / 533 / 695 / 560 / 0, so the
  delta is measured and not asserted. `structuralTotals` remains CI's figure to confirm for the
  reason `schema-baseline.json` states; this is the local companion measurement and is not a hosted
  result.

**No run ledger entry exists for either the database or the backend tier.**
`docs/phase-1/phase-1-27/evidence/local-run-ledger.json` records the `unit` and `web` tiers and
nothing else, so the totals above are this document's own report of three local runs rather than a
recorded tier measurement. **No hosted result exists for any of it**: nothing in this section has
been observed on CI.

Each obligation
below is cited by the **exact title** of the case that asserts it, so the claim is checkable against
the file rather than against this table.

| obligation                                                                                                                                       | file                                                   | describe › exact test title                                                                                                                                                                                                                                                                                                                                                                                                                            | state                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **(a)** a legacy value matching a same-tenant account mints a linked `org.employees` row whose `id` IS the legacy value, named from that account | `tests/db/org-employees.test.ts`                       | `5. the legacy mint, driven as the operator command drives it` › `mints exactly one employee per legacy value, stamps it, and never invents a person`                                                                                                                                                                                                                                                                                                  | **covered**                                                                                                             |
| **(b)** an unmatched legacy value survives untouched, is listed in `sal.delivery_legacy_identity_review`, and leaves the key `NOT VALID`         | `tests/db/org-employees.test.ts`                       | `5. the legacy mint, driven as the operator command drives it` › `leaves an UNRESOLVABLE legacy value untouched, lists it, and withholds validation`                                                                                                                                                                                                                                                                                                   | **covered**                                                                                                             |
| **(c)** a database with no unmatched rows ends with the key **validated** (`convalidated = true`)                                                | `tests/db/org-employees.test.ts`                       | `3. the delivering employee is a real identity` › `carries the composite foreign key on (tenant_id, delivering_employee_id), ON DELETE RESTRICT`, which reads `pg_constraint.convalidated` rather than the printed definition; the resolved path is proved end to end inside `5. …` › `mints exactly one employee per legacy value, stamps it, and never invents a person`, which runs `VALIDATE CONSTRAINT` after the mint and requires it to succeed | **covered**                                                                                                             |
| **(d)** the trigger refuses an inactive, a soft-deleted and an other-tenant employee, and accepts an active employee of another branch           | `tests/db/org-employees.test.ts`                       | `4. the eligibility trigger, and the snapshot it stamps` › `refuses a RETIRED employee (22023)` (the status value it writes is `inactive`), › `refuses a SOFT-DELETED employee (22023)`, › `refuses an employee of ANOTHER TENANT (22023)`, › `ACCEPTS an employee based in ANOTHER BRANCH of the same tenant, and stamps them`                                                                                                                        | **covered**                                                                                                             |
| **(d)** the same two answers at the route, not only at the primitive                                                                             | `tests/backend/p1-31-delivering-employee-seam.test.ts` | `sal.delivery-create now names a real person` › `P17-D3 refuses a RETIRED employee with rule inactive_employee (denial)` and › `P17-D4 ACCEPTS an active employee of another branch of the same tenant, and stamps them (success)`                                                                                                                                                                                                                     | **covered**                                                                                                             |
| **(e)** the review table is tenant-isolated and refuses writes from every application role                                                       | `tests/db/org-employees.test.ts`                       | `6. the review list is tenant-isolated and read-only to every application role` › `shows a runtime and a read-only session their own tenant row and not the other`, › `refuses INSERT, UPDATE and DELETE from the runtime login (42501)` and › `declares the refusal as a policy that admits nothing, not as a missing policy`                                                                                                                         | **covered — executed at 750913e3**, in the 23 / 23 run; both cases were added by d25ca30a and did not exist at 244f868f |

| **(f)** the operator command that owns the mint cannot rewrite history, and its input and authority gates refuse | `tests/backend/p1-31-delivering-employee-backfill.test.ts` | `P1-31 P-17 — the operator command cannot rewrite history (DEB-1)` › `issues no DELETE, no TRUNCATE and no DROP, and exactly one UPDATE`, › `mints only what an account of the same tenant already identifies`, › `re-enables the immutability guard on every path, including a failing one`, › `names the constraint it may validate, and validates nothing while anything is unresolved`; `… the input gate refuses before it connects (DEB-2)` and `… the authority gate is real (DEB-3)`, four and three cases — eleven in the file | **covered — added by the PR #370 remediation of 2026-09-12** |

**Gaps.** None — and the test for that is stricter than "a case exists". Every title cited above
both exists in the file named beside it **and** was executed in a run listed in the table of runs:
the `org-employees` titles in the **23 / 23** run at **750913e3**, which is the only run that
carried the two section-6 titles of obligation (e); the backend titles of obligation (d) in the
**31 / 31** run, reported at both heads. Nothing in this table is claimed that the two files do not
actually assert, and no obligation is cited against a title that has no executed run. Any
obligation later found uncovered, or cited without a run, belongs here under this label rather than
in the table above it.

**Measured facts (not part of the decision) — the structural baseline.** The `structuralTotals`,
`schemaHash` and `permissionCount` movements recorded for migrations 140 and 141 in
`.github/ci-baselines/schema-baseline.json` were measured on that same local isolation clone. That
file designates CI as the authority for them — it describes every value it holds as a claim the
`database-migration-replay` job re-proves from an empty PostgreSQL 17 on every run — so the hosted
replay must confirm them, and it has **not yet been observed** doing so. If it ever reports a
different movement, the migrations are to be re-read rather than the baseline re-recorded.

### 9.3 CONSTRAINT-VALIDATION STATUS

Stated precisely, because "the key is validated" is true of some databases and false of others:

- `fk_delivery_records_delivering_employee` is added **`NOT VALID`**.
- **A fresh database validates in the migration.** The `DO` block runs `VALIDATE CONSTRAINT` when
  `sal.delivery_records` holds **zero rows** — there is no history to judge, and `VALIDATE` is DDL,
  which is why it may stay in a migration while the mint may not.
- **A populated database validates through the operator command**, after the mint, and only when
  nothing anywhere is left unresolved: `scripts/platform/backfill-delivering-employee-identity.mjs`
  counts unresolved deliveries in EVERY tenant, not only those a scoped run named, and withholds
  validation otherwise. Until it runs, the key **remains `NOT VALID`** — binding every future row,
  proving no past one.
- **The shared database held 0 delivery rows when it was read on 2026-09-10** (section 9.1, an
  observation), so that run is expected to mint nothing there. It is an operator step all the same,
  not a skipped one: an environment nobody has read may hold history.
- A legacy value that resolves to nobody is still never resolved by this slice. Who decides the
  person is **A-6** in the register, a recommendation pending Owner approval; the command lists such
  rows and refuses to validate over them.
- The hosted migration replay is **defined** to start from an empty database — the
  `database-migration-replay` job in `.github/workflows/_reusable-database-assurance.yml` asserts
  that the database holds zero application tables at line 235 and applies every migration from zero
  at line 242 — so `sal.delivery_records` is empty there and it is **expected** to end with the key
  validated by that `DO` block. That is an expectation read
  from the workflow definition and **not yet an observed result**; no hosted run of this slice has
  been observed. Either way it would be a property of the replay environment and **not** evidence
  about a populated one.

### 9.4 What the two suites prove besides

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

## 10. What this does not close, and the one operator act it creates

**Engineering consequence (not an Owner decision).** Three of the items below are this lane's
design rather than anything the Owner settled: `fk_delivery_records_delivering_employee` being
`ON DELETE RESTRICT`, no application role holding `DELETE`, and no index being shipped for the list
ordering. Each is revisable without a new Owner decision. The remaining items are either an Owner
question this slice does not answer or an operator act it creates and does not perform.

- **No rename and no transfer command.** Both are legitimate and neither has an Owner decision
  behind it: a rename must say what happens to the snapshots already taken, and a transfer must say
  what happens to deliveries recorded in the branch being left. `branch_id` is left mutable by the
  schema so a transfer command needs no second migration.
- **No delete, at any level.** No application role holds `DELETE` and
  `fk_delivery_records_delivering_employee` is `ON DELETE RESTRICT`.
- **No operation over `sal.delivery_legacy_identity_review`, and no resolution command.** The table
  is readable by a runtime or read-only connection and by nothing else; resolving an unresolved
  historical identity would have to say who decides the person, which is an Owner question this
  slice does not answer. Reading the list needs no new code — it needs a decision about who may. That
  decision is **A-6**, one of the four recommendations the register leaves pending.
- **No screen, and no web contract change.** `apps/web` changes only in the generated idempotency
  manifest. The delivery contract mirror still lacks `deliveringEmployeeDisplayName` and its
  docblock still says `deliveringEmployeeId` has no foreign key — false after this slice, and left
  deliberately, because the `p1-31-backend` ownership profile forbids the `web` bucket. See CC-29
  and section 41.3 of the change control; the correction is owed to the frontend lane.
- **No index for the list ordering**, on the `sal.delivery-list` precedent (CC-23): a branch's
  employee register is small, and no measurement has demonstrated a cost a schema change would buy.
- **Two operator acts, created and NOT performed.** The first: every organisation already
  provisioned holds the 76-code bundle and therefore neither new code, so they need one run of the
  existing tenant administrator bundle backfill after this merges. The second:
  `scripts/platform/backfill-delivering-employee-identity.mjs` must run once against every
  environment holding pre-P-17 deliveries, to mint the identities that resolve, list the ones that
  do not, and validate `fk_delivery_records_delivering_employee` when nothing is left unresolved.
  The shared database held **0** delivery rows when it was read on 2026-09-10, so that run is
  expected to mint nothing there — an operator step all the same. This slice performs neither and
  makes no claim that either has been run.

## 11. Record-integrity note (for the Owner)

`tests/ci/p1-27-doc-counts.test.ts:784` requires `docs/phase-1/phase-1-27/closure-record.md` to
quote the schema hash and migration count that the CURRENT committed baseline carries, so adding the
two migrations of this slice obliged it to rewrite a row of a record sealed on 2026-08-12 — **139**
and `8302f675…` became **141** and `a25718d7…` — which is a repository convention that makes a
historical record track the live baseline rather than the state it recorded, and one the Owner may
wish to change.
