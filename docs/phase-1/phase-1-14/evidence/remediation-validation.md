# Phase 1-14 — DBCR-P1-14-001 Remediation Validation

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-22 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../../governance/solo-developer-review-policy.md)).

---

## 1. What was validated

The remediation branch `fix/p1-14-runtime-administration-capabilities`, branched from protected
`origin/develop` `8c8e0fa5a4093781c98ed9c2a40ebee5a7f7a74b`, carrying one additive migration,
one new database test suite, seven updated security-posture suites, and the controlled records
for [DBCR-P1-14-001](../../../database/change-requests/DBCR-P1-14-001-runtime-administration-write-capabilities.md).

## 2. Local validation — commands and exit codes

Run on the local Supabase stack (PostgreSQL 17) after a full `supabase db reset` from empty.

| Command                                           | Exit                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npx supabase db reset`                           | 0                                                                                                     |
| `npm run format:check`                            | 0                                                                                                     |
| `npm run lint`                                    | 0                                                                                                     |
| `npm run typecheck`                               | 0                                                                                                     |
| `npm run style:check`                             | 0                                                                                                     |
| `npm run validate:module-boundaries`              | 0                                                                                                     |
| `npm run validate:authorization-coverage`         | 0                                                                                                     |
| `npm run validate:openapi`                        | 0                                                                                                     |
| `npm run validate:canonical-docs`                 | 0                                                                                                     |
| `npm run security:all`                            | 0                                                                                                     |
| `npm run validate:crm-classification`             | 0                                                                                                     |
| `npm run validate:veh-classification`             | 0                                                                                                     |
| `npm run validate:aptrec-classification`          | 0                                                                                                     |
| `npm run validate:wo-tech-dia-qms-classification` | 0                                                                                                     |
| `npm run validate:svc-quo-inv-classification`     | 0                                                                                                     |
| `npm run validate:sal-wty-rpt-classification`     | 0                                                                                                     |
| `npm run test`                                    | 0 — 23 files, **308 tests**                                                                           |
| `npm run test:db`                                 | 0 — 121 files, **1248 tests** (see §6a: 1 of 4 runs hit a pre-existing intermittent outbox assertion) |
| `npm run test:backend`                            | 0 — 8 files, **69 tests**                                                                             |
| `npm run build`                                   | 0 — routes: `/`, `/_not-found`, `/api/health`, `/api/v1/meta/ping`                                    |
| `docker compose config --quiet`                   | 0                                                                                                     |

## 3. Clean-room validation on a CI-shaped database

The hosted `database` job does not use the Supabase stack; it uses a bare `postgres:17-alpine`
service container. That path was reproduced locally rather than assumed, on a throwaway
container on port 54399, in the same order CI runs it:

| Step                          | Result                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run db:apply-migrations` | **0** — `All 115 migrations applied cleanly.`                                                                       |
| `npm run validate:seed-state` | **0** — 7 declared files applied twice; five exact retention classes; every business table empty; counts idempotent |
| `npm run test:db`             | **0** — 121 files, 1246 tests                                                                                       |
| `npm run test:backend`        | **0** — 8 files, 69 tests                                                                                           |

The throwaway container was removed after the run.

## 4. Measured catalogue after the migration

Read from the live schema after a clean rebuild, not asserted from the migration text.

| Metric                           | Value                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| Applied migrations               | 115                                                                                   |
| Tables (17 module schemas)       | 242                                                                                   |
| Functions                        | 210                                                                                   |
| `SECURITY DEFINER` functions     | 0                                                                                     |
| RLS policies                     | 615 (596 + 19)                                                                        |
| Triggers                         | 539                                                                                   |
| RLS-enabled tables without FORCE | 0                                                                                     |
| Tables without RLS               | 0                                                                                     |
| Relations owned by `app_*` roles | 0                                                                                     |
| Policies added by this migration | 19                                                                                    |
| Schema USAGE for `app_runtime`   | 17 module schemas — unchanged; still none on `extensions`, `auth`, `storage`, `vault` |

## 5. Security-posture suites updated, and why

Seven suites asserted the pre-P1-14 boundary. Each was **rewritten to assert the new boundary**,
never relaxed — in every case the replacement is at least as strong, because a policy denial on
UPDATE/DELETE affects zero rows silently and would pass a naive "expect an error" test against
a policy that did not exist at all.

| Suite                      | Old assertion                                             | New assertion                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org-tenants.test.ts`      | Runtime cannot UPDATE its own tenant row (42501)          | Without `org.settings.manage` the UPDATE matches **no row**; and no privilege exists on `tenant_code`, `status` or `record_version` at all                                                  |
| `iam-accounts.test.ts`     | Runtime cannot UPDATE or DELETE an account (no grant)     | Without `iam.user.manage` the UPDATE matches **no row**; DELETE is still 42501; the identity columns are still 42501                                                                        |
| `iam-sessions.test.ts`     | Runtime cannot write sessions / cannot append login audit | A principal writes its **own** session and its **own** login-audit row and no one else's; UPDATE/DELETE on login audit and DELETE on sessions are still 42501; a session cannot be re-owned |
| `org-security.test.ts`     | DELETE granted on **no** module-schema table              | DELETE granted on **exactly two** association tables, both named, both `app_runtime`                                                                                                        |
| `iam-hardening.test.ts`    | INSERT on the four audit tables, and no history table     | INSERT on the four audit tables **plus** the two identity-history tables, all six still append-only                                                                                         |
| `shared-hardening.test.ts` | Approved `app_runtime` function surface (17 routines)     | Same surface plus `iam.change_user_status`; `iam.audit_verify_chain` still withheld                                                                                                         |
| `foundation.test.ts`       | Exact policy inventory (596)                              | Exact policy inventory (615). The difference was computed and asserted to be **exactly** the 19 policies this migration adds, with **zero** removed, before the file was edited             |

## 6a. Intermittent outbox-suite failure — observed, partially diagnosed, NOT fixed

`tests/db/shared-event-outbox.test.ts` failed **once in four** full `npm run test:db` runs on
this branch. Runs 1, 2 and 4 passed (1246, 1246 and 1248 tests); run 3 failed one assertion:

```text
a single claim never returns more than its limit (deterministic over-selection guard)
  claim(4) over 8 pending returned 8
  expected 4, received 8
```

What was established:

- **The function is correct in isolation.** Reproduced directly against the live schema: insert
  8 pending events, call `shared.claim_outbox_events('worker-limit', 4)` → **4 rows returned, 4
  distinct ids, 4 rows left pending, `attempt_count` incremented on exactly 4**. The equivalent
  raw `UPDATE … FROM (… FOR UPDATE SKIP LOCKED LIMIT 4) RETURNING` also returned exactly 4.
- **Ambiguous dispatch is ruled out.** `shared.claim_outbox_events` has exactly **one**
  overload, `(p_claimant text, p_limit integer, p_lease interval)`.
- **The follow-up isolated failure was cascade, not signal.** Re-running the file immediately
  after the failed suite also failed, because the failed run left rows in `shared.event_outbox`.
  After clearing the table the file passed twice consecutively, and the full suite passed again.

What was **not** established: how a `LIMIT 4` update returned 8 rows. No mechanism was found
that explains it, so no fix is claimed and none was made. The most likely remaining explanation
is interference from another test file writing `shared.event_outbox` concurrently under
Vitest's parallel file execution, but that was not proven.

This matches the residual risk already carried from P1-13 — _"the intermittent database-suite
failure remains undiagnosed"_ — and is recorded here as **unresolved, severity Low**: the
production routine is provably correct under direct test, and the defect observed is in test
isolation rather than in the claim contract. It is **not** caused by this migration, which
grants nothing on `shared.event_outbox` and adds no policy to it. Hosted CI builds a fresh
database per run and executes the same files in the same parallel mode, so the same flake can
occur there; if it does, the run is to be re-triggered and the recurrence recorded, never
explained away.

## 6b. Observation recorded, not fixed here

`npm run validate:seed-state` fails if it is run **after** `npm run test:db` on the same
database. The retention suite mutates the platform rows in `shared.retention_classes`
(`min_retention_days`, `record_version` → 4) and does not restore them, so the seed validator
then sees five classes whose values no longer match the governed set.

This is **pre-existing and unrelated to this change request**: it reproduces on the protected
baseline, and it is invisible to CI because the hosted workflow runs `validate:seed-state`
_before_ `test:db`. It was confirmed by rebuilding from empty and re-running the validator,
which exits 0. Recorded here rather than silently worked around; fixing the suite's cleanup is
not in this remediation's scope.

## 7. Adversarial review of this remediation

Performed by the owner against the owner's own migration. Two findings were raised and **fixed
before submission**, each with a regression test:

| ID          | Severity | Finding                                                                                                                                              | Fix                                                                                         |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P1-14-R-001 | Medium   | The session UPDATE policies allowed `revoked_at` to be cleared, so a revoked session could be resurrected — by an administrator or by its own owner. | `revoked_at IS NULL` added to `USING` on both policies; revocation is now terminal.         |
| P1-14-R-002 | Medium   | The login-audit administrative arm accepted any `event_type`, letting `iam.user.manage` fabricate another principal's authentication history.        | The arm is restricted to `event_type = 'lockout'`, which is the only capability it was for. |

Also considered and **deliberately not changed**:

- **Last-administrator protection.** A policy cannot cheaply express "this tenant must retain at
  least one administrator", because it requires counting grants across the tenant. It stays an
  application-service responsibility in the feature phase, and this record does not claim the
  database enforces it.
- **Bootstrap.** No policy here can create a tenant's first administrator. That is deliberate
  (DBCR §5.5) and must not be worked around by weakening `ins_user_accounts_admin`.
- **Cost of the delegation rule.** `ins_role_grants_delegable` evaluates `iam.has_permission`
  once per allow-permission the role confers. That is O(n) function calls on an administrative
  write, which is acceptable; it is not on any read path.

No unresolved Critical or High finding exists in this remediation.

## 8. Governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The
work was reviewed under the Standing Technical Authorization and Solo Developer Review
policies. This is owner-authorized technical self-review and is never an independent
third-party audit.
