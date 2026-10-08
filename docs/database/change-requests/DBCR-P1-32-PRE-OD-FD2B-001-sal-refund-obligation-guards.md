# DBCR-P1-32-PRE-OD-FD2B-001 — an obligation belongs to its approval, and the ceiling is held by the trigger

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, finance decision D2, review
residuals of part 1 · **Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It closes two findings of the review of #536 (P1-32-PRE-OD-FD2A); applying it to any
existing database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261008130000_sal_refund_obligation_guards.sql` (the 185th)
- **Seed change:** none. **Permission change:** none. **Role bundle or backfill:** none.
- **Executable proof:** `tests/db/sal-credit-note-decisions.test.ts` (the reviewer's case — gross
  100, credit A of 50 approved while nothing was paid, a receipt of 50, credit B of 50 approved and
  owed back in full — where a raw obligation for A is refused as
  `refund_obligation_credit_not_current` although its arithmetic matches; and a raw `UPDATE` of
  `approval_state` above the gross less the approved credits refused as
  `credit_note_exceeds_creditable` by the decision trigger, while exactly what remains is still
  admitted), `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census).
- **Rollback classification:** **ROLLBACK-SAFE.** The inverse in the migration footer re-issues the
  two previous function definitions.

## 1. Why this change request exists

The review of #536 found two places where the D2 rules held only on the path the application takes:

- `sal.guard_refund_obligation_insert` measured an obligation against what the invoice owed "before
  the credit" — every approved credit but the cited one. For a note approved in an EARLIER
  transaction that is not what the invoice owed when it was approved, so a raw `INSERT` could attach
  an obligation to an old credit whose arithmetic happened to match, doubling what the customer is
  recorded as owed.
- `sal.approve_credit_note` held the D2 ceiling, but a raw `UPDATE` of `approval_state` — which the
  runtime login may write — reached the approved state through `sal.guard_credit_note_decision`
  without it.

## 2. The change

| Object                                 | Change                                                                                                                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.guard_refund_obligation_insert()` | Re-issued: also refuses a credit note whose `approved_at` is not `now()` — the approval stamps it with `now()` and `sal.approve_credit_note` records the obligation in the same transaction — as `refund_obligation_credit_not_current`. COMMENT restated. |
| `sal.guard_credit_note_decision()`     | Re-issued: on `pending -> approved`, after the invoice row lock, refuses an amount above the issued invoice's gross less the credits already approved, as `credit_note_exceeds_creditable`, before the approval-limit rules. COMMENT restated.             |

Both stay `SECURITY INVOKER` with an empty `search_path` and `EXECUTE` revoked from PUBLIC. No table,
column, constraint, index, trigger, policy, grant, seed or row changes.

## 3. Measured effect

Replayed from empty through all 185 migrations on a throwaway `postgres:17-alpine` container on
`127.0.0.1:55457` with `scripts/db/apply-migrations.mjs`, seeded twice with
`npm run validate:seed-state`: `scripts/ci/migration-replay-checks.mjs --phase post` reported only
the migration count against the 184 baseline (`tables` 280, `functions` 671, `policies` 810,
`triggers` 662, `security_definer` 0 and the permission count 134 unchanged);
`scripts/db/structural-review.mjs` passed; the schema hash is unchanged, because the inventory hashes
function identity and not body. The two test files above ran on that database. This is a local
measurement; the hosted migration-replay and database jobs re-prove it.

## 4. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 185 and `structuralTotalsNote185`), the
P1-15 migration census and the P1-27 migration-count records. The upgrade of an existing database is
rehearsed with the refund-request migration (DBCR-P1-32-PRE-OD-FD2B-002).
