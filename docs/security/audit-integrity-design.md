# Phase 1-4 — Audit Integrity Design

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18 ·
**Tasks:** P1-04-DB-014..017, 022

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

## The chain

```
canonical(record) = jsonb text of (tenant, seq, actor, actor_kind, action,
                    entity_type, entity_id, company, branch, correlation,
                    request_ref, occurred_at, [details ordered by field])
record_hash       = SHA-256(prev_hash || UTF8(canonical))       -- extensions.digest
genesis prev_hash = 32 zero bytes
```

`jsonb` sorts keys, so `canonical` is deterministic for identical logical
content. `iam.audit_verify_chain(tenant)` walks the chain in `seq` order,
recomputes each `record_hash`, and checks prev-hash continuity and seq
contiguity, returning `{ok:true, verified_through}` or
`{ok:false, first_bad_seq, reason: gap|broken_prev|hash_mismatch}`.

## Concurrency (no fork)

`iam.audit_append` takes `pg_advisory_xact_lock(hashtext('iam.audit:'||tenant))`
before reading `max(seq)` and `prev_hash`; the lock is held to COMMIT. So two
concurrent appends for the same tenant serialize — there is no interleaving that
assigns a duplicate `seq` or forks the chain. Verified by a 10-way concurrent
append test producing unique consecutive `seq` and a valid chain.

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
  detection control, and no application role holds any write grant.
