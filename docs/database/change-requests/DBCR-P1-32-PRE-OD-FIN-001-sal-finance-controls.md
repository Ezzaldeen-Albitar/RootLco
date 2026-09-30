# DBCR-P1-32-PRE-OD-FIN-001 — finance controls that need no business decision

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, finance controls ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It was authored from the read-only finance contract review of 2026-09-30; applying it to
any existing database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20260930090000_sal_finance_controls.sql` (the 162nd)
- **Seed change:** none. **Permission change:** none. **Policy change:** none.
- **Executable proof:** `tests/db/sal-finance-controls.test.ts` (frozen requests on both layers,
  currency guard, allocation key, active receipt currency), `tests/db/inv-counter-sales-and-returns.test.ts`
  (cumulative return credit), `tests/db/p1-22-protected-residuals.test.ts` (the credit-note half of
  residual SB1, now refused), `tests/db/foundation.test.ts` (routine and trigger inventories),
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census), and
  `tests/backend/od-finance-controls.test.ts` (the same controls through the route handlers, plus
  forced races of a credit approval against an allocation and of two approvals).
- **Rollback classification:** **ROLLBACK-SAFE WITH DATA NOTE** — the inverse is in the migration
  footer; allocation keys recorded after the migration are dropped with their column, and no
  amount depends on them.

---

## 1. Why this change request exists

The finance review found four database-level defects that need no business decision to correct:

| Finding | Defect                                                                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-01    | A pending credit note or receipt reversal could be rewritten before its decision: `app_runtime` held UPDATE on every column, and the approval guard compared the new approver with the new requester, so relabelling the requester and then approving as the original requester passed. |
| GAP-13  | A credit note's currency was compared with its invoice's only by the application.                                                                                                                                                                                                       |
| M-09    | An allocation had no business idempotency key, and a receipt could be recorded in a withdrawn currency.                                                                                                                                                                                 |
| GAP-05  | A partial return credited `round(line gross × q / qty, 4)` per return, so three returns of one unit on a three-unit line of 20.0000 credited 20.0001 and the last credit could never be approved.                                                                                       |

## 2. The change

| Object                                                | Change                                                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.guard_dual_control_request_frozen()`             | NEW trigger function; `tg_credit_notes_request_frozen`, `tg_receipt_reversals_request_frozen` refuse any change to the request's facts, in every state (`check_violation`). |
| `sal.guard_dual_control_approval()`                   | Re-issued: compares the approver with the STORED requester and refuses a changed requester.                                                                                 |
| `sal.credit_notes`, `sal.receipt_reversals`           | `app_runtime` UPDATE narrowed to the decision columns (see `role-and-grant-standard.md` §5.9).                                                                              |
| `sal.approve_credit_note(uuid, uuid)`                 | Re-issued: refuses the stored requester as approver, and compares the note's currency with the invoice's under the invoice lock.                                            |
| `sal.approve_receipt_reversal(uuid, uuid)`            | Re-issued: refuses the stored requester as approver.                                                                                                                        |
| `sal.guard_credit_note_currency()`                    | NEW; `tg_credit_notes_currency` BEFORE INSERT refuses a currency other than the invoice's.                                                                                  |
| `sal.payment_allocations.idempotency_key`             | NEW nullable column, unique per tenant (`uq_payment_allocations_idempotency`).                                                                                              |
| `sal.allocate_receipt`                                | Dropped and re-created with `p_idempotency_key text DEFAULT NULL`: a repeated key returns its allocation; a key reused for another receipt, invoice or amount is refused.   |
| `sal.guard_receipt_currency_active()`                 | NEW; `tg_receipts_currency_active` BEFORE INSERT refuses a currency that is not active in `shared.currencies`.                                                              |
| `sal.request_return_credit_note(uuid, numeric, text)` | Re-issued: credit = `round(gross × (returned before + q) / qty, 4)` − credits already raised for the line (notes not rejected).                                             |

Every function is `SECURITY INVOKER` with an empty `search_path`, and `EXECUTE` is revoked from
PUBLIC on each trigger function.

## 3. Measured effect

Measured on a database created empty in a throwaway `postgres:17-alpine` container, replayed
through all 162 migrations and seeded twice with `npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported `functions` 630 (was 627) and
  `triggers` 632 (was 628); `tables` 277, `policies` 803 and `security_definer` 0 did not move;
- `has_column_privilege('app_runtime', …, 'UPDATE')` is true for the decision columns only;
- each control was removed on that database in turn and the tests that name it failed, then the
  database was rebuilt from the migrations.

## 4. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 162, `schemaHash`,
`structuralTotals.functions` 630 and `.triggers` 632), the P1-15 migration census, the routine and
trigger inventories in `tests/db/foundation.test.ts`, the column registry
`docs/database/sal-wty-rpt-personal-data-classification.json`, `docs/database/role-and-grant-standard.md`
§5.9, the P1-27 migration-count records (`closure-record.md`, `clean-room-evidence.md`,
`deliverable-manifest.md`, `evidence/closing-value-ledger.json`), and the hostile-mutation target
`M-22-04` in `scripts/ci/hostile-mutations.mjs`, which follows the allocation statement's new fifth
parameter with its claim unchanged.
