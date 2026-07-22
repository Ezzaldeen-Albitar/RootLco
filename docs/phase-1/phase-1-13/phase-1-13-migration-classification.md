# Phase 1-13 Migration Classification

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-13 · **Date:** 2026-07-21 · **Task:** P1-13-SEC-002 (DBCR-P1-13-001) ·
**Owner:** iam / shared (Eng. Ezzaldeen Al-Bitar)

Naming: the timestamp prefix continues after the last Phase 1-11 file
(`20260724096000_rpt_reporting.sql`). Phase 1-12 introduced no migration — it validated and froze
the Release 2 baseline — so this is the first migration since that freeze, and the 114th overall.

## Known defect in the migration's own header comment

`20260725090000_iam_shared_runtime_write_capabilities.sql` describes itself inconsistently. Its
purpose block says the migration adds "**one** in-place redefinition of `iam.audit_append`", and its
rollback classification line says "grants, policies, and **one** function body only" — but its own
"Objects created" block, three dozen lines further down, correctly lists **two**:

```
--   Functions (redefined in place): iam.audit_hash(bytea, text),
--                                  iam.audit_append(uuid, uuid, text, text,
--                                  text, uuid, uuid, uuid, uuid, text, jsonb)
```

**Two is correct.** The file contains exactly two `CREATE OR REPLACE FUNCTION` statements, and both
redefinitions are described in the body: section 1 replaces `iam.audit_hash`'s use of
`extensions.digest(…, 'sha256')` with `pg_catalog.sha256` (byte-identical, so previously written
hashes still verify), and section 3 reseats `iam.audit_append`'s chain sequence on
`iam.audit_integrity_links`.

**Why the header was not simply corrected.** Applied migrations are immutable once merged, and CI
enforces it: the `Database migrations and RLS tests` job fails a pull request whose diff against the
base branch shows any `M`, `D` or `R` under `supabase/migrations/`. A comment-only correction was
prepared, verified to change zero SQL statements, and then **reverted** when that control was run
locally and rejected it — correctly. The rule does not carve out comments, and it should not: a rule
that permits "harmless" edits to applied migrations stops being a rule.

The record therefore lives here, in the controlled document that describes the migration, rather than
in the migration. No forward migration was written for it, because a migration whose only content is
a corrected comment would add a permanent chain entry to fix a documentation defect.

## Category matrix

Each migration is classified across the five categories used since Phase 1-9: **schema** (tables,
columns, constraints), **security** (roles, grants, RLS), **function** (routines and triggers),
**index**, and **reference** (structural configuration rows). Reviewed under the Standing
Technical Authorization and Solo Developer Review policies — owner-authorized technical
self-review, not an independent third-party audit.

| Migration                                                  | schema |                                security                                 |             function             | index | reference | Rollback class                                                     |
| ---------------------------------------------------------- | :----: | :---------------------------------------------------------------------: | :------------------------------: | :---: | :-------: | ------------------------------------------------------------------ |
| `20260725090000_iam_shared_runtime_write_capabilities.sql` |   —    | ✓ (10 GRANT statements = 6 table + 4 EXECUTE, 11 policies, 0 new roles) | ✓ (`audit_hash`, `audit_append`) |   —   |     —     | **ROLLBACK-SAFE** (grants, policies, and two function bodies only) |

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

## Protected-history confirmation (2026-07-21)

The migration is merged. Verified against protected `origin/develop` =
`e615a0212fda0b028316206bf9f331dd86120890`:

```text
git diff --name-status release-2-database-baseline..e615a02 -- supabase/
A	supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql
```

One file **added**, none modified, renamed, or deleted, relative to the frozen Release 2 baseline
tag. The hosted `Assert applied migrations are immutable` CI step passed on the exact remediation
SHA `af240f0`, and the migration applied cleanly from an empty database in the clean room ("All 114
migrations applied cleanly"). Post-application catalogue, identical on the rebuilt working database
and in the clean room: 242 tables · 596 policies · 210 functions · 0 `SECURITY DEFINER` · 0 tables
with RLS enabled but not FORCED.
