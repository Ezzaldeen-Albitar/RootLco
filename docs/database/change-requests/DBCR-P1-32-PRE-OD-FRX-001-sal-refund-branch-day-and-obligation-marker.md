# DBCR-P1-32-PRE-OD-FRX-001 — the refund payout day is the branch's day, and an obligation names its approval

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, residuals of the
CP-20261008-2 retest and of the review of #537 · **Owner:** Eng. Ezzaldeen Al-Bitar (technical
self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** Applying it to any existing database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261008150000_sal_refund_branch_day_and_obligation_marker.sql`
  (the 187th)
- **Seed change:** none. **Permission change:** none. **Role bundle or backfill:** none.
- **Executable proof:** `tests/db/sal-refund-requests.test.ts` (the fixture branch moved, inside a
  rolled-back owner transaction, to a real zone whose day differs from the server's at the moment
  of the run — UTC+14 ahead from 10:00 UTC, UTC-12 behind before noon: the branch's own today is
  recorded, the day after it refused, and, behind, the server's today refused);
  `tests/db/sal-credit-note-decisions.test.ts` (two credit notes approved in one transaction — the
  first within what was owed, the second owed back in full — then a raw `INSERT` of an obligation
  for the first, whose arithmetic matches, is refused as `refund_obligation_not_from_approval`, as
  is one under a marker naming the other note; the approval leaves the marker empty);
  `tests/backend/od-finance-refund-requests.test.ts` and `tests/unit/od-finance-refund-requests.test.ts`
  (the service's own check reads the branch's day); `tests/db/p1-15-shared-services-runtime-capabilities.test.ts`
  (migration census).
- **Rollback classification:** **ROLLBACK-SAFE.** The inverse in the migration footer re-issues the
  three previous function definitions.

## 1. Why this change request exists

- **The payout day.** `sal.guard_refund_request_update` refused a payout dated after
  `current_date`, the SERVER's calendar day, and `RefundRepository.today` read the same. The
  platform's convention is the branch-local day (Owner decision D-17;
  `apps/api/src/server/db/period.ts`, `apps/api/src/modules/overview/data/overview-clock-repository.ts`):
  `(now() AT TIME ZONE org.branches.timezone_name)::date`. A branch ahead of the server was refused
  its own today; one behind it was admitted a day it had not reached.
- **The obligation marker.** `sal.guard_refund_obligation_insert` (20261008130000) binds an
  obligation to a note approved in the current transaction and to its exact excess. Two notes
  approved in ONE transaction both pass the first rule, and once the second is approved the
  arithmetic of a raw `INSERT` for the first can match. Minor, and defence in depth: the runtime
  login reaches that state only by writing the raw statement itself.

## 2. The change

| Object                                 | Change                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.guard_refund_request_update()`    | Re-issued: "not in the future" is judged against the request branch's own day, read from `org.branches` under the caller's row-level security; an unreadable branch clock refuses (`refund_payout_date_invalid`) rather than falling back to the server's. COMMENT restated. |
| `sal.approve_credit_note(uuid, uuid)`  | Re-issued: sets the transaction-local setting `sal.refund_obligation_credit_note` to the note around its one obligation `INSERT` and clears it after (precedent: `inv.material_request_id`, 20260917099000). COMMENT restated.                                               |
| `sal.guard_refund_obligation_insert()` | Re-issued: as its LAST check, so every other refusal keeps its token, the marker must name the row's credit note (`refund_obligation_not_from_approval`). COMMENT restated.                                                                                                  |

All three stay `SECURITY INVOKER` with an empty `search_path`; the two guards keep `EXECUTE` revoked
from PUBLIC and `sal.approve_credit_note` keeps its grant to `app_runtime`. No table, column,
constraint, index, trigger, policy, grant, seed or row changes, and no applied migration is edited.

**The marker is defence in depth, not a security boundary.** Any session may set a custom setting,
so a caller that writes the raw statement could also set the marker. The controls remain the guard's
arithmetic, the approval in the current transaction, the grants and forced row-level security; the
marker closes the same-transaction case the arithmetic alone leaves open.

The application check moves with the guard: `RefundRepository.branchToday` reads the same branch day,
and `RefundService.executeRefund` compares the payout date with it.

## 3. Measured effect

Replayed from empty through all 187 migrations on a throwaway `postgres:17-alpine` container on
`127.0.0.1:55447` with `scripts/db/apply-migrations.mjs`, seeded twice with
`npm run validate:seed-state`: `scripts/ci/migration-replay-checks.mjs --phase post` reported only the
migration count against the 186 baseline (`tables` 281, `functions` 679, `policies` 813, `triggers`
667, `security_definer` 0 and the permission count 135 unchanged); `scripts/db/structural-review.mjs`
passed; the schema hash is unchanged, because the inventory hashes function identity and not body.
The test files above ran on that database. This is a local measurement; the hosted migration-replay
and database jobs re-prove it.

## 4. Upgrade rehearsal

The four pending migrations (184 to 187) were applied with `npx supabase migration up --db-url` to a
disposable restore of the 2026-10-08 pre-apply backup of the acceptance database (ledger 183) on
`127.0.0.1:55448`. The restore went into its own database rather than re-creating `postgres`,
because the image's `pg_net` background worker is terminated by signal 11 when `postgres` is dropped
and restored under it, which resets the server mid-restore; the worker plays no part in these
migrations. Result: ledger 183 to 187; every pre-existing row count, money total and the
open-receivable digest unchanged; the two refund tables empty; the three re-issued functions carry
the new bodies; no `ERROR` or `FATAL` in the server log while the migrations ran. Evidence outside
the repository: `orchestration/evidence/frx-residual-fixes/` (`rehearse.sh`, `rehearse.log`,
`rehearsal/`).

## 5. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 187 and `structuralTotalsNote187`), the
P1-15 migration census, the P1-27 migration-count records and evidence manifest, the data dictionary
(`sal.refund_requests.payout_date`), and the route checklist.

## 6. Later note (P1-32-PRE-OD-FRXR)

The follow-up to the CP-20261008-3 runtime retest changes no schema, seed, permission or migration,
so it has no change request of its own. It changes one API behaviour of the same residual round:
`iam.auth-session` and `iam.working-context-read` now refuse any query parameter with the standard
validation error instead of ignoring it (route checklist, "Addendum: the CP-20261008-3 runtime
retest").
