# Phase 1-4 — Audit Integrity Design

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18 ·
**Tasks:** P1-04-DB-014..017, 022 · **Amended:** 2026-07-21 by
[DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)
(the writer/reader model and the hash primitive)

## Goal

A tamper-evident audit trail: any later alteration or deletion of a committed
audit record is **detectable**, even by a privileged database user.

## Structures

- `iam.audit_records` — append-only event header; per-tenant monotonic `seq`.
- `iam.audit_record_details` — field-level changes; restricted/secret values
  stored **masked** (`iam.audit_mask` → `***`); the raw value never lands here.
- `iam.audit_integrity_links` — one link per record: `prev_hash`, `record_hash`
  (both 32 bytes).
- `iam.security_events` — payload-free security log (no credential/token/raw
  restricted value).

## Who may write, and who may read

These are two different permissions, and DBCR-P1-13-001 (migration
`20260725090000`) changed only the first.

**Writing.** `app_runtime` holds `INSERT` on all four tables and `EXECUTE` on
`iam.audit_append` and its three helpers, so the backend request path writes its
own evidence in the transaction it is auditing. Every write policy is
`tenant_id = iam.current_tenant_id()`. There is **no `UPDATE`, `DELETE` or
`TRUNCATE` grant** for any application role, and no `SECURITY DEFINER` wrapper
exists (the database-wide count of definer routines is still zero) — so append is
the only writing verb the application can reach, and `iam.audit_append` remains
the sole writer of a well-formed record.

**Reading committed history still requires the `iam.audit.view` permission**, via
the unchanged `sel_audit_records_permitted` /
`sel_audit_record_details_permitted` / `sel_audit_integrity_links_permitted` /
`sel_security_events_permitted` policies. A session that may append is not
thereby a session that may read: `iam.security_events` gained no new SELECT
policy at all, and the writer's own reads of the record and detail rows go
through `sel_audit_records_unlinked` / `sel_audit_record_details_unlinked`, which
match only rows that have **no chain link yet**. `audit_append` writes the link
last, so that window covers exactly the row under construction and shuts before
the function returns — after COMMIT it matches nothing.

**One deliberate exception**, recorded rather than absorbed:
`sel_audit_integrity_links_chain` lets any session of a tenant read that tenant's
chain links without holding `iam.audit.view`, where before it could read none.
Extending a hash chain requires the previous link, and the policy cannot be
narrowed to "the newest link" because that would need `max(seq)` over the table
inside its own policy, which PostgreSQL rejects as infinite recursion. The table
carries a per-tenant counter, an opaque record id, two SHA-256 digests, and
`tenant_id` — no action, actor, entity, or field value; those live in
`iam.audit_records` and `iam.audit_record_details`, both still gated. Severity
Low, accepted in DBCR-P1-13-001 §7.

## The chain

```
canonical(record) = jsonb text of (tenant, seq, actor, actor_kind, action,
                    entity_type, entity_id, company, branch, correlation,
                    request_ref, occurred_at, [details ordered by field])
record_hash       = SHA-256(prev_hash || UTF8(canonical))       -- pg_catalog.sha256
genesis prev_hash = 32 zero bytes
```

`iam.audit_hash` used `extensions.digest(..., 'sha256')` (pgcrypto) until
DBCR-P1-13-001 moved it to core `pg_catalog.sha256`, so that the
`SECURITY INVOKER` call chain needs no `USAGE ON SCHEMA extensions` — a grant
that was measured to also expose `extensions.pg_stat_statements`. The two
implementations are byte-identical (verified for the empty input, a short input,
and a real `prev_hash || canonical` chain input), and the verifier recomputes
with the same function, so hashes written before the change still verify.

`jsonb` sorts keys, so `canonical` is deterministic for identical logical
content. `iam.audit_verify_chain(tenant)` walks the chain in `seq` order,
recomputes each `record_hash`, and checks prev-hash continuity and seq
contiguity, returning `{ok:true, verified_through}` or
`{ok:false, first_bad_seq, reason: gap|broken_prev|hash_mismatch|orphan_record}`
(`orphan_record` is a record with no chain link — a fabrication rather than an
alteration; it is what a manually inserted audit row produces).

## Concurrency (no fork)

`iam.audit_append` takes `pg_advisory_xact_lock(hashtext('iam.audit:'||tenant))`
before reading `max(seq)` and `prev_hash`; the lock is held to COMMIT. So two
concurrent appends for the same tenant serialize — there is no interleaving that
assigns a duplicate `seq` or forks the chain. Verified by a 10-way concurrent
append test producing unique consecutive `seq` and a valid chain.

Since DBCR-P1-13-001 both of those reads come from `iam.audit_integrity_links`:
the chain, not the record table, is the sequence authority. The chain carries the
same `seq` for the same record and is written by this function in the same
transaction, so `max(seq)` over the links equals `max(seq)` over the records
whenever the chain is intact — and deriving it from the links means appending
never requires reading the tenant's committed audit history, which is what the
`iam.audit.view` gate exists to protect. If the two ever disagree (an orphan
record, which `iam.audit_verify_chain` reports as tampering), the derived
sequence collides with `uq_audit_records_tenant_seq` and the append **fails**
rather than extending a chain already known to be broken. `audit_append` also
raises `insufficient_privilege`, naming the cause, if it cannot read back the row
it has just written — a caller lacking the writer-scoped SELECT path gets that
instead of an opaque NOT NULL violation on `record_hash`.

## Transactionality

Record + details + link are written in the caller's single transaction. A
failure at any step (e.g. an invalid `actor_kind`) raises and **aborts the
caller's transaction** — nothing persists. Verified.

## What is NOT claimed

- **No external anchoring.** The chain is internal; it detects tampering, it does
  not prove time-anchoring to a third party.
- **Database RLS does not log every SELECT.** Audit-read access logging is a
  Phase-1-14 backend responsibility, stated openly, not implemented here.
- A superuser/BYPASSRLS role can still write to the tables; the chain is the
  detection control. `app_runtime` holds tenant-scoped `INSERT` only
  (DBCR-P1-13-001) — never `UPDATE`, `DELETE` or `TRUNCATE` — and `app_readonly`
  and `app_worker` hold no write grant at all, so an application session can
  extend the trail but cannot rewrite or erase it, and an out-of-band alteration
  remains detectable exactly as before.
