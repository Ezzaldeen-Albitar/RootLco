# DBCR-P1-32-PRE-OD-FD1-001 — monetary line amounts at the currency's minor unit

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, finance decision D1 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements Owner decision D1 of 2026-09-30 as recorded in
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md); applying it to any existing
database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20260930100000_sal_minor_unit_rounding.sql` (the 163rd)
- **Seed change:** none. **Permission change:** none. **Policy change:** none.
- **Executable proof:** `tests/db/sal-minor-unit-rounding.test.ts` (the rounding rule, the
  quotation-line trigger, totals as sums of rounded lines, a stored line never re-validated, a
  sub-minor-unit draft refused at issue, and no row written by the migration),
  `tests/db/inv-counter-sales-and-returns.test.ts` (counter-sale tax and the cumulative return
  credit at the minor unit), `tests/db/foundation.test.ts` (routine and trigger inventories),
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census), and
  `tests/backend/od-finance-rounding.test.ts` (a JOD 16% line quoted, invoiced and paid to the fils
  through the route handlers).
- **Rollback classification:** **ROLLBACK-SAFE** — the inverse is in the migration footer. The two
  restored CHECK constraints are added `NOT VALID`, because a line written under the minor-unit rule
  does not satisfy the four-decimal expression and rewriting it is what this change refuses to do.

---

## 1. Why this change request exists

Every monetary column is `numeric(18,4)`, and line tax and totals were rounded to four decimals,
while a receipt, an allocation and a credit note must fit the currency's minor unit. A JOD line of
12.345 at 16% carried `round(12.345 × 0.16, 4) = 1.9752`: a residue of 0.0002 that no receipt and no
credit note could settle, holding the invoice open (finance review GAP-01). The Owner's decision D1
fixes the rule: per-line half-up rounding to the minor unit, totals as sums of rounded lines,
quantities, rates and unit prices at their own scales, issued snapshots preserved.

## 2. The change

| Object                                                                 | Change                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.round_to_minor_unit(numeric, text)`                            | NEW. Half-up (half away from zero) to the currency's `minor_unit`; `foreign_key_violation` for an unknown currency. `EXECUTE` to `app_runtime` only.                                               |
| `shared.fits_minor_unit(numeric, text)`                                | NEW. True when no non-zero digit sits below the minor unit. `EXECUTE` to `app_runtime` only.                                                                                                       |
| `quo.quotation_items`                                                  | `ck_quotation_items_tax_amount` and `ck_quotation_items_line_total` DROPPED (not re-validated); `tg_quotation_items_money` BEFORE INSERT OR UPDATE enforces the same arithmetic at the minor unit. |
| `quo.guard_quotation_item_money()`                                     | NEW trigger function. Line net and tax rounded to the minor unit, line total their sum, discount within the minor unit; an UPDATE that changes no money column is not re-validated.                |
| `quo.issue_revision(uuid, timestamptz)`                                | Re-issued: subtotal is the sum of each line's gross − tax + discount; a draft carrying a sub-minor-unit line is refused.                                                                           |
| `quo.guard_revision_totals()`                                          | Re-issued with the same subtotal, so the deferred identity checks what `issue_revision` writes.                                                                                                    |
| `sal.create_counter_sale_invoice(uuid, uuid, uuid, jsonb, text, uuid)` | Re-issued: each line's net and tax rounded to the sale currency's minor unit; gross = net + tax.                                                                                                   |
| `sal.request_return_credit_note(uuid, numeric, text)`                  | Re-issued: the cumulative share rounded to the minor unit; the return completing a line credits exactly what remains of its gross.                                                                 |

Every function is `SECURITY INVOKER` with an empty `search_path`, and `EXECUTE` is revoked from
PUBLIC on each. The migration's one `DO` block only reads: it counts draft quotation lines finer
than their currency's minor unit and raises a `NOTICE` when it finds any.

## 3. Measured effect

Measured on a database created empty in a throwaway `postgres:17-alpine` container on a loopback
port of its own, replayed through all 163 migrations and seeded twice with
`npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported `functions` 633 (was 630) and
  `triggers` 633 (was 632); `tables` 277, `policies` 803 and `security_definer` 0 did not move;
- `npm run validate:schema-inventory` reported `functions` 331 (was 328) over the seventeen RootLco
  schemas, the companion figure `functionCountDiscrepancyNote` records;
- `npm run validate:schema-inventory -- --hash-only` produced the schema hash recorded in
  `.github/ci-baselines/schema-baseline.json`;
- the database tests named above passed on that database. This is a local measurement; the hosted
  migration-replay and database jobs re-prove it.

The acceptance database was not read or written by this change.

## 4. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 163, `schemaHash`,
`structuralTotals.functions` 633 and `.triggers` 633, `structuralTotalsNote163`, and the 630/328 ->
633/331 step in `functionCountDiscrepancyNote`), the approved `app_runtime` iam/shared function
surface in `tests/db/shared-hardening.test.ts` (the two helpers are granted because the invoker
trigger and routines above call them as the caller), the P1-15
migration census, the routine and trigger inventories in `tests/db/foundation.test.ts`, and the
P1-27 migration-count records.
