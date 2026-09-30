# DBCR-P1-32-PRE-OD-FD2A-001 — credit-note withdrawal and rejection, and frozen decision dates

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, finance decisions D3 and D9 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements Owner decisions D3 and D9 of 2026-09-30 as recorded in
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md); applying it to any existing
database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20260930110000_sal_credit_note_decisions.sql` (the 164th)
- **Seed change:** none. **Permission change:** none. **Policy change:** none.
- **Executable proof:** `tests/db/sal-credit-note-decisions.test.ts` (requester-only withdrawal,
  rejection by a different holder of `sal.credit.manage` with a reason, terminal decisions through
  the primitives and through raw UPDATEs on the owner connection, the narrowed grants, and the
  decision dates stamped at approval and frozen afterwards on credit notes and receipt reversals),
  `tests/db/inv-counter-sales-and-returns.test.ts` (a withdrawn return credit no longer counts in the
  cumulative share), `tests/db/sal-finance-controls.test.ts` (the narrowed decision-column grant),
  `tests/db/foundation.test.ts` (routine inventory),
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census), and
  `tests/backend/od-finance-credit-decisions.test.ts` (the two operations end to end).
- **Rollback classification:** **ROLLBACK-SAFE WITH DATA NOTE** — the inverse is in the migration
  footer; it can run only while no credit note is withdrawn, because the previous state vocabulary
  has no such state.

---

## 1. Why this change request exists

A pending credit note could only be approved. The schema admitted `rejected`, but no primitive
reached it, so a duplicate or mistaken request stayed waiting for a second person forever (finance
review GAP-03). The Owner's decision D3: the requester may withdraw their own pending request; only
an authorised other person may reject one, with a reason; transitions are enforced by the server;
approved documents are never silently edited. The review of #486 also found that the runtime role
could still UPDATE an approved note's `issued_at` and an approved reversal's `reversed_at`, so either
date could be backdated after the decision.

## 2. The change

| Object                                                | Change                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.credit_notes`                                    | NEW nullable `decided_by`, `decided_at`, `decision_reason`; `ck_credit_notes_approval_state` widened to `withdrawn`; NEW CHECKs: decider only on a declined note, withdrawal by the requester, rejection by another person, a decision reason on a rejection only and never blank. |
| `sal.guard_credit_note_decision()`                    | NEW trigger function, now behind `tg_credit_notes_approval`: approval stamps approver, approval time and issue time; rejection needs another person, `sal.credit.manage` in the note's scope and a reason; withdrawal needs the requester; a decided note is frozen.               |
| `sal.withdraw_credit_note(uuid)`                      | NEW. The requester withdraws; idempotent for the requester; refuses anyone else and any decided state. `EXECUTE` to `app_runtime` only.                                                                                                                                            |
| `sal.reject_credit_note(uuid, text)`                  | NEW. Another person rejects with a reason; idempotent on a rejected note; refuses the requester and any other decided state. `EXECUTE` to `app_runtime` only.                                                                                                                      |
| `sal.approve_credit_note(uuid, uuid)`                 | Re-issued: no longer names `issued_at`, which the trigger stamps.                                                                                                                                                                                                                  |
| `sal.guard_dual_control_approval()`                   | Re-issued (receipt reversals only): stamps `reversed_at` at approval and freezes `approved_at` and `reversed_at` once decided.                                                                                                                                                     |
| `sal.approve_receipt_reversal(uuid, uuid)`            | Re-issued: no longer names `reversed_at`.                                                                                                                                                                                                                                          |
| `sal.request_return_credit_note(uuid, numeric, text)` | Re-issued: earlier returns count while their note is neither rejected nor withdrawn.                                                                                                                                                                                               |
| Grants                                                | `app_runtime`: `UPDATE (issued_at)` on `sal.credit_notes` and `UPDATE (reversed_at)` on `sal.receipt_reversals` REVOKED; `UPDATE (decision_reason)` on `sal.credit_notes` GRANTED.                                                                                                 |

Every function is `SECURITY INVOKER` with an empty `search_path`, and `EXECUTE` is revoked from
PUBLIC on each. The migration writes no row.

## 3. Measured effect

Measured on a database created empty (`CREATE DATABASE ... TEMPLATE template0`) in a throwaway
`postgres:17` container on a loopback port of its own, replayed through all 164 migrations and
seeded twice with `npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported `functions` 636 (was 633);
  `tables` 277, `policies` 803, `triggers` 633 and `security_definer` 0 did not move;
- `npm run validate:schema-inventory` reported `functions` 334 (was 331) over the seventeen RootLco
  schemas, the companion figure `functionCountDiscrepancyNote` records;
- `npm run validate:schema-inventory -- --hash-only` produced the schema hash recorded in
  `.github/ci-baselines/schema-baseline.json`;
- the database tests named above passed on a disposable database. This is a local measurement; the
  hosted migration-replay and database jobs re-prove it.

The acceptance database was not read or written by this change.

## 4. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 164, `schemaHash`,
`structuralTotals.functions` 636, `structuralTotalsNote164`, and the 633/331 -> 636/334 step in
`functionCountDiscrepancyNote`), the routine inventory in `tests/db/foundation.test.ts`, the P1-15
migration census, the decision-column grant in `tests/db/sal-finance-controls.test.ts`, the
classification registry `docs/database/sal-wty-rpt-personal-data-classification.json` (three new
columns), `docs/database/data-dictionary.md`, `docs/database/role-and-grant-standard.md` §5.10, and
the P1-27 migration-count records. `tests/db/shared-hardening.test.ts` does not move: its approved
surface covers the `iam` and `shared` schemas, and every new function is in `sal`.
