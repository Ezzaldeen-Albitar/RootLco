# DBCR-P1-32-PRE-OD-FD4-001 — receipt reversal: request, decision, withdrawal and the replacement receipt

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, finance decision D4 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements Owner decision D4 of 2026-09-30 as recorded in
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md); applying it to any existing
database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261002090000_sal_receipt_reversal_requests.sql` (the 166th)
- **Seed change:** none. **Permission change:** none in the catalogue — `sal.reversal.approve` has
  been seeded since Phase 1-11; the standard tenant administrator bundle now carries it (application
  code, `apps/api/src/modules/iam/domain/bootstrap-roles.ts`). **Policy change:** none.
- **Executable proof:** `tests/db/sal-receipt-reversal-requests.test.ts` (the request rules through
  the primitive and through a raw INSERT on the runtime login; a raw INSERT naming a decided state,
  decider, date or reason born pending and undecided; one live reversal per receipt and a new request
  after a withdrawal; the allocation freeze, including an allocation racing a request; approval by a
  different holder of `sal.reversal.approve` only — not the requester, not a holder of the
  credit-note codes only, not a holder of the code in another branch only; the atomic approval
  restoring every invoice exactly with one financial event; rejection with a reason; requester-only
  withdrawal; terminal decisions for the runtime login and the owner; an approval racing an
  allocation, a rejection and a withdrawal, each with one outcome; a raw approval that did not
  reverse its receipt refused; another tenant refused; the replacement link once, only to an
  approved-reversed receipt of the same branch, frozen), `tests/db/p1-22-protected-residuals.test.ts`
  (the closed currency residual), `tests/db/foundation.test.ts` (routine and trigger inventory),
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census), and
  `tests/backend/od-finance-receipt-reversal.test.ts` (the five operations end to end).
- **Rollback classification:** **ROLLBACK-SAFE WITH DATA NOTE** — the inverse is in the migration
  footer; it can run only while no reversal is withdrawn, no receipt has two reversals and no
  receipt names a replaced one, because the previous schema has room for none of them.

---

## 1. Why this change request exists

A receipt's amount, payer, method and currency are frozen and allocations take inserts only, so a
mistyped amount or money applied to the wrong invoice could be corrected only by reversing the whole
receipt — and only the approval primitive existed: nothing raised a request and no route reached
either (finance review GAP-06). The Owner's decision D4: a full, traceable reversal, requested by an
authorised payment recorder and approved by a different authorised person; a credit-note permission
never grants it; atomic; the original retained; a replacement linked; not a refund. The review of
#489 also left a residual: the runtime login could raw-INSERT a reversal born `rejected` with a
chosen decision date, frozen from birth, and the table-wide unique constraint then blocked every
legitimate reversal of that receipt for ever.

## 2. The change

| Object                                           | Change                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.receipt_reversals`                          | NEW nullable `decided_by`, `decided_at`, `decision_reason`; `ck_receipt_reversals_approval_state` widened to `withdrawn`; NEW CHECKs: decider only on a declined reversal, withdrawal by the requester, rejection by another person, a decision reason on a rejection only and never blank.                                       |
| Uniqueness                                       | `uq_receipt_reversals_receipt` (every row) replaced by the partial `uq_receipt_reversals_receipt_live` (pending and approved only) and the plain `ix_receipt_reversals_receipt` for the foreign key, so a declined request no longer blocks a corrected one.                                                                      |
| `sal.guard_receipt_reversal_request()`           | NEW BEFORE INSERT guard: locks the receipt; the requester holds `sal.payment.record` in its company and branch; refuses a reversed receipt, a live reversal, an amount or currency other than the receipt's, and a blank or over-long reason.                                                                                     |
| `sal.stamp_dual_control_maker()`                 | Re-issued: a receipt reversal is now born `pending` with no reversal date, decider, decision time or decision reason, whatever the statement names (credit notes unchanged).                                                                                                                                                      |
| `sal.guard_receipt_reversal_decision()`          | NEW BEFORE UPDATE guard, now behind `tg_receipt_reversals_approval` (in place of `sal.guard_dual_control_approval`): approval and rejection by a person other than the requester holding `sal.reversal.approve` in the receipt's scope, rejection with a reason, withdrawal by the requester; dates stamped; decided rows frozen. |
| `sal.guard_receipt_reversal_applied()`           | NEW deferred constraint trigger: at commit, an approved reversal's receipt is `reversed`.                                                                                                                                                                                                                                         |
| `sal.guard_allocation_receipt_open()`            | NEW BEFORE INSERT guard on `sal.payment_allocations`: takes a share lock on the receipt and refuses an allocation while a reversal is pending or approved.                                                                                                                                                                        |
| `sal.request_receipt_reversal(uuid, text, text)` | NEW. Locks the receipt; answers a repeated idempotency key; inserts the reversal of the receipt's own amount and currency. `EXECUTE` to `app_runtime` only.                                                                                                                                                                       |
| `sal.approve_receipt_reversal(uuid, uuid)`       | Re-issued: locks the receipt before the reversal (the request's order), tokenised refusals; approves, reverses the receipt, writes the `receipt_reversed` event.                                                                                                                                                                  |
| `sal.withdraw_receipt_reversal(uuid)`            | NEW. The requester withdraws; idempotent for the requester. `EXECUTE` to `app_runtime` only.                                                                                                                                                                                                                                      |
| `sal.reject_receipt_reversal(uuid, text)`        | NEW. Another person rejects with a reason; idempotent on a rejected reversal. `EXECUTE` to `app_runtime` only.                                                                                                                                                                                                                    |
| `sal.receipts`                                   | NEW nullable `replaces_receipt_id` with the composite self-FK `fk_receipts_replaces`, `ck_receipts_replaces_other`, `uq_receipts_replaces` (partial) and `ix_receipts_replaces`.                                                                                                                                                  |
| `sal.guard_receipt_replacement()`                | NEW BEFORE INSERT guard: the replaced receipt is in the same branch, reversed by an approved reversal, and has no replacement yet.                                                                                                                                                                                                |
| `sal.guard_receipt_freeze()`                     | Re-issued: the replacement link is frozen with the money-bearing facts.                                                                                                                                                                                                                                                           |
| `sal.record_receipt(...)`                        | Dropped and re-created with one more trailing argument, `p_replaces_receipt_id uuid DEFAULT NULL`; `EXECUTE` to `app_runtime` only.                                                                                                                                                                                               |
| Grants                                           | `app_runtime`: `UPDATE (decision_reason)` on `sal.receipt_reversals` GRANTED.                                                                                                                                                                                                                                                     |

Every function is `SECURITY INVOKER` with an empty `search_path`, and `EXECUTE` is revoked from
PUBLIC on each. The migration writes no row.

## 3. Measured effect

Measured on a database created empty (`CREATE DATABASE ... TEMPLATE template0`) in a throwaway
`postgres:17` container on a loopback port of its own, replayed through all 166 migrations and
seeded twice with `npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported `functions` 645 (was 637) and
  `triggers` 638 (was 634); `tables` 277, `policies` 803 and `security_definer` 0 did not move;
- `npm run validate:schema-inventory` reported `functions` 343 (was 335) over the seventeen RootLco
  schemas, the companion figure `functionCountDiscrepancyNote` records;
- `npm run validate:schema-inventory -- --hash-only` produced the schema hash recorded in
  `.github/ci-baselines/schema-baseline.json`;
- the database tests named above passed on a disposable database. This is a local measurement; the
  hosted migration-replay and database jobs re-prove it.

The acceptance database was not read or written by this change.

## 4. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 166, `schemaHash`,
`structuralTotals.functions` 645 and `triggers` 638, `structuralTotalsNote166`, and the 637/335 ->
645/343 step in `functionCountDiscrepancyNote`), the routine and trigger inventory in
`tests/db/foundation.test.ts`, the P1-15 migration census, the closed residual in
`tests/db/p1-22-protected-residuals.test.ts`, the classification registry
`docs/database/sal-wty-rpt-personal-data-classification.json` (four new columns),
`docs/database/data-dictionary.md`, `docs/database/role-and-grant-standard.md` §5.11, and the P1-27
migration-count records. `tests/db/shared-hardening.test.ts` does not move: its approved surface
covers the `iam` and `shared` schemas, and every new function is in `sal`.

## 5. Upgrade of an existing database

The migration is forward-only on an existing database and writes no row; a receipt reversal row
already stored keeps its state. A row already `rejected` from a raw insert no longer blocks a new
request, because only a pending or approved reversal counts toward the live uniqueness. Granting
`sal.reversal.approve` to an existing organisation's standard administrator is the operator backfill
(`scripts/platform/backfill-tenant-administrator-bundle.mjs`), dry run first, for the named QA
organisations only (ADR-023 D4; change-control CC-OD-53).
