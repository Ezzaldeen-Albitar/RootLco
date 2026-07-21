# DBCR-P1-13-001 — Backend runtime write grants for the foundation primitives

**Status:** OPEN — raised by Phase 1-13, **not implemented** ·
**Raised:** 2026-07-21 · **Phase:** P1-13 (Backend Architecture and Shared Application Foundation) ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical owner; recorded under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Affects:** Release 2 database baseline `release-2-database-baseline`
(`ecbbfe8a419b8cd4794f66ba24d0a2341d015601`), schema hash `d3b1e7e4…`.

> **P1-13 changes no migration.** The Release 2 schema is frozen and applied migrations are
> immutable (enforced by the `Assert applied migrations are immutable` CI step). This document
> records the defect with executed evidence and the exact proposed remediation. Implementation
> belongs to the phase authorized to change the database, after this request is approved.

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

## 4. Proposed remediation (additive, forward-only — NOT applied here)

A single additive migration, owned by the phase authorized to change the database:

```sql
-- 1. Audit append: the runtime path must be able to write its own evidence.
--    Every element below was established by EXECUTION (§2.5), not by reading the
--    migration: the first two rehearsal attempts failed on the helper functions
--    and on schema USAGE.
GRANT EXECUTE ON FUNCTION iam.audit_append(
  uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb
) TO app_runtime;
-- audit_append is SECURITY INVOKER, so its helpers run as the caller.
GRANT EXECUTE ON FUNCTION iam.audit_mask(text, text)      TO app_runtime;
GRANT EXECUTE ON FUNCTION iam.audit_canonical(uuid)       TO app_runtime;
GRANT EXECUTE ON FUNCTION iam.audit_hash(bytea, text)     TO app_runtime;
-- iam.audit_hash calls extensions.digest.
GRANT USAGE ON SCHEMA extensions TO app_runtime;

GRANT INSERT ON iam.audit_records, iam.audit_record_details, iam.audit_integrity_links
  TO app_runtime;
CREATE POLICY ins_audit_records_tenant ON iam.audit_records
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
-- (+ the matching INSERT policies on the two child tables)

-- The writer must also READ its own tenant's chain (next seq, canonical form,
-- previous hash). The shipped sel_audit_*_permitted policies additionally require
-- iam.has_permission('iam.audit.view'), so a writer without the audit-VIEW
-- permission cannot append. Separate, writer-scoped SELECT policies are required.
CREATE POLICY sel_audit_records_writer ON iam.audit_records
  FOR SELECT TO app_runtime USING (tenant_id = iam.current_tenant_id());
-- (+ the matching SELECT policies on iam.audit_record_details and
--    iam.audit_integrity_links)

-- 2. Transactional outbox: tenant-scoped INSERT for the producer.
GRANT INSERT, SELECT ON shared.event_outbox TO app_runtime;
CREATE POLICY ins_event_outbox_tenant ON shared.event_outbox
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY sel_event_outbox_tenant ON shared.event_outbox
  FOR SELECT TO app_runtime USING (tenant_id = iam.current_tenant_id());

-- 3. Idempotency keys: tenant-scoped SELECT + INSERT. No UPDATE, no DELETE —
--    a stored response is immutable, and expiry is an administrative sweep.
GRANT SELECT, INSERT ON shared.idempotency_keys TO app_runtime;
CREATE POLICY sel_idempotency_keys_tenant ON shared.idempotency_keys
  FOR SELECT TO app_runtime USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_idempotency_keys_tenant ON shared.idempotency_keys
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());

-- 4. Security events: INSERT only. The runtime may record a denial; it may never
--    amend or remove one.
GRANT INSERT ON iam.security_events TO app_runtime;
CREATE POLICY ins_security_events_tenant ON iam.security_events
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
```

**Deliberately excluded from the proposal:** no `UPDATE` and no `DELETE` on any of these tables.
Append-only is the security property; granting more would weaken it.

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

- **Risk of applying:** Low. Additive `GRANT` + tenant-scoped `WITH CHECK` policies. No table,
  column, constraint, or function is altered; the canonical schema hash changes only by the
  addition of the new policies, which the P1-12 upgrade-matrix tooling will re-baseline.
- **Tenant-isolation risk:** none introduced — every proposed policy is `tenant_id =
iam.current_tenant_id()`, narrower than the existing `app_worker` `USING (true)` policies.
- **Test evidence required before approval:** the P1-13 backend suite already exercises the full
  transactional path (all-or-nothing commit, idempotent replay, outbox publication, consumer
  idempotency) against a **test-only rehearsal role** carrying exactly this privilege set, so the
  application behaviour is proven before the grant is real.
- **Rollback:** `REVOKE` the grants and `DROP POLICY` the four policies. No data migration, no
  destructive step. Any rows written under the grants remain valid and readable.

## 7. Decision record

| Field              | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Requested by       | Phase 1-13 implementation                                                  |
| Approval owner     | RootLco founders (Product Owner), with technical sign-off by the Architect |
| Status             | **OPEN — awaiting approval; deliberately not implemented in P1-13**        |
| Implementing phase | To be assigned. P1-13 must not add or modify a migration.                  |
