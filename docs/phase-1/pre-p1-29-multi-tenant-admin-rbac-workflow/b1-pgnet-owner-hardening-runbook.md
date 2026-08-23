# B1-PGNET-BLOCKER — owner-level hardening runbook

**Status: OPEN.** This is the sole blocker standing between PRE-P1-29 Wave B
slice B1 and its final GO.

Every statement below is derived from the measured live object inventory of the
local Supabase stack. Nothing here is guessed, and nothing here can be executed
by a RootLco repository migration — that is the finding, not a limitation of the
runbook.

---

## 1. What the exposure is

`pg_net` installs a schema, `net`, whose objects are owned by `supabase_admin`
and whose privileges are granted to **PUBLIC**. Every role in the database
inherits them, `app_platform` included.

Concretely, a role can INSERT a `(method, url, headers, body, timeout)` row into
`net.http_request_queue` — an unlogged table with row-level security **disabled**
and no policies — and the running, superuser-owned `pg_net worker` background
process then issues that exact request from the database container's network
position. The status, response headers and full body are written to
`net._http_response`, which the same role can read, rewrite or delete.

Describing this as "outbound HTTP" undersells two halves of it: the role can also
read *other* principals' queued requests, including their `Authorization`
headers, and their collected response bodies.

### The measured surface

| object | kind | RLS | PUBLIC holds |
| --- | --- | --- | --- |
| `net.http_request_queue` | table (unlogged) | disabled | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN |
| `net._http_response` | table (unlogged) | disabled | the same eight |
| `net.http_request_queue_id_seq` | sequence | n/a | USAGE, SELECT, UPDATE |
| schema `net` | schema | n/a | USAGE |

Ten of the twelve functions in `net` have `proacl IS NULL`, which means the
PostgreSQL default for a function: **EXECUTE to PUBLIC**. Among them is
`net.http_delete(text, jsonb, jsonb, integer, jsonb)`, which is
`SECURITY INVOKER` — a second, simpler outbound path that needs no queue row at
all.

Supabase has already applied the correct pattern to exactly two functions:
`net.http_get` and `net.http_post` are `SECURITY DEFINER`, carry an explicit ACL
that excludes PUBLIC, and are re-hardened by the `issue_pg_net_access` event
trigger on every `CREATE EXTENSION`. That proves the pattern is mechanically
available. It also shows the platform owner did not extend it to the queue table,
the sequence, `http_delete` or `worker_restart`: **the sanctioned wrappers are
locked and the raw path is not.**

---

## 2. Why B1 cannot fix it

Three independent blockers. Any one of them is sufficient.

**Ownership.** Every `net` object is owned by `supabase_admin`, which is also the
recorded grantor of every PUBLIC entry. The migration role is `postgres`, which
is **not** a superuser, **not** a member of `supabase_admin`, and holds **no**
privilege `WITH GRANT OPTION` on any `net` object. A `REVOKE` it issues matches
no grant it is entitled to remove, so PostgreSQL responds:

```
WARNING:  no privileges could be revoked for "http_request_queue"
```

…and **commits successfully**. That is the decisive fact. A migration containing
that statement would produce a green replay, a green gate and a green evidence
artefact while changing nothing at all. It is strictly worse than no migration,
because it manufactures assurance. §2 of the governing directive forbids it and
this runbook does not contain one.

**Unprovable in CI.** The repository's CI database is a bare
`postgres:17-alpine` container with no `pg_net` and no `net` schema. A guarded
migration is a no-op in the only environment the gates run in; an unguarded one
hard-fails every database job. No repository gate can ever demonstrate that this
remediation landed.

**PostgreSQL semantics.** There is no per-role revoke of a PUBLIC grant. The
`aclitem` model is additive and has no deny representation, so
`REVOKE ... FROM app_platform` deletes an entry whose grantee is `app_platform`
— and none exists, because the authority arrives via PUBLIC. Narrowing is
all-or-nothing, at PUBLIC.

### What this is not

`app_runtime`, `app_worker` and `app_readonly` have carried identical authority
since `pg_net` first appeared in the image. B1 did not create this exposure and
did not widen it; B1 introduced a role that inherits it, and in doing so made it
visible.

That distinction matters for triage and changes nothing about the verdict:

> **PRE-EXISTING EXPOSURE ≠ ACCEPTABLE B1 AUTHORITY.**

The B1 authority model claims `app_platform` is a control plane with no reach
outside its sanctioned surface. While these grants stand, that claim is false.

---

## 3. PRECHECK — prove the executor can actually make the change

Run this **before** any `REVOKE`. It answers one question: does the connected
role have the authority to change these ACLs at all? If it does not, stop —
issuing the statements anyway produces the silent no-op described above.

```sql
SELECT current_user,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
       pg_has_role(current_user, 'supabase_admin', 'MEMBER')        AS member_of_owner;

-- Owners of everything the remediation touches. Every row must be an object the
-- executor owns or can act for.
SELECT n.nspname AS schema,
       c.relname AS object,
       c.relkind,
       pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'net'
 UNION ALL
SELECT n.nspname, p.proname, 'f', pg_get_userbyid(p.proowner)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'net'
 UNION ALL
SELECT nspname, '(schema)', 'n', pg_get_userbyid(nspowner)
  FROM pg_namespace WHERE nspname = 'net'
 ORDER BY 1, 2;
```

**STOP CONDITION.** If `is_superuser` is false and `member_of_owner` is false,
the executor cannot perform this remediation. Do not proceed to section 5. Go to
section 8.

---

## 4. Pre-remediation fingerprint

Capture this **before** the change. Section 7 compares against it, and a
remediation whose fingerprint does not move has failed regardless of what the
transaction reported.

```sql
SELECT c.relname AS object, a.privilege_type
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
       aclexplode(c.relacl) a
 WHERE n.nspname = 'net' AND a.grantee = 0          -- 0 is PUBLIC
UNION ALL
SELECT p.proname, a.privilege_type
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
       aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 WHERE n.nspname = 'net' AND a.grantee = 0
UNION ALL
SELECT '(schema net)', a.privilege_type
  FROM pg_namespace n, aclexplode(n.nspacl) a
 WHERE n.nspname = 'net' AND a.grantee = 0
 ORDER BY 1, 2;
```

### And the effective privileges, captured the same way section 7 will

The ACL fingerprint above records what the catalogue says. This records what the
roles can actually **do** — and it must be taken now, with the identical query
section 7 uses, or the post-remediation comparison is not a comparison.

```sql
SELECT r.rolname,
       has_schema_privilege(r.rolname, 'net', 'USAGE')                          AS schema_usage,
       has_table_privilege(r.rolname, 'net.http_request_queue', 'INSERT')       AS queue_insert,
       has_table_privilege(r.rolname, 'net._http_response', 'SELECT')           AS response_read,
       has_table_privilege(r.rolname, 'net._http_response', 'TRIGGER')          AS response_trigger,
       has_sequence_privilege(r.rolname, 'net.http_request_queue_id_seq', 'USAGE') AS seq_usage,
       has_function_privilege(r.rolname,
         'net.http_delete(text, jsonb, jsonb, integer, jsonb)', 'EXECUTE')      AS http_delete,
       has_function_privilege(r.rolname, 'net.http_get(text, jsonb, jsonb, integer)', 'EXECUTE') AS http_get
  FROM pg_roles r
 WHERE r.rolname IN ('app_platform', 'app_runtime', 'app_worker', 'app_readonly')
 ORDER BY 1;
```

At the time of writing every column except `http_get` returns **true for all
four roles**, and every one of those privileges arrives through PUBLIC — not one
`app_*` role appears as a grantee anywhere in `net`. `response_trigger` is
included because it is the ingredient of the escalation in section 8a, not
because anything legitimate wants it.

---

## 5. REMEDIATION — the minimal ACL delta

Derived from the measured inventory, not from a template. Executable **only** by
a role that passed section 3.

```sql
REVOKE ALL ON net.http_request_queue                  FROM PUBLIC;
REVOKE ALL ON net._http_response                      FROM PUBLIC;
REVOKE ALL ON SEQUENCE net.http_request_queue_id_seq  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  net.http_delete(text, jsonb, jsonb, integer, jsonb) FROM PUBLIC;
REVOKE USAGE ON SCHEMA net                            FROM PUBLIC;
```

### Target invariant

- `app_platform` holds **no** `pg_net` network authority. No sanctioned
  control-plane operation requires outbound HTTP; if one ever does, it gets an
  explicit grant with its own justification, not an inherited one.
- `app_readonly` holds none. It is documented SELECT-only and currently holds
  INSERT, UPDATE, DELETE and TRUNCATE on both `net` tables.
- `app_runtime` and `app_worker` hold only what a demonstrated consumer needs.
  **The repository currently has zero `pg_net` call sites** — verified below —
  so today that is nothing. Re-verify before executing.

### Measured blast radius

`net.http_get` and `net.http_post` already exclude PUBLIC and run
`SECURITY DEFINER` as `supabase_admin`, so they queue as the one role holding an
explicit grant and are unaffected. `supabase_functions.http_request` — the
Database Webhooks trigger function — calls only those two;
`supabase_functions.hooks` holds zero rows and no trigger is wired to it. There
is no `supabase/functions` directory, so `[edge_runtime]` has nothing to run, and
both `config.toml` auth hooks are commented out (and are `pg-functions://`
hooks, which do not use `pg_net` regardless).

Real losses: `net.http_delete`, `net.http_collect_response`,
`net._http_collect_response`, and direct queue/response access, for every role
except `supabase_admin`. **This repository has zero call sites for any of them.**

### Re-verify before executing

```bash
grep -rn "pg_net\|net\.http_\|http_request_queue\|_http_response" \
  supabase/ apps/ src/ scripts/ .github/ --include="*.sql" --include="*.ts" \
  --include="*.mjs" --include="*.toml" --include="*.yml"
```

At the time of writing this returns only prose: the classification note in
`scripts/ci/rls-matrix.mjs`, the environment-extension list in
`tests/db/foundation.test.ts`, and two references in this slice's own documents
and tests. No call sites.

### Rejected: the trigger workaround

PUBLIC holds `TRIGGER` on both tables, so `postgres` genuinely could attach
`BEFORE INSERT/UPDATE/DELETE` guards without owning them. Rejected on three
grounds. It cannot guard `SELECT`, so the confidentiality half — reading other
principals' response bodies and `Authorization` headers — survives untouched. It
must be wrapped in an extension-exists guard to survive CI, making it dead code
in the only gated environment. And it grafts enforcement onto a vendor table
whose ACLs a vendor event trigger rewrites on `CREATE EXTENSION`. Partial
containment that a matrix would score as containment is worse than a recorded
open dependency.

---

## 6. Durability across replay and upgrade

`pg_net` is created by the Supabase container image **before** any migration
runs — provable by OID ordering: the image extensions occupy 16395–16664, below
every extension the repository's own first migration creates (17873 and up). It
appears in no repository migration and in no `config.toml` entry.

The re-grant vector is the `issue_pg_net_access` event trigger, which fires on
`ddl_command_end` for `CREATE EXTENSION` and re-applies the schema `USAGE` grant
and the `http_get`/`http_post` hardening. It touches neither table, neither the
sequence, nor `http_delete` — those PUBLIC grants come from the extension's own
install script and **would be re-issued by any `CREATE EXTENSION` or extension
upgrade**.

**Therefore the remediation must be re-applied after every extension create or
upgrade, and the postcheck in section 7 must be part of that routine** rather
than a one-time action.

---

## 7. POSTCHECK — effective authority, not ACL text

ACL text is necessary and not sufficient. Test what the roles can actually do.

```sql
SELECT r.rolname,
       has_schema_privilege(r.rolname, 'net', 'USAGE')                          AS schema_usage,
       has_table_privilege(r.rolname, 'net.http_request_queue', 'INSERT')       AS queue_insert,
       has_table_privilege(r.rolname, 'net._http_response', 'SELECT')           AS response_read,
       has_sequence_privilege(r.rolname, 'net.http_request_queue_id_seq', 'USAGE') AS seq_usage,
       has_function_privilege(r.rolname,
         'net.http_delete(text, jsonb, jsonb, integer, jsonb)', 'EXECUTE')      AS http_delete,
       has_function_privilege(r.rolname, 'net.http_get(text, jsonb, jsonb, integer)', 'EXECUTE') AS http_get
  FROM pg_roles r
 WHERE r.rolname IN ('app_platform', 'app_runtime', 'app_worker', 'app_readonly')
 ORDER BY 1;
```

**Required after remediation:** every column false for `app_platform` and
`app_readonly`; `http_get` already false for all four today and must stay so.

Then re-run the section 4 fingerprint.

### Acceptance

| condition | verdict |
| --- | --- |
| fingerprint PRE ≠ POST, and every expected privilege absent | **REMEDIATION SUCCEEDED** |
| fingerprint unchanged | **REMEDIATION FAILED** |
| any statement emitted `WARNING: no privileges could be revoked` | **REMEDIATION FAILED** |

A committed transaction is not evidence. The fingerprint delta is.

---

## 8. If no customer-accessible owner route exists

On a hosted Supabase project, `supabase_admin` is not a role the customer can
assume. If section 3's stop condition is reached in the target environment, the
remediation cannot be performed by RootLco and must be escalated.

### Escalation package

**Affected objects.** `pg_net` 0.20.3, schema `net`, owner `supabase_admin`:
tables `http_request_queue` and `_http_response`, sequence
`http_request_queue_id_seq`, function
`http_delete(text, jsonb, jsonb, integer, jsonb)`, and schema `USAGE`.

**Current ACL.** Both tables: `{supabase_admin=arwdDxtm/supabase_admin,
=arwdDxtm/supabase_admin}` — the second entry is PUBLIC with all eight
privileges. Sequence: `{supabase_admin=rwU/supabase_admin, =rwU/supabase_admin}`.
Schema: `nspacl` contains a bare `=U/supabase_admin` entry. `http_delete` has
`proacl IS NULL`, i.e. the default EXECUTE to PUBLIC. Both tables have
`relrowsecurity = false` and zero policies.

**Effective exposure.** Any role in the database can cause the in-server client
to issue an arbitrary GET, POST or DELETE from the database container's network
position, and can read, alter or delete every other principal's queued requests
and collected responses — including request headers and full response bodies.

**Why a normal migration cannot revoke it.** The migration role `postgres` is
not a superuser, not a member of `supabase_admin`, and holds no grant option on
any `net` object. Its `REVOKE` emits `WARNING: no privileges could be revoked`
and commits, producing a green migration with zero effect. PostgreSQL also
permits no per-role revoke of a PUBLIC grant, so the change cannot be scoped to
one role.

**Desired end state.** The five statements in section 5. Note that Supabase has
already applied exactly this pattern to `http_get` and `http_post`; the request is
to extend it to the raw queue path.

**Consumer evidence.** Zero `pg_net` call sites in the RootLco repository. Zero
database webhooks configured (`supabase_functions.hooks` empty). No Edge
Functions directory. No RootLco function or trigger references the `net` schema.

**Verification requested after the change.** The section 7 query, returning
false in every column for `app_platform` and `app_readonly`.

No credentials, secrets or provider-control bypass appear in this package, and
none should be added to it.

### Alternative if the provider declines

Containment then has to move outside PostgreSQL: a network-egress control on the
database container, so that the request the worker issues cannot leave. That is
an infrastructure change, not a grant change, and it is outside slice B1's
boundary. It must be recorded against the same blocker rather than closing it.

---

## 8a. Demonstrated escalation — why this blocker is HIGH, not "can make web requests"

The final refuter surfaced, and direct execution against the candidate confirmed,
that the inherited pg_net authority is a path to **arbitrary superuser code
execution**, not merely outbound HTTP.

The chain, every step verified as `app_platform` (via its login member) on the
local stack:

1. `net._http_response` is written by the `pg_net` background worker, which runs
   as `supabase_admin` (a superuser) — confirmed in `pg_stat_activity`.
2. PUBLIC holds `TRIGGER` on `net._http_response` — so `app_platform` may attach
   a trigger to it. **Confirmed:** `CREATE TRIGGER … ON net._http_response`
   succeeded.
3. PUBLIC holds `TEMPORARY` on the database, and `app_platform` holds CREATE on
   no ordinary schema — so `pg_temp` is the one place it can define the trigger
   function. **Confirmed:** `CREATE FUNCTION pg_temp.…` succeeded;
   `CREATE FUNCTION public.…` was refused `42501`.
4. A `BEFORE INSERT` trigger fires in the inserting session's context. The
   inserting session is the superuser worker. So the trigger body — chosen by
   `app_platform` — executes with superuser rights the next time a queued
   request completes, and `app_platform` can queue one (it holds INSERT on
   `net.http_request_queue`). From superuser context, every tenant's data and
   `iam.platform_grants` itself are reachable.

This is the concrete reason the blocker is severe. It is closed at the root by
the **section 5 remediation**: `REVOKE ALL ON net._http_response FROM PUBLIC`
removes the `TRIGGER` grant (step 2) along with the read/write surface, and the
`REVOKE USAGE ON SCHEMA net` removes reach entirely. No separate action is needed
once section 5 is performed by an authorised role.

### The repo-controllable co-factor, and why it is not shipped

Step 3's `TEMPORARY` grant is, unlike the pg_net grants, revocable by the
database owner `postgres` — which is the migration role. `REVOKE TEMPORARY ON
DATABASE postgres FROM PUBLIC` would break the chain by removing the only place
`app_platform` can host the function.

It is **not shipped as a repository migration**, for reasons that are the whole
point of this blocker rather than an evasion of it:

- It is broad. PUBLIC is the only `TEMPORARY` grantee for **17 of 19 roles**,
  including `anon`, `authenticated` and `service_role` — the PostgREST request
  roles — and the Supabase auth, storage and realtime service roles. Revoking
  from PUBLIC strips all of them.
- Its blast radius cannot be validated here. The local DB tier exercises none of
  the PostgREST/auth/storage paths those roles serve, so a green local run would
  be false assurance — the same failure mode as an ineffective REVOKE, in the
  opposite direction.
- It defends a co-factor, not the anomaly. Removing `TEMPORARY` from every
  Supabase role to contain an inherited `pg_net` `TRIGGER` grant is treating the
  symptom; the section 5 remediation removes the anomaly itself.

Revoking database-wide `TEMPORARY` from PUBLIC is a recognised hardening step
(CIS PostgreSQL benchmark), and may be worth doing on its own merits — but as a
deliberate platform-posture decision with the blast radius above understood, not
as a silent rider on slice B1. It is recorded here for that decision, not
executed by it.

---

## 8b. Provider engagement record

Filled in as the escalation progresses. Empty fields mean not yet done, not
assumed. Nothing in this section may be inferred from an ambiguous reply — if the
provider's answer does not plainly say which category it falls into, it is
category **E** until clarified.

| field | value |
| --- | --- |
| Support ticket / case identifier | *(not yet raised)* |
| Date raised | |
| Provider response category | *(A / B / C / D / E — see below)* |
| Provider response summary | |
| Approved remediation procedure | |
| Executing principal | |
| Execution timestamp | |
| PRE fingerprint captured | |
| POST fingerprint captured | |
| PRE ≠ POST | |
| Effective-authority verification (section 7) | |
| Verdict | |

**Response categories**, decided before reading the reply so the reply cannot
choose its own:

| | meaning | consequence |
| --- | --- | --- |
| **A** | Provider will apply the ACL hardening | wait, then run sections 4 → 7 |
| **B** | Provider supplies a supported customer execution context | run section 3 first in that context; proceed only if it passes |
| **C** | Provider confirms another supported platform configuration achieving the invariant | verify by section 7 regardless of the mechanism |
| **D** | Provider states the PUBLIC ACL cannot be changed | blocker stays open; containment must move outside PostgreSQL (network egress), which is an infrastructure decision outside slice B1 |
| **E** | The response does not address the security requirement | re-escalate; do not close, do not downgrade |

Categories D and E do **not** close `B1-PGNET-BLOCKER`. Neither does a category A
or B whose postcheck fails any condition in section 7 — a committed transaction
is not evidence, the fingerprint delta is.

---

## 9. Monitoring while the blocker is open

The exposure is pinned as an executable fact in
`tests/db/pre-p1-29-b1-platform-privilege-closure.test.ts`, in the case
`RECORDED EXPOSURE: what app_platform inherits from pg_net, and cannot be given
up`. It does not assert containment. It asserts the measured surface, so that a
Supabase image bump changing the ACL in **either** direction fails the suite and
says so. The two hardened wrappers are pinned separately: `http_get` and
`http_post` must remain `SECURITY DEFINER` with no PUBLIC entry, and must remain
unreachable by `app_platform`.

When the remediation is performed, that test is the thing to update — from
"pinned exposure" to "pinned absence" — and its change is the evidence that the
blocker closed.
