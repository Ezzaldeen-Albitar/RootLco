# Notification enqueue authority — execution record

**A narrow write path for a caller that has no tenant context.** One migration, one
function, fifteen security proofs, and no privilege widened anywhere else.

|                             |                                                            |
| --------------------------- | ---------------------------------------------------------- |
| Branch                      | `remediation/p1-29-backend-notification-enqueue-authority` |
| Base                        | `c9c516f1` — `origin/develop` at the truthfulness merge    |
| Ownership profile           | `p1-29-backend` — resolved before the branch was created   |
| New migrations              | **1** — `20260827090000_shared_notification_enqueue_authority.sql` |
| New permission codes        | **0**                                                      |
| New operations              | **0**                                                      |
| Table grants changed        | **0**                                                      |
| Policies changed            | **0**                                                      |

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

| instrument                                     | why it missed the grant                                        |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `information_schema.role_table_grants`         | reports TABLE-level grants only; this one is COLUMN-level      |
| `grep 'GRANT.*outbound_messages'`              | the statement's target is on line **143**, three lines below   |

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

## 3. Why a function, after trying the established model first

Grant + RLS is this repository's model, proven by `event_outbox`,
`processed_events` and `error_records`. It cannot express this constraint for this
caller:

| attempt                                          | outcome                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| permissive `INSERT` policy for `app_worker`      | ORs with `wkr_outbound_messages_dispatch` (`FOR ALL … USING true WITH CHECK true`) — constrains nothing |
| `AS RESTRICTIVE` policy                          | ANDs correctly, can pin `status = 'pending'` — and then stops                            |
| …checking the tenant inside that policy          | impossible: the only tenant fact available is `iam.current_tenant_id()`, which the worker does not have |

A policy cannot ask whether a claimed tenant **owns** a claimed recipient, because
answering needs `tech`, which the worker may not read and must not be granted.

A `SECURITY DEFINER` function can, and that single check is its entire reason to
exist — seeing what the caller may not, which is the only defensible use of one.

### 3.1 This is the first application-owned definer function here

All six `SECURITY DEFINER` functions in the database belong to Supabase
infrastructure (`net`, `pgbouncer`, `vault`, `supabase_functions`); the clean-room
RLS evidence reports `securityDefinerFunctions: 0` for the application schemas.

Stated plainly rather than glossed, because a precedent gets cited later as though
it had always been the pattern. It follows every convention the repository already
has for functions: pinned `search_path`, `REVOKE EXECUTE … FROM PUBLIC`, and a
single grantee — the shape `shared.claim_outbox_events` already uses for this same
role.

## 4. What it deliberately does not do

**It does not replace the request path.** `app_runtime` keeps its direct INSERT and
its policy and gains nothing here. Routing both callers through one definer
function would have **bypassed `ins_outbound_messages_enqueue`** for the request
path, discarding all four of its checks — a security regression wearing the costume
of a simplification. A test asserts `app_runtime` still meets RLS rather than
`permission denied`, so that regression cannot land quietly.

**It does not own idempotency.** `ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`
is the clause the runtime repository already uses, so a replayed event
deduplicates where the platform already deduplicates.

**It does not widen the worker anywhere else.** `app_worker` gains `EXECUTE` on one
function: no `wo` USAGE, no `tech` USAGE, no table INSERT, no policy change.

## 5. Proofs — fifteen, every one as a restricted role

A security proof taken as `postgres` proves nothing about the role the worker
connects as.

| proof                                                          | result                                   |
| -------------------------------------------------------------- | ---------------------------------------- |
| worker enqueues for a live technician of the named tenant      | succeeds, `status = 'pending'`           |
| a replayed dedupe key returns the SAME message, one row        | ✅                                        |
| recipient is a technician of ANOTHER tenant                    | refused                                  |
| recipient is no technician at all                              | refused                                  |
| null tenant, recipient or author                               | refused                                  |
| `EXECUTE` for `public` / `app_runtime` / `app_readonly`        | **false**                                |
| `EXECUTE` for `app_worker`                                     | true                                     |
| worker direct `INSERT` / `DELETE` on the table                 | `permission denied`                      |
| worker reading `tech` — the schema the function reads FOR it   | `permission denied for schema tech`      |
| request path untouched: `app_runtime` still meets RLS          | ✅                                        |
| `search_path` pinned and excluding `public`                    | ✅                                        |
| no dynamic SQL in the body                                     | ✅                                        |

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

| option                                        | cost                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| grant the worker template reads               | needs an RLS policy, and with no tenant context it must be `USING true` — a cross-tenant read of tenant-authored content |
| publisher resolves at publish time            | adds no privilege anywhere, but changes what `job.assigned` carries — a published contract |

The second matches the standing payload-carries-the-facts decision and costs no
privilege. It is left open here rather than chosen, because a published event
schema is not an implementation detail, and because `BR-09`'s contract already
declares "no migration, no policy, no grant" while needing all three — which is
how it came to be blocked in the first place.
