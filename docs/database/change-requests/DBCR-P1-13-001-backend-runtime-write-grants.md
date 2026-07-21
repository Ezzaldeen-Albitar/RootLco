# DBCR-P1-13-001 — Backend runtime write grants for the foundation primitives

**Status:** **RESOLVED** — merged into protected `develop` (PR #51, merge commit `e615a02`) and
verified from the merged state by executable evidence; see §9 ·
**Migration:** [`20260725090000_iam_shared_runtime_write_capabilities.sql`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql) ·
**Raised:** 2026-07-21 · **Implemented:** 2026-07-21 · **Resolved:** 2026-07-21 ·
**Phase:** P1-13 (Backend Architecture and Shared Application Foundation) ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical owner; recorded under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Affects:** Release 2 database baseline `release-2-database-baseline`
(`ecbbfe8a419b8cd4794f66ba24d0a2341d015601`), schema hash `d3b1e7e4…`.

> **History of this document.** Sections 1–3 and 5 are the record as raised, when the P1-13
> feature work could not change a migration: they describe the defect and the executed evidence
> for it, and are preserved as written. **Section 4 was replaced** — the remediation as drafted
> would have defeated the `iam.audit.view` read gate, and §4 now records what was actually
> built and why it differs. Section 8 is the implementation and verification record.

---

## 1. Summary

The backend foundation delivered in P1-13 requires four **write** capabilities against the
`shared` and `iam` schemas. The frozen baseline grants the `app_runtime` archetype
**SELECT only** across both schemas, so all four are unavailable to the request path:

| #   | Foundation capability                                           | Required object                               | Current grant to `app_runtime`                                            |
| --- | --------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Append an audit record (FR-AUD-001)                             | `iam.audit_append(...)` + `iam.audit_records` | **No EXECUTE** on the function; SELECT only on the table                  |
| 2   | Publish a domain event in the producer transaction (BR-INT-001) | `shared.event_outbox`                         | **No INSERT**; the only policy is `wkr_event_outbox_all` for `app_worker` |
| 3   | Store an idempotency key (FR-INT-002)                           | `shared.idempotency_keys`                     | **No grant to any app role, and no RLS policy at all**                    |
| 4   | Record a security-event candidate                               | `iam.security_events`                         | SELECT only                                                               |

Without them the foundation cannot emit audit records, cannot write the transactional outbox,
and cannot persist idempotency keys — three of the phase's core acceptance conditions.

## 2. Evidence (executed, not inferred)

Measured on the live Release 2 baseline (PostgreSQL 17, local Supabase stack, 113 migrations
applied, schema hash `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`).

**2.1 — `app_runtime` holds no write privilege in `shared` or `iam`:**

```sql
SELECT table_schema, privilege_type, count(*)
  FROM information_schema.role_table_grants
 WHERE grantee = 'app_runtime' AND table_schema IN ('shared','iam')
 GROUP BY 1, 2;
--  iam    | SELECT | 17
--  shared | SELECT | 25
-- (no INSERT, UPDATE or DELETE row exists)
```

**2.2 — the queue tables are granted to `app_worker` only:**

```text
shared.event_outbox      -> app_worker : INSERT,SELECT,UPDATE
shared.processed_events  -> app_worker : INSERT,SELECT
shared.error_records     -> app_worker : INSERT,SELECT,UPDATE
shared.idempotency_keys  -> (no app-role grant; postgres only)
```

**2.3 — RLS policy coverage:**

```text
shared.event_outbox      :: wkr_event_outbox_all      :: ALL :: roles=app_worker
shared.processed_events  :: wkr_processed_events_all  :: ALL :: roles=app_worker
shared.error_records     :: wkr_error_records_all     :: ALL :: roles=app_worker
shared.idempotency_keys  :: (no policy)  — RLS enabled AND forced
iam.audit_records        :: sel_audit_records_permitted :: SELECT :: roles=app_readonly,app_runtime
iam.security_events      :: sel_security_events_permitted :: SELECT :: roles=app_readonly,app_runtime
```

`shared.idempotency_keys` has `ENABLE` + `FORCE` row-level security and **no policy**, so it is
unreadable and unwritable by every non-owner role regardless of table grants.

**2.4 — no alternative path exists.** There are **0 `SECURITY DEFINER` functions** in the
database (a deliberate and verified P1-12 property), so no granted function can perform these
writes on the caller's behalf:

```sql
-- functions whose body writes shared.event_outbox, and whether app_runtime may execute them
shared.claim_outbox_events        runtime_exec=false  secdef=false
shared.complete_outbox_event      runtime_exec=false  secdef=false
shared.fail_outbox_event          runtime_exec=false  secdef=false
-- functions that call iam.audit_append
iam.audit_append                  runtime_exec=false
shared.archive_document           runtime_exec=false
```

**2.5 — `iam.audit_append` needs more than EXECUTE on itself.** This was found by _executing_ the
proposed grant set against a test-only rehearsal role, not by reading the migration — and the
first two attempts failed. `audit_append` is `SECURITY INVOKER`, so everything it touches runs
with the caller's privileges:

```text
ERROR:  permission denied for function audit_mask
        → also needs EXECUTE on iam.audit_mask(text,text), iam.audit_canonical(uuid),
          iam.audit_hash(bytea,text). All three are REVOKE …FROM PUBLIC with
          proacl = postgres=X/postgres only.

ERROR:  permission denied for schema extensions
        → iam.audit_hash calls extensions.digest; app_runtime holds no USAGE on
          schema `extensions` (nspacl lists postgres, anon, authenticated,
          service_role, dashboard_user only).

(silent empty read)
        → audit_append must SELECT its own tenant's iam.audit_records (next seq),
          iam.audit_record_details (canonical form) and iam.audit_integrity_links
          (previous chain hash). The shipped sel_audit_*_permitted policies also
          require iam.has_permission('iam.audit.view'), so a *writer* that does not
          hold the audit-view permission cannot append. Tenant-scoped SELECT
          policies for the writer are required, not only INSERT policies.
```

**2.6 — automated, repeatable evidence.** `preflightPrivileges()`
(`src/server/db/capabilities.ts`) probes all four capabilities with `has_table_privilege` /
`has_function_privilege` and is asserted in the backend test suite for both the `app_runtime`
archetype (all four missing) and a test-only rehearsal role (all four present).

## 3. Why the worker role is not the answer

`app_worker` holds the missing grants, so "run the request path as `app_worker`" would compile
and pass a smoke test. It must not be done:

- the worker policies are `USING (true)` — **deliberately all-tenant**, because a dispatcher must
  drain every tenant's queue. Giving that role to a request handler dissolves tenant isolation for
  the entire request path — the exact risk RSK-03 exists to prevent;
- an event must be written **in the producer's transaction** (BR-INT-001). The producer's
  transaction is the request transaction, held by the runtime role. A second connection as
  `app_worker` would be a _different_ transaction, reintroducing the dual-write window the outbox
  pattern exists to eliminate.

The two archetypes are correctly separated. The gap is that the runtime archetype was never
granted its own, tenant-scoped write access to these four surfaces.

## 4. Remediation as built (supersedes the original proposal)

The original §4 proposed the obvious grant set. Building it exposed two defects in that draft,
both found by execution rather than by review, and both changed the design.

### 4.1 The drafted audit SELECT policies would have defeated `iam.audit.view`

The draft added `sel_audit_records_writer … USING (tenant_id = iam.current_tenant_id())`. PostgreSQL
**ORs** permissive policies, so that policy sits beside the shipped
`sel_audit_records_permitted … AND iam.has_permission('iam.audit.view')` and wins whenever the
tenant matches. Every authenticated session of a tenant would have been able to read that tenant's
entire audit history without holding the permission — silently repealing P1-04-DB-023.

The writer genuinely does need to read, so the fix was to make the read window _close_:

- `sel_audit_records_unlinked` and `sel_audit_record_details_unlinked` expose only rows that have
  **no chain link yet**. `iam.audit_append` writes the link last, so the row under construction
  qualifies and every committed record — which always has its link — does not. The window shuts
  before the function returns, inside the same transaction (proved in
  `tests/db/p1-13-runtime-capabilities.test.ts`).
- That is only possible because the sequence number no longer comes from `iam.audit_records`.
  The original body read `max(seq)` across the tenant's whole audit history, which _required_ a
  history-wide read. §4.3 covers the change.
- `sel_audit_integrity_links_chain` remains tenant-scoped, because extending a chain means reading
  its last link. That table holds a counter, an opaque record id, and two SHA-256 digests — no
  action, actor, entity, or field value. This is the one deliberate widening, recorded in §7.

### 4.2 `GRANT USAGE ON SCHEMA extensions` was measured, and dropped

`iam.audit_hash` called `extensions.digest` (pgcrypto), which under SECURITY INVOKER forced schema
USAGE for the caller. Measuring what that opens showed it also exposes
`extensions.pg_stat_statements` and `extensions.pg_stat_statements_info` — pgcrypto grants them to
PUBLIC, and a PUBLIC grant cannot be revoked for one role.

`pg_catalog.sha256(bytea)` is core PostgreSQL, IMMUTABLE, executable by every role with no grant at
all, and byte-identical — verified on this baseline for the empty input, a short input, and a real
`prev_hash || canonical` chain input. `iam.audit_hash` now uses it, **no schema grant is made**, and
hashes written before the change still verify because the function is the one the verifier uses too.

### 4.3 What the migration actually does

| #   | Change                                                                                                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `iam.audit_hash` redefined to use `pg_catalog.sha256`                                                                                           | removes the `extensions` dependency (§4.2)                                                                                                                                                                                                                                                                                                                  |
| 2   | `iam.audit_append` redefined: next `seq` read from `iam.audit_integrity_links` instead of `iam.audit_records`                                   | lets the writer's record read be narrowed to the unlinked row (§4.1). Same signature, defaults, return, SECURITY INVOKER context, empty `search_path`, advisory lock, masking, canonical form, and one-transaction behaviour. A damaged chain now fails the append on `uq_audit_records_tenant_seq` instead of extending a chain already known to be broken |
| 3   | `GRANT EXECUTE` on `iam.audit_append`, `audit_mask`, `audit_canonical`, `audit_hash`                                                            | SECURITY INVOKER means the helpers run as the caller (§2.5)                                                                                                                                                                                                                                                                                                 |
| 4   | `GRANT INSERT` on the three audit tables + `iam.security_events`; `GRANT SELECT, INSERT` on `shared.event_outbox` and `shared.idempotency_keys` | the four capabilities, and nothing else                                                                                                                                                                                                                                                                                                                     |
| 5   | 11 policies, every one `tenant_id = iam.current_tenant_id()`                                                                                    | see the inventory below                                                                                                                                                                                                                                                                                                                                     |

Policies added — `ins_audit_records_writer`, `sel_audit_records_unlinked`,
`ins_audit_record_details_writer`, `sel_audit_record_details_unlinked`,
`ins_audit_integrity_links_writer`, `sel_audit_integrity_links_chain`,
`ins_event_outbox_producer`, `sel_event_outbox_producer`, `ins_idempotency_keys_tenant`,
`sel_idempotency_keys_tenant`, `ins_security_events_runtime`.

**Deliberately excluded:** `UPDATE`, `DELETE`, and `TRUNCATE` on every one of these tables;
every privilege for `app_readonly`; `BYPASSRLS`; ownership of anything; any new role; any
`SECURITY DEFINER` routine; `EXECUTE` on `iam.audit_verify_chain`, `org.provision_organization`,
`shared.claim_outbox_events`, `shared.complete_outbox_event`, or `shared.fail_outbox_event`; and
any access to `shared.processed_events` or `shared.error_records`. Append-only is the security
property, and producing an event stays a different power from draining the queue.

## 5. Impact if not applied

| Area                       | Consequence                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit (FR-AUD-001)         | No audit record can be written by the request path. The foundation **fails closed** — an audited operation is refused rather than executed without evidence.                                                   |
| Domain events (BR-INT-001) | No event can be published. Every later backend phase that emits events is blocked.                                                                                                                             |
| Idempotency (FR-INT-002)   | No key can be stored. Idempotency-critical commands are refused rather than executed unguarded.                                                                                                                |
| Security events            | Denials are logged and counted but not persisted to `iam.security_events`. **Requests are not failed for this** — a denial is already enforced, and losing its telemetry must not turn a clean 403 into a 500. |

Fail-closed behaviour is implemented in `src/server/db/require-capability.ts`. There is no
"skip the audit record and continue" path: a state change without its evidence is a worse
outcome than a refused command.

## 6. Risk, testing, and rollback

- **Risk of applying:** Low. `GRANT` plus tenant-scoped policies, and two `CREATE OR REPLACE
FUNCTION` statements that preserve every external property of the functions they replace. No
  table, column, constraint, index, or sequence is touched. Object counts move from 585 to 596
  policies; tables (242), functions (210), and `SECURITY DEFINER` routines (0) are unchanged.
- **Tenant-isolation risk:** none introduced. Every policy is
  `tenant_id = iam.current_tenant_id()`, far narrower than the existing `app_worker`
  `USING (true)` dispatch policies, and a session with no resolved tenant matches nothing because
  the comparison is against NULL.
- **Test evidence:** `tests/db/p1-13-runtime-capabilities.test.ts` (27 tests) proves the capability,
  the isolation, the immutability, the producer/worker separation, the audit-read boundary, and
  all-or-nothing rollback — all on `rootlco_test_runtime`, a member of `app_runtime`. The eight
  backend suites (61 tests) now run against that same deployed identity rather than a rehearsal
  role, and `tests/db/iam-audit.test.ts`, `iam-hardening.test.ts`, `shared-hardening.test.ts`,
  `org-security.test.ts`, `org-provisioning.test.ts`, and `shared-event-outbox.test.ts` assert the
  new exact surface, including everything that must remain denied.
- **Rollback:** `REVOKE` the grants, `DROP POLICY` the eleven policies, and restore the two
  function bodies from `20260718095000_iam_audit_subsystem.sql`. The exact statements are in the
  migration's closing comment. No data migration, no destructive step; rows written while the
  grants were in place stay valid, readable, and chain-verifiable.

## 7. Accepted residual exposure

`sel_audit_integrity_links_chain` lets any session of a tenant read that tenant's
`iam.audit_integrity_links` rows without holding `iam.audit.view`, where before it could read
none. This is accepted, and here is the whole of it:

- **Why it cannot be narrower.** Extending a hash chain requires the previous link. Narrowing the
  policy to "the newest link" would need `max(seq)` over the same table inside its own policy,
  which PostgreSQL rejects as infinite recursion.
- **What it exposes.** `seq` (a per-tenant counter), `audit_record_id` (an opaque UUID),
  `prev_hash` and `record_hash` (SHA-256 digests), and `tenant_id`. There is no action, actor,
  entity, or field value in the table — those live in `iam.audit_records` and
  `iam.audit_record_details`, both of which stay gated by `iam.audit.view`.
- **What it does not enable.** Cross-tenant reads (the policy is tenant-scoped, asserted), any
  write (no UPDATE/DELETE grant, asserted), and any recovery of the hashed content (SHA-256
  preimage).
- **Severity:** Low, accepted with reason rather than silently absorbed. Asserted explicitly in
  `tests/db/iam-hardening.test.ts` so a future widening of this table's columns has to confront it.

## 8. Decision record

| Field              | Value                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requested by       | Phase 1-13 implementation                                                                                                                                   |
| Approval owner     | RootLco founders (Product Owner), with technical sign-off by the Architect                                                                                  |
| Status             | **RESOLVED** — merged into protected `develop` and verified from the merged state (§9)                                                                      |
| Implementing phase | P1-13 (remediation branch `fix/p1-13-runtime-database-capabilities`)                                                                                        |
| Migration          | `supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql` (the 114th)                                                                  |
| Design deviations  | §4.1 (unlinked-read policies + chain-derived `seq`) and §4.2 (no `extensions` USAGE), both with evidence                                                    |
| Residual exposure  | §7, Low, accepted                                                                                                                                           |
| Review basis       | Owner-authorized technical self-review under the Standing Technical Authorization and Solo Developer Review policies — not an independent third-party audit |

## 9. Closure — verified from protected history (2026-07-21)

Resolved on executable evidence, not on the presence of a migration in the tree.

| Item                            | Value                                                                      |
| ------------------------------- | -------------------------------------------------------------------------- |
| Remediation pull request        | #51, merged by the repository owner                                        |
| Final remediation SHA           | `af240f06dcbd31b260d476a762ae314494bfa063`                                 |
| Merge commit                    | `e615a0212fda0b028316206bf9f331dd86120890` (parents `6c3f0de` + `af240f0`) |
| Hosted CI on the exact SHA      | 4/4 required checks green (run #122)                                       |
| Protected `origin/develop`      | `e615a0212fda0b028316206bf9f331dd86120890`                                 |
| Files changed under `supabase/` | exactly one, **added**; no earlier migration modified                      |

**Re-measured on the merged state** as `rootlco_test_runtime` (a member of `app_runtime`) with a
resolved tenant context and no `BYPASSRLS`: all four capabilities available; cross-tenant and
context-less writes still refused with `42501`; audit history still unreadable without
`iam.audit.view`; audit rows still immutable; the chain still verifying; producers still unable to
claim queue work; `app_readonly` still holding nothing. Catalogue: 114 migrations, 242 tables, 596
policies, 210 functions, 0 `SECURITY DEFINER`, 0 tables with RLS enabled but not FORCED, and exactly
six INSERTs for `app_runtime` in `shared`+`iam` with no UPDATE, DELETE, or TRUNCATE there.

Reproduced independently in a clean room — fresh clone, `npm ci`, a brand-new empty database, all
114 migrations applied by the CI runner, seeds applied twice, every suite green, zero residue
afterwards. Full record:
[`gate-validation.md`](../../phase-1/phase-1-13/evidence/gate-validation.md).

**Accepted residual, unchanged:** the tenant-scoped read of `iam.audit_integrity_links` (§7).

**One further accepted risk identified at gate review**, recorded as ADV-03 in the
[adversarial review](../../phase-1/phase-1-13/phase-1-13-adversarial-review.md): an actor able to
execute arbitrary SQL as `app_runtime` can insert an audit record outside `iam.audit_append`,
creating a permanently unlinked — and therefore readable — row, or squatting the next chain sequence
so later appends fail closed. It is inherent to `audit_append` being `SECURITY INVOKER`, since the
caller must hold the INSERT, and the project's zero-`SECURITY DEFINER` rule forecloses the
alternative. Stated rather than absorbed.
