# Phase 1-13 — DBCR-P1-13-001 remediation validation record

**Phase:** P1-13 · **Date:** 2026-07-21 · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Branch:** `fix/p1-13-runtime-database-capabilities` ·
**Migration:** `20260725090000_iam_shared_runtime_write_capabilities.sql`

Exit codes below are the actual observed values. No command output was truncated to hide a
failure, and no check was skipped. **The hosted CI results on the exact final commit are the
authoritative CI evidence**, and they are recorded in the pull request, not here.

---

## 1. Rebuild from empty, then validate

The database was dropped and rebuilt from the 114 migrations before this run, so nothing below
depends on state accumulated during development.

| Check                                                | Exit                           |
| ---------------------------------------------------- | ------------------------------ |
| `supabase db reset` (114 migrations + 7 seed files)  | 0                              |
| `validate:seed-state` (declared seeds applied twice) | 0                              |
| `validate:crm-classification`                        | 0                              |
| `validate:veh-classification`                        | 0                              |
| `validate:aptrec-classification`                     | 0                              |
| `validate:wo-tech-dia-qms-classification`            | 0                              |
| `validate:svc-quo-inv-classification`                | 0                              |
| `validate:sal-wty-rpt-classification`                | 0                              |
| `test:db`                                            | 0 — **120 files / 1184 tests** |
| `test:backend`                                       | 0 — **8 files / 61 tests**     |
| `test` (unit)                                        | 0 — **22 files / 272 tests**   |
| `lint`                                               | 0                              |
| `typecheck`                                          | 0                              |
| `format:check`                                       | 0                              |
| `style:check`                                        | 0                              |
| `validate:module-boundaries`                         | 0                              |
| `validate:authorization-coverage`                    | 0                              |
| `validate:openapi`                                   | 0                              |
| `security:tracked-secrets`                           | 0                              |
| `security:browser-secrets`                           | 0                              |
| `security:scope-exclusions`                          | 0                              |
| `validate:no-fake-data`                              | 0                              |
| `validate:canonical-docs`                            | 0                              |
| `build` (Next.js production)                         | 0                              |
| `docker compose config`                              | 0                              |

The database suite grew from 119 files / 1156 tests to 120 / 1184: one new file
(`tests/db/p1-13-runtime-capabilities.test.ts`, 27 tests) and one added test in
`tests/db/iam-hardening.test.ts`. The backend suite grew from 58 tests to 61: the capability suite
was rewritten around the granted surface, and two tests were added for P1-13-F-004 and F-005.

## 2. Database state after the full run

Measured on the live catalogue once both suites had finished, to confirm the tests left nothing
behind — this matters more than usual, because the previous run of these suites created and dropped
a temporary rehearsal role.

| Property                                                      | Value                               |
| ------------------------------------------------------------- | ----------------------------------- |
| Migrations applied                                            | **114** (was 113)                   |
| Tables in the 17 module schemas                               | **242** (unchanged)                 |
| RLS policies                                                  | **596** (was 585; +11)              |
| Functions                                                     | **210** (unchanged)                 |
| `SECURITY DEFINER` routines                                   | **0**                               |
| Tables with RLS enabled but not FORCED                        | **0**                               |
| Leftover rehearsal roles / policies                           | **0 / 0**                           |
| Business rows (tenants, audit, outbox, idempotency, partners) | **0** in every one                  |
| `app_runtime` non-SELECT privileges across `shared` + `iam`   | exactly **6 INSERTs**, nothing else |
| `app_runtime` UPDATE / DELETE / TRUNCATE anywhere             | **none**                            |
| `extensions` schema USAGE for any application role            | **false** for all three             |

The six INSERTs are `iam.audit_records`, `iam.audit_record_details`, `iam.audit_integrity_links`,
`iam.security_events`, `shared.event_outbox`, and `shared.idempotency_keys` — the exact set the
change request asks for.

## 3. Before and after, on the deployed identity

Both measured as `rootlco_test_runtime` (a member of `app_runtime`), with a resolved tenant context
and no `BYPASSRLS`.

| Capability              | Before the migration      | After                                         |
| ----------------------- | ------------------------- | --------------------------------------------- |
| `audit.append`          | `42501` permission denied | appends a masked, linked, verifiable record   |
| `outbox.publish`        | `42501` permission denied | writes a `pending`, unstamped envelope        |
| `idempotency.store`     | `42501` permission denied | reserves and reads back its own tenant's key  |
| `security-event.record` | `42501` permission denied | records a denial (and still cannot read one)  |
| Cross-tenant equivalent | `42501`                   | `42501` — unchanged, and asserted on all four |

## 4. What this record does not claim

These are development and test-environment results. They are not a performance baseline, not a
capacity measurement, and not evidence of any production behaviour — no environment beyond Local
exists (ADR-012), and **P1-OD-027 (NFR-SCL) remains unresolved**. No penetration test was
performed. No independent third-party review took place: the work was reviewed under the Standing
Technical Authorization and Solo Developer Review policies.
