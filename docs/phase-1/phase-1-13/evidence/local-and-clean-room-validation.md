# Phase 1-13 — Local and clean-room validation record

**Phase:** P1-13 · **Date:** 2026-07-21 · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Branch:** `feature/p1-13-backend-architecture-shared-foundation`.

**Which tree these results describe.** The clean-room run below was executed against commit
`ec794f0b82cdb6a5665e9a8b265233b026aa0b30`. The commit that finally carries this branch differs
from it by **this file only** — a record cannot contain its own commit hash, so stating the hash
it was actually run against is the honest form. Everything the checks exercise (source, tests,
scripts, configuration, dependencies) is byte-identical between the two.

**The hosted CI results on the exact final feature SHA are the authoritative CI evidence**, and
they are recorded in the pull request, not here.

Exit codes below are the actual observed values. No command output was truncated to hide a
failure, and no check was skipped.

---

## 1. Clean-room run

A fresh `git clone` of the feature branch into an isolated directory outside the working tree,
then `npm ci` only — no `node_modules`, no cache, no `.env.local`, no prior state. Environment
variables were the same safe non-secret placeholders CI uses, plus a database URL pointing at the
local PostgreSQL 17 service.

| Check                             | Exit                         |
| --------------------------------- | ---------------------------- |
| `npm ci`                          | 0                            |
| `lint`                            | 0                            |
| `typecheck`                       | 0                            |
| `format:check`                    | 0                            |
| `style:check`                     | 0                            |
| `validate:module-boundaries`      | 0                            |
| `validate:authorization-coverage` | 0                            |
| `validate:openapi`                | 0                            |
| `security:tracked-secrets`        | 0                            |
| `security:browser-secrets`        | 0                            |
| `security:scope-exclusions`       | 0                            |
| `validate:no-fake-data`           | 0                            |
| `test` (unit)                     | 0 — **22 files / 272 tests** |
| `test:backend`                    | 0 — **8 files / 58 tests**   |
| `build` (Next.js production)      | 0                            |

**Overall: 0.**

## 2. What the first clean-room run caught

The first clean-room run **failed** `security:tracked-secrets` with two hits, and that failure is
worth recording rather than quietly overwriting:

```
FAIL tracked-secrets: 2 credential-shaped value(s) in tracked files.
  - docs/standards/observability-standard.md:162
  - tests/backend/helpers.ts:88
```

The same command had passed minutes earlier in the working tree. The reason is the point of the
exercise: the scanner reads **tracked** files, and those two files were still untracked when the
working-tree run happened. Only a clean clone of the committed state sees what the merge would
actually contain.

Both were false positives — a documentation table cell describing the shape the log scrubber
detects, and a test-harness template literal built entirely from placeholders. Neither contained a
credential. Both were fixed by **changing the text so it no longer forms the matched shape**, not
by adding a `pragma: allowlist secret` marker: a suppression that silences a documentation example
would equally silence a real credential on that line.

## 3. Additional verification performed by hand

| Verification                                                 | Result                                                                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files changed under `supabase/`                              | **0** — `git diff --name-status origin/develop -- supabase/` is empty; 113 migrations, unchanged                                                                                                     |
| `SET LOCAL … = $1` defect                                    | Reproduced directly against PostgreSQL 17 (`ERROR: syntax error at or near "SET"`) before accepting the fix, and `set_config(..., true)` confirmed transaction-local (reverts to `0` after ROLLBACK) |
| Database state after `test:backend`                          | 242 tables, 585 policies, **0** leftover rehearsal roles, **0** leftover policies, **0** fixture tenants / outbox / idempotency / processed-event / error / audit / business-partner rows            |
| `app_runtime` write grants in `shared` + `iam` after the run | **0** — the DBCR-P1-13-001 gap is intact; the rehearsal granted nothing permanently                                                                                                                  |
| `extensions` schema USAGE for `app_runtime`                  | `false` — reverted                                                                                                                                                                                   |
| `docker compose config`                                      | Exit 0                                                                                                                                                                                               |
| Canonical documents                                          | `validate:canonical-docs` exit 0 — both external documents match their recorded hashes; nothing was copied into the repository                                                                       |

## 4. Scope boundary evidence

`git diff --cached --name-only` by area for the commit under validation: `.github` 1 · `docs` 24 ·
`scripts` 3 · `src` 49 · `tests` 26 · `package.json` / `package-lock.json` / two vitest configs.
**Zero** files under `supabase/`. No P1-14 or later business endpoint, no frontend page or
component, no general ledger, procurement, payment gateway, or subscription billing.

## 5. What this record does not claim

These are development and test-environment results. They are not a performance baseline, not a
capacity measurement, and not evidence of any production behaviour — no environment beyond Local
exists (ADR-012), and **P1-OD-027 (NFR-SCL) remains unresolved**. Hosted CI results on the exact
final feature SHA are recorded separately in the pull request, and are the only CI evidence that
counts.
