# Phase 1-13 — Runtime database capability remediation (DBCR-P1-13-001)

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-13 · **Date:** 2026-07-21 · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Branch:** `fix/p1-13-runtime-database-capabilities` ·
**Migration:** `supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql`

Reviewed under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, not an independent third-party audit.

---

## 1. Why this exists

The P1-13 feature work (pull request #49, merged as `6c3f0de`) delivered the backend foundation
but could not make it operational. The Release 2 baseline granted the `app_runtime` archetype
SELECT only across `shared` and `iam`, so four capabilities the foundation is built on —
appending an audit record, publishing a domain event, storing an idempotency key, and recording a
security event — were unavailable to the request path. The foundation therefore failed closed, and
that was the correct temporary behaviour but not a delivered capability.

Re-measured on the merged baseline before any work began, as the deployed non-owner identity with
a resolved tenant context and no `BYPASSRLS`:

| Attempt                                        | Result                                                      |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `SELECT iam.audit_append(…)`                   | `ERROR: permission denied for function audit_append`        |
| `INSERT INTO shared.event_outbox …`            | `ERROR: permission denied for table event_outbox`           |
| `INSERT INTO shared.idempotency_keys …`        | `ERROR: permission denied for table idempotency_keys`       |
| `INSERT INTO iam.security_events …`            | `ERROR: permission denied for table security_events`        |
| `SELECT count(*) FROM shared.idempotency_keys` | `ERROR: permission denied for table idempotency_keys`       |
| `SELECT * FROM shared.claim_outbox_events(…)`  | `ERROR: permission denied for function claim_outbox_events` |

Four of the phase's own acceptance conditions could not be met, so DBCR-P1-13-001 was classified a
**gate blocker** and the P1-13 owner gate stays `Pending`. Failing closed is the right safety
behaviour; it is not a substitute for providing the service.

## 2. What was built

See DBCR-P1-13-001 §4 for the full record. In summary: eleven tenant-scoped RLS policies, six
table grants, four function grants, and two in-place function redefinitions. No table, column,
constraint, index, sequence, or role. No `SECURITY DEFINER` routine — the count across the
seventeen module schemas is still zero.

Two decisions are worth stating here because they are the difference between this remediation and
the one originally drafted.

### 2.1 Appending must not become reading

The drafted remediation gave the writer `USING (tenant_id = iam.current_tenant_id())` on the audit
tables. PostgreSQL ORs permissive policies, so that would have sat beside the shipped
`iam.audit.view` gate and won — every authenticated session of a tenant could have read that
tenant's entire audit history without the permission. A control introduced in P1-4 would have been
repealed as a side effect of a grant.

`iam.audit_append` genuinely must read: it needs the next sequence number and the previous chain
hash. The fix was to make the read window close on its own:

- the next `seq` now comes from `iam.audit_integrity_links` rather than from
  `iam.audit_records`, so appending no longer requires reading audit history at all;
- `sel_audit_records_unlinked` and `sel_audit_record_details_unlinked` expose only rows with no
  chain link. The link is written last inside `audit_append`, so the window covers exactly the row
  under construction and shuts before the function returns — inside the same transaction, which
  the test suite asserts directly.

A committed audit record is never visible through this path. Reading history still requires
`iam.audit.view`.

### 2.2 A grant that was measured and then rejected

`iam.audit_hash` called `extensions.digest`, and under `SECURITY INVOKER` that forces
`GRANT USAGE ON SCHEMA extensions` for the caller. Measuring what that opens showed it also makes
`extensions.pg_stat_statements` and `extensions.pg_stat_statements_info` readable, because the
extension grants them to PUBLIC — and a PUBLIC grant cannot be revoked for a single role.

`pg_catalog.sha256(bytea)` is core PostgreSQL, `IMMUTABLE`, executable by every role with no grant,
and byte-identical: verified on this baseline for the empty input, a short input, and a real
`prev_hash || canonical` chain input. Swapping to it removed the requirement entirely. Hashes
written before the change still verify, because `iam.audit_verify_chain` recomputes with the same
function.

## 3. Adversarial review

Twenty abuse cases, walked against the migration and — where the outcome is observable — against
an executed test. `tests/db/p1-13-runtime-capabilities.test.ts` is the primary evidence file.

| #   | Abuse case                                                             | Outcome    | Control                                                                                   |
| --- | ---------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| 1   | Write an audit record for another tenant                               | Blocked ✓  | `ins_audit_records_writer` WITH CHECK; SQLSTATE 42501                                     |
| 2   | Write an outbox envelope, key, or security event for another tenant    | Blocked ✓  | the three matching INSERT policies; 42501 each                                            |
| 3   | Perform any of the four writes with no resolved tenant                 | Blocked ✓  | predicate is NULL against NULL, so it matches nothing                                     |
| 4   | Read another tenant's keys, envelopes, chain links, or audit records   | Blocked ✓  | every SELECT policy is tenant-scoped; counts are 0 from the other tenant                  |
| 5   | Read audit history without `iam.audit.view`                            | Blocked ✓  | `sel_audit_*_unlinked` exposes only chain-link-less rows; committed records return 0      |
| 6   | Keep the read window open past the append                              | Blocked ✓  | asserted inside the appending transaction: 0 visible records after `audit_append` returns |
| 7   | Alter or delete an audit record, detail, link, or security event       | Blocked ✓  | no UPDATE, DELETE, or TRUNCATE grant on any of them                                       |
| 8   | Rewrite a chain link to mask a change                                  | Blocked ✓  | as above, plus `uq_audit_integrity_links_record` / `_tenant_seq` and the FK to the record |
| 9   | Forge an audit record directly, bypassing `audit_append`               | Detected ✓ | see §4 — `audit_verify_chain` reports `orphan_record`, and the next append fails closed   |
| 10  | Claim, complete, or fail queue work as a producer                      | Blocked ✓  | no EXECUTE on the three routines; 42501                                                   |
| 11  | Advance an envelope by UPDATE instead                                  | Blocked ✓  | no UPDATE grant on `shared.event_outbox`                                                  |
| 12  | Insert an envelope already stamped `published`                         | Blocked ✓  | `tg_event_outbox_guard_initial_state` still fires; SQLSTATE 23514                         |
| 13  | Reach `shared.processed_events` or `shared.error_records`              | Blocked ✓  | no grant; both remain worker-only                                                         |
| 14  | Use `app_worker` as a request identity                                 | Blocked ✓  | it holds no business-table access, and no EXECUTE on `audit_append`                       |
| 15  | Gain anything as `app_readonly`                                        | Blocked ✓  | the migration grants it nothing; all four capabilities report missing                     |
| 16  | Probe another tenant's idempotency keys through the unique constraint  | Blocked ✓  | `uq_idempotency_keys_scope` is keyed on `tenant_id`; the same key succeeds for tenant B   |
| 17  | Write or read a platform-scope (`tenant_id IS NULL`) key or event      | Blocked ✓  | the predicate is NULL for those rows; 42501 on write, 0 on read                           |
| 18  | Rewrite or remove a stored idempotent response                         | Blocked ✓  | SELECT and INSERT only                                                                    |
| 19  | Escalate through `extensions` or a `SECURITY DEFINER` routine          | Blocked ✓  | no schema grant is made; the `SECURITY DEFINER` count is still 0                          |
| 20  | Acquire `BYPASSRLS`, ownership, or a broad `USING (true)` write policy | Blocked ✓  | role attributes unchanged; no unconditional write policy exists for `app_runtime`         |

**No unresolved Critical finding. No unresolved High finding.** Two Low items are accepted with
reasons in §4 rather than quietly absorbed.

### 3.1 Two application defects the working capability exposed

Making the audit path operational exercised it for the first time. Both defects below were latent
in the merged P1-13 foundation, unreachable while the capability was missing, and both were
confirmed by execution before being fixed.

**P1-13-F-005 — audit details recorded nothing (High, FIXED).** `iam.audit_append` reads `field`,
`old`, `new`, and `class` out of each JSON element of `p_details`. `appendAudit` serialised its own
`{field, classification, value}` shape and passed it through unchanged, so `old`, `new`, and `class`
were all absent. Executed proof, sending the exact shape the application sent:

```text
-- input:  [{"field":"display_name","classification":"restricted","value":"After"}]
 field_name  | old_value_masked | new_value_masked | value_classification
--------------+------------------+------------------+----------------------
 display_name |                  |                  | internal
```

Every field-level audit entry recorded a field name with NULL before and after values, and the
caller's `restricted` classification was silently defaulted to `internal` — so a value that did
arrive would not have been masked. A row count cannot see this, which is why the whole suite passed
while the evidence was empty. Fixed by translating the entry into the database's envelope in
`toDetailEnvelope()`, with a regression test in `tests/backend/transaction.test.ts` that asserts the
stored `old`/`new`/`class` for an internal, a restricted, and a secret field.

**P1-13-F-004 — an offered classification the database rejects (Medium, FIXED).**
`AuditDetail.classification` offered `'confidential'`, which `ck_audit_record_details_class` does not
allow, and omitted `'secret'`, which it does. Executed proof:

```text
ERROR: new row for relation "audit_record_details" violates check constraint
       "ck_audit_record_details_class"
DETAIL: Failing row contains (…, pin, 1234, 5678, confidential).
```

Two consequences: the whole command aborts on a CHECK violation, and — because `iam.audit_mask`
masks only `restricted` and `secret` — the raw values appear unmasked in the error DETAIL before
any masking runs. The strongest classification was meanwhile unreachable from TypeScript. Fixed by
deriving the union from `AUDIT_CLASSIFICATIONS`, which a test reconciles against the live CHECK
constraint so the two cannot drift apart again.

## 4. Accepted residual risks

**R-1 — the integrity chain is readable tenant-wide (Low, accepted).** `sel_audit_integrity_links_chain`
lets any session of a tenant read that tenant's `iam.audit_integrity_links` without holding
`iam.audit.view`. It cannot be narrower: extending a chain requires the previous link, and
restricting the policy to "the newest link" would need `max(seq)` over the same table inside its
own policy, which PostgreSQL rejects as infinite recursion. What is exposed is a counter, an opaque
record id, two SHA-256 digests, and the tenant id — no action, actor, entity, or field value, all of
which live in the two tables that remain gated. Asserted explicitly in
`tests/db/iam-hardening.test.ts`, including the table's full column list, so a future column added
here has to confront this decision.

**R-2 — a corrupted chain stops audit appends (Low, accepted, and deliberate).** Because the next
sequence number is derived from the chain, an audit record that exists without its chain link makes
the next append collide with `uq_audit_records_tenant_seq` and fail. Every audited operation for
that tenant then refuses rather than proceeding. This is the intended behaviour: the alternative is
to keep appending to a chain already known to be broken, which produces evidence nobody can trust.
Reaching the state requires arbitrary SQL execution as `app_runtime` — an attacker who already
holds that can write anything the runtime can write — and `iam.audit_verify_chain` reports it as
`orphan_record`. Nothing in the foundation writes `iam.audit_records` other than through
`iam.audit_append`.

**R-3 — a tenant can grow its own audit, outbox, and security-event tables (informational).** Any
capability to append is a capability to append a lot. Volume control is a rate-limiting and quota
concern at the application boundary, not an RLS one, and P1-OD-027 (NFR-SCL) remains unresolved, so
no capacity claim is made here either way.

## 5. What this record does not claim

These are development and test-environment results. They are not a performance baseline, not a
capacity measurement, and not evidence of production behaviour — no environment beyond Local exists
(ADR-012). Hosted CI results on the exact final commit are recorded in the pull request and are the
only CI evidence that counts. Nothing here was reviewed by an independent third party.
