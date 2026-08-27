# Notification enqueue authority — execution record

**A narrow write path for a caller that has no tenant context.** One migration —
one column-level grant and one RESTRICTIVE policy — ten security proofs taken as
restricted roles, and no privilege widened anywhere else.

|                      |                                                                     |
| -------------------- | ------------------------------------------------------------------- |
| Branch               | `remediation/p1-29-backend-notification-enqueue-authority`          |
| Base                 | `c9c516f1` — `origin/develop` at the truthfulness merge             |
| Ownership profile    | `p1-29-backend` — resolved before the branch was created            |
| New migrations       | **1** — `20260827090000_shared_notification_enqueue_authority.sql`  |
| New permission codes | **0**                                                               |
| New operations       | **0**                                                               |
| Table grants changed | **1** — column-level `INSERT` on `shared.outbound_messages`         |
| Policies changed     | **+1** — `wkr_outbound_messages_enqueue_scope`, RESTRICTIVE, INSERT |
| Functions added      | **0** — and `security_definer` stays **0**, which is load-bearing   |

---

## 1. The defect was not what it was recorded to be

`BR-09`'s execution record states, as a measured fact:

> **any `app%` role with INSERT on `shared.outbound_messages`** | **NONE**
> … every GRANT ever written for that table is `SELECT`

**Both halves are false**, and the way they are false is the interesting part. The
grant exists at
`20260728090000_shared_services_runtime_write_capabilities.sql:140`:

```sql
GRANT INSERT (id, tenant_id, company_id, branch_id, template_version_id, channel,
              …)
  ON shared.outbound_messages            TO app_runtime;
```

Two independent instruments reported it absent, and both failed in the same
direction:

| instrument                             | why it missed the grant                                      |
| -------------------------------------- | ------------------------------------------------------------ |
| `information_schema.role_table_grants` | reports TABLE-level grants only; this one is COLUMN-level    |
| `grep 'GRANT.*outbound_messages'`      | the statement's target is on line **143**, three lines below |

Two wrong answers that agreed made the conclusion look corroborated. The live
database settles it by **error class**: `app_runtime` attempting the enqueue is
refused with `new row violates row-level security policy`, which only a statement
that PASSED the privilege check can produce. `app_worker` gets
`permission denied for table` — a different layer entirely.

## 2. What the platform actually has, and why it is right

`app_runtime`'s enqueue is already least-privilege, and better than a new function
would have been:

- a **column-level** `INSERT` on thirteen columns that deliberately **excludes
  `status`** — the column default is `'pending'`, so no caller of that path can
  produce any other status; and
- `ins_outbound_messages_enqueue`, requiring `tenant_id = iam.current_tenant_id()`,
  `created_by = iam.current_user_id()`, `status = 'pending'` and
  `iam.has_permission_in_scope('shared.notification.send', …)`.

Nothing here needed fixing. **The gap is that this path belongs to the REQUEST
runtime**, and `BR-09`'s consumer runs on the worker, which holds no INSERT at any
granularity and — because it drains a cross-tenant queue — has no `app.tenant_id`
for the policy to key on.

## 3. Why a grant and a RESTRICTIVE policy — and why a function was WRONG

A `SECURITY DEFINER` function was written first, proved with fifteen cases, and
**refused by the repository**. Two independent gates enforce the prohibition:

```
scripts/ci/migration-replay-checks.mjs:221
  "N SECURITY DEFINER function(s) exist; the approved count is 0."

scripts/ci/rls-matrix.mjs:291
  "…is SECURITY DEFINER, which runs with the owner's rights and bypasses RLS."
```

This record previously called such a function "the first of its kind, therefore a
precedent". That was too generous to itself. It is not unprecedented — it is
**prohibited**, and the prohibition is correct: bypassing RLS is the one thing
this schema's security model may never do. Those fifteen cases proved a design
that does not ship; they are named here so the count is not mistaken for evidence
of anything now in the tree.

The failure was found by hosted CI, not locally, because the database security
gates were never run before pushing a migration — `verify:policies` does not
cover them. That is a process defect, and it is recorded rather than tidied away.

### 3.1 What replaces the check the function was going to make

The function existed to answer one question the worker cannot: does the claimed
tenant OWN the claimed recipient? Under the Owner's payload-carries-the-facts
decision that question is to be answered EARLIER, by a role that already holds
the authority to answer it — the `job.assigned` publisher, which runs as
`app_runtime` inside the tenant's own context.

**That publisher change is NOT in this slice and does not yet exist.** As shipped
today `job.assigned` carries exactly three fields — `jobId`, `assignmentId`,
`assignmentRole` — and resolves no recipient. Stating it in the present tense
would be the same class of error as §1. This migration therefore delivers the
database authority only; the fact carriage is a separate, published-schema change
tracked as the `job.assigned` schemaVersion 2 slice, and `BR-09`'s consumer
cannot be completed until that lands.

What this slice does settle is that the database layer only has to pin what a
worker may WRITE, because the lineage question is not answerable at the row layer
without granting the worker `tech` reads — widening exactly the privilege the
Owner's decision forbids.

### 3.2 Why the policy is RESTRICTIVE

`wkr_outbound_messages_dispatch` is `FOR ALL … USING true WITH CHECK true`, and
the worker's SELECT depends on it, so it is left untouched. A PERMISSIVE INSERT
policy would OR with it and constrain nothing; a RESTRICTIVE one ANDs, narrowing
the worker's INSERT without altering shipped behaviour for any other statement
or role.

### 3.3 Why `status` is outside the grant AND inside the policy

Two mechanisms pin the same fact deliberately. `status` is excluded from the
column grant, so `'pending'` — the column default — is the only status this path
can produce, and an attempt to name another is refused at the privilege layer
with `permission denied for table` before RLS is consulted. The RESTRICTIVE
policy also requires `status = 'pending'`. Either alone would hold; the grant is
the stronger of the two because it cannot be satisfied by any value at all, and
the policy states the invariant where a reader of the table's policies will find
it.

## 4. What the migration contains

No table, no function, no trigger. One `GRANT INSERT (…)` naming thirteen columns
and excluding `status`, and one `CREATE POLICY`. Classified **REVERSIBLE**:
dropping the policy and revoking the grant returns the database to its prior
state, and no data is written or transformed by it.

Structurally that is `policies` 653 → 654 with `tables`, `functions`, `triggers`
and `security_definer` all unchanged, recorded in
`.github/ci-baselines/schema-baseline.json` in this same commit. The grant moves
no structural figure at all — **neither replay script counts privileges** — which
is the same blind spot that produced the false report in §1, and the reason the
grant is proved behaviourally below rather than by a digest.

## 5. Proofs — ten, every one as a restricted role

A security proof taken as `postgres` proves nothing about the role the worker
connects as. Every case below runs on `workerAppPool` or `runtimeAppPool`.

| proof                                                           | result                              |
| --------------------------------------------------------------- | ----------------------------------- |
| worker enqueues; row lands `status = 'pending'`, correct tenant | ✅                                  |
| worker naming `status` explicitly                               | `permission denied for table`       |
| replayed dedupe key under the EXISTING conflict target          | one row, not two                    |
| worker `UPDATE` of a column outside its dispatch grant          | `permission denied`                 |
| worker `DELETE`                                                 | `permission denied`                 |
| worker reading `tech.technician_profiles`                       | `permission denied for schema tech` |
| worker reading `shared.message_templates`                       | `permission denied`                 |
| worker reading `shared.template_versions`                       | `permission denied`                 |
| request path untouched: `app_runtime` still meets **RLS**       | `row-level security policy`         |
| `SECURITY DEFINER` count across all 13 app schemas              | **0**                               |
| `wkr_…_enqueue_scope` RESTRICTIVE/INSERT; dispatch still ALL    | ✅                                  |

The two refusal messages are not interchangeable and the suite asserts each by
its own text. `permission denied for table` means the grant layer refused;
`row-level security policy` means the grant was satisfied and a policy decided.
Reading either as "it was refused, therefore it is safe" is how §1 happened.

### 5.1 The suite cleans the shared database at BOTH ends

`afterAll` calls `cleanBackendFixtures`, not only `beforeAll`. `no-fake-data`
asserts every business table is empty and runs in a LATER tier against the same
shared container, so a suite that seeds and does not clean up fails a file it
never mentions. It did exactly that once here before the `afterAll` was added.

## 6. What this does NOT close, and why it stops here

`BR-09` has **two** worker authority gaps. This slice closes one — the INSERT.

The second is that `app_worker` cannot read `shared.message_templates` or
`shared.template_versions`, and must not: `message-dispatch-repository.ts:17`
already records that the worker gets "nothing at all" on `template_versions`, and
`message-dispatcher.ts:13` records that `outbound_messages` stores no body, so
rendering happens at enqueue and the rendered content is "never persisted, never
logged". `body_sha256` is `NOT NULL` and is the integrity binding between the two.

So the worker cannot produce an enqueue's arguments from its own reads **by
design**, not by oversight — and `BR-09`'s preserved consumer, which calls
`resolveTemplates(db, tenantId)`, would fail there for the same reason its INSERT
did. The Owner has since decided that gap's resolution — payload-carries-the-facts
— and it is a **published event-schema change**, not an implementation detail of
this migration. It is executed as its own slice against `job.assigned`
schemaVersion 2, and `BR-09` resumes only once that contract is merged.
