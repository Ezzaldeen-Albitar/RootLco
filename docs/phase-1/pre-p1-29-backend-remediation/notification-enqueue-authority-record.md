# Notification enqueue authority — execution record

**A narrow write path for a caller that has no tenant context.** One migration, one
function, fifteen security proofs, and no privilege widened anywhere else.

|                      |                                                                    |
| -------------------- | ------------------------------------------------------------------ |
| Branch               | `remediation/p1-29-backend-notification-enqueue-authority`         |
| Base                 | `c9c516f1` — `origin/develop` at the truthfulness merge            |
| Ownership profile    | `p1-29-backend` — resolved before the branch was created           |
| New migrations       | **1** — `20260827090000_shared_notification_enqueue_authority.sql` |
| New permission codes | **0**                                                              |
| New operations       | **0**                                                              |
| Table grants changed | **0**                                                              |
| Policies changed     | **0**                                                              |

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
this schema's security model may never do.

The failure was found by hosted CI, not locally, because the database security
gates were never run before pushing a migration — `verify:policies` does not
cover them. That is a process defect, and it is recorded rather than tidied away.

### 3.1 What replaces the check the function was going to make

The function existed to answer one question the worker cannot: does the claimed
tenant OWN the claimed recipient? Under the Owner's payload-carries-the-facts
decision that question is answered EARLIER, by a role that already holds the
authority to answer it.

The `job.assigned` publisher runs as `app_runtime`, inside the tenant's own
context, and resolves the recipient from `tech.technician_profiles` at publish
time. The outbox row is therefore authored by a tenant-scoped role under its own
RLS. The worker does not ASSERT a tenant; it forwards one already verified by the
only party that could verify it.

That is a deliberate trade and it is stated plainly: the database cannot verify a
payload's lineage, so the control lives at publish time. The alternative was to
grant the worker `tech` reads so a policy could re-derive a fact the publisher
already knew — widening exactly the privilege the decision forbids.

### 3.2 Why the policy is RESTRICTIVE

`wkr_outbound_messages_dispatch` is `FOR ALL … USING true WITH CHECK true`, and
the worker's SELECT depends on it, so it is left untouched. A PERMISSIVE INSERT
policy would OR with it and constrain nothing; a RESTRICTIVE one ANDs, narrowing
the worker's INSERT without altering shipped behaviour for any other statement
or role.

## 5. Proofs — ten, every one as a restricted role

A security proof taken as `postgres` proves nothing about the role the worker
connects as.

| proof                                                        | result                              |
| ------------------------------------------------------------ | ----------------------------------- |
| worker enqueues for a live technician of the named tenant    | succeeds, `status = 'pending'`      |
| a replayed dedupe key returns the SAME message, one row      | ✅                                  |
| recipient is a technician of ANOTHER tenant                  | refused                             |
| recipient is no technician at all                            | refused                             |
| null tenant, recipient or author                             | refused                             |
| `EXECUTE` for `public` / `app_runtime` / `app_readonly`      | **false**                           |
| `EXECUTE` for `app_worker`                                   | true                                |
| worker direct `INSERT` / `DELETE` on the table               | `permission denied`                 |
| worker reading `tech` — the schema the function reads FOR it | `permission denied for schema tech` |
| request path untouched: `app_runtime` still meets RLS        | ✅                                  |
| `search_path` pinned and excluding `public`                  | ✅                                  |
| no dynamic SQL in the body                                   | ✅                                  |

### 5.1 The last proof failed first, by matching its own comment

`expect(src).not.toMatch(/\bEXECUTE\b/i)` failed against a body whose comment
reads _"No dynamic SQL, no `EXECUTE`"_. Prose describing a rule contains the rule
— **the same defect `check-p1-29-access.mjs` was corrected for days earlier**,
reproduced here in a test written to prevent it. Comments are stripped first now,
with a non-vacuity assertion that the stripped body is still the function.

## 6. What this does NOT close, and why it stops here

`BR-09` has **two** worker authority gaps. This slice closes one.

`app_worker` cannot read `shared.message_templates` or `shared.template_versions`
— both `false`. The notification service resolves a template, validates its
usability and renders the body **before** enqueueing, and `body_sha256` is
`NOT NULL`. So the worker cannot produce this function's arguments, and `BR-09`'s
preserved consumer — which calls `resolveTemplates(db, tenantId)` against
`shared.message_templates` — would fail there for the same reason its INSERT did.

Closing that is a **decision**, not an implementation:

| option                             | cost                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| grant the worker template reads    | needs an RLS policy, and with no tenant context it must be `USING true` — a cross-tenant read of tenant-authored content |
| publisher resolves at publish time | adds no privilege anywhere, but changes what `job.assigned` carries — a published contract                               |

The second matches the standing payload-carries-the-facts decision and costs no
privilege. It is left open here rather than chosen, because a published event
schema is not an implementation detail, and because `BR-09`'s contract already
declares "no migration, no policy, no grant" while needing all three — which is
how it came to be blocked in the first place.
