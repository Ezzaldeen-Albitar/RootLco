# P1-21-DO-002 — Clean-Room Runbook and Structured Logging

**Task:** `P1-21-DO-002`
**Phase:** P1-21 — Inventory Backend

## Why a clean room

Local CI proves the commands pass on the developer's machine. It cannot prove they
pass on a machine that has never seen this repository, and the difference is where
the interesting failures live: a dependency resolved from a stale cache, a migration
that only applies because an earlier one already ran, a test that passes because a
fixture from another suite happens to exist.

The clean room removes all three by construction — a fresh clone at an exact SHA, a
lockfile-only install, and an empty database on its own port.

## Procedure

Run at `FINAL_FEATURE_SHA`, and only after local CI is green on the same SHA.

1. **Isolated clone.** `git clone` the repository into a directory outside the
   working tree and `git checkout --detach <FINAL_FEATURE_SHA>`. Detached, so the
   clone cannot silently follow a branch that moves.
2. **Confirm the SHA.** `git rev-parse HEAD` must equal `FINAL_FEATURE_SHA` exactly.
   `FINAL_FEATURE_SHA`, `LOCAL_CI_SHA`, and `CLEAN_ROOM_SHA` must be identical; any
   executable or test commit invalidates the proof and all three are re-derived.
3. **Lockfile-only install.** `npm ci` — never `npm install`, which may resolve a
   different tree than the lockfile pins.
4. **Own database.** A disposable `postgres:17-alpine` container on a port used by
   nothing else, with no volume, so it starts empty and leaves nothing behind.
5. **Migrations.** `npm run db:apply-migrations` against that empty database. Assert
   **119** applied, **no migration 120**, and that no historical migration differs
   from the base.
6. **Seeds twice.** `npm run validate:seed-state` — applied twice, idempotent, five
   exact retention classes, every business table empty. This runs **before** any
   suite, because it is a fresh-database check.
7. **Permissions.** Assert the catalog total and that every `inv.*` code P1-21 needs
   is present.
8. **Schema hash.** `npm run validate:schema-inventory`. The hash must be
   `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — unchanged
   from the P1-20 baseline, because P1-21 adds no migration.
9. **Suites, serially.** `npm run test`, then `npm run test:db`, then
   `npm run test:backend`. Never two DB-backed suites at once.
10. **Static gates.** Lint, module boundaries, authorization coverage, operation
    coverage, the P1-19/P1-20/P1-21 inventories, OpenAPI, typecheck, format,
    stylelint, encoding, and the six classification guards.
11. **Build and Docker.** `npm run build`; `docker compose config --quiet`; the dev
    and runner image builds; and the non-root assertion (`id -u` ≠ 0).
12. **Schema hash again.** Re-read it after the suites. It must be **identical** to
    step 8 — a suite that changed the schema would invalidate every result above it.
13. **Clean worktree.** `git status --short` in the clone must be empty. A suite that
    writes a tracked file is a defect, not a nuisance.
14. **Teardown.** Remove the container and the clone. Nothing survives the run.

## Exit criteria

Every command exits `0`; migrations `119` with no `120`; seeds idempotent; the schema
hash identical before and after; the worktree clean; and the container removed. A
single non-zero exit fails the clean room — there is no `|| true`, no ignored result,
and no retry used to hide a deterministic failure.

## Structured logging and monitoring

P1-21 introduces no logging subsystem. It uses the foundation's structured logger
(`src/server/observability/logger.ts`), which the module-boundary rule
`B7-backend-uses-the-backend-logger` enforces — a `console.*` call in backend code
fails the build, so there is no second log path to configure or forget.

What inventory contributes to the existing telemetry:

- **Correlation.** Every movement carries `correlation_id` from the request context,
  so an issue, its audit record, and its outbox event are one trace.
- **Audit as the operational record.** Eleven inventory audit actions are registered.
  `inv.movement_history.read` and `inv.reconciliation.performed` exist specifically so
  privileged **reads** are visible, not only writes.
- **Alert routing.** The signal worth alerting on is
  `inventory-reconciliations` returning `incoherentCells > 0`. That number should be
  structurally zero — `inv.guard_stock_balance_coherence` rejects an incoherent write
  — so a non-zero value means the guard was bypassed. It is a security finding rather
  than a threshold to tune, which is why the endpoint reports it and never repairs it.
