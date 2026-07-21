# Phase 1-13 Migration Classification

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-13 · **Date:** 2026-07-21 · **Task:** P1-13-SEC-002 (DBCR-P1-13-001) ·
**Owner:** iam / shared (Eng. Ezzaldeen Al-Bitar)

Naming: the timestamp prefix continues after the last Phase 1-11 file
(`20260724096000_rpt_reporting.sql`). Phase 1-12 introduced no migration — it validated and froze
the Release 2 baseline — so this is the first migration since that freeze, and the 114th overall.

## Category matrix

Each migration is classified across the five categories used since Phase 1-9: **schema** (tables,
columns, constraints), **security** (roles, grants, RLS), **function** (routines and triggers),
**index**, and **reference** (structural configuration rows). Reviewed under the Standing
Technical Authorization and Solo Developer Review policies — owner-authorized technical
self-review, not an independent third-party audit.

| Migration                                                  | schema |                security                |             function             | index | reference | Rollback class                                                     |
| ---------------------------------------------------------- | :----: | :------------------------------------: | :------------------------------: | :---: | :-------: | ------------------------------------------------------------------ |
| `20260725090000_iam_shared_runtime_write_capabilities.sql` |   —    | ✓ (6 grants, 11 policies, 0 new roles) | ✓ (`audit_hash`, `audit_append`) |   —   |     —     | **ROLLBACK-SAFE** (grants, policies, and two function bodies only) |

## Notes

- **No schema change.** No table, column, constraint, index, or sequence is created, altered, or
  dropped. Object counts move from 585 to 596 policies; tables (242), functions (210), and
  `SECURITY DEFINER` routines (0) are unchanged.
- **No new role.** `app_runtime`, `app_readonly`, and `app_worker` keep every attribute they had:
  no LOGIN, no superuser, no `BYPASSRLS`, no `CREATEROLE`, no `CREATEDB`, and ownership of nothing.
- **Two functions are redefined in place**, both preserving signature, defaults, return type,
  `SECURITY INVOKER` context, and `SET search_path = ''`:
  - `iam.audit_hash(bytea, text)` swaps `extensions.digest(…, 'sha256')` for
    `pg_catalog.sha256(…)`. Byte-identical output, verified on this baseline, so hashes written
    before the change still verify — `iam.audit_verify_chain` recomputes with the same function.
    The point is to remove a cross-schema dependency that would otherwise have required
    `GRANT USAGE ON SCHEMA extensions`.
  - `iam.audit_append(…)` derives the next chain sequence from `iam.audit_integrity_links` rather
    than `iam.audit_records`. Same output, same advisory lock, same one-transaction guarantee. It
    exists so the writer's read of `iam.audit_records` can be narrowed to the unlinked row it just
    wrote, which is what keeps `iam.audit.view` in force. See DBCR-P1-13-001 §4.1.
- **Fix-forward legitimacy.** Applied migrations are immutable and none was edited: this is a new
  forward file, and the CI step `Assert applied migrations are immutable` verifies that on every
  pull request. Redefining a routine through `CREATE OR REPLACE` in a later migration is the
  repository's established fix-forward pattern (see `20260719105000` for the Phase 1-6 precedent).
- **Roll-forward-only?** No. Nothing here writes, moves, or destroys a row, so the exact inverse
  is safe at any time. It is recorded in the migration's closing comment: drop the eleven policies,
  revoke the grants, restore the two function bodies from `20260718095000_iam_audit_subsystem.sql`.
  Rows written while the grants were in place remain valid, readable, and chain-verifiable
  afterwards; only the ability to write more is withdrawn. Restoring `iam.audit_hash` is optional
  for the same reason the swap was safe.

## Rehearsals (executed 2026-07-21)

| Rehearsal                                      | Result                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Clean apply from an empty database             | `supabase db reset` — 114 migrations and 7 seed files applied, exit 0                                   |
| Live-catalog inventory on the fresh stack      | 242 tables · 596 policies · 210 functions · 0 `SECURITY DEFINER` · `app_runtime` non-SELECT = 6 INSERTs |
| Capability probe as `app_runtime` before/after | four capabilities denied with SQLSTATE 42501 before; all four available after                           |
| Full database suite on the fresh stack         | `npm run test:db`                                                                                       |
| Backend foundation suite on the deployed role  | `npm run test:backend` — 8 files / 61 tests, on `rootlco_test_runtime` rather than a rehearsal role     |
| Roll-forward recovery statement                | not required: the migration is rollback-safe and writes no data                                         |

CI parity: the hosted `Database migrations and RLS tests` job applies every migration to a clean
PostgreSQL 17 service container with `npm run db:apply-migrations`, applies the declared seeds
twice through `npm run validate:seed-state`, and then runs both suites — the same commands used
locally, so a divergence between the two is a failure rather than a surprise.

## Seed posture

No seed file is added or changed. The migration grants privileges; it inserts no row, and business
tables remain empty after a clean migration exactly as the no-fake-data policy requires.
