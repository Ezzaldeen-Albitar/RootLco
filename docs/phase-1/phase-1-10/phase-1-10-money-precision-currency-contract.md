# Phase 1-10 — Money Precision and Currency Contract

**Requirement:** financial precision standard (`database-architecture.md` §9),
P1-OD-007 (currency kept configurable). **Zero floating-point financial columns.**

## Precision

- **All monetary amounts are `NUMERIC(18,4)`** — `svc.price_rules.amount`,
  `svc.discount_rules.value`, `svc.pricing_approval_policies.threshold_value`, every
  `quo.quotation_revisions.captured_*`, every `quo.quotation_items.captured_*` money
  column, `inv.item_cost_details.standard_cost`,
  `inv.external_purchase_part_details.unit_cost`,
  `inv.stock_adjustment_details.value_impact`.
- **Quantities are `NUMERIC(12,3)`** (matching `wo.required_parts`) — movement,
  balance, reservation, issue/return, opening, and adjustment quantities.
- **Tax rates are `NUMERIC(9,6)` fractions** (reusing `org.tax_rates`;
  `quo.quotation_items.captured_tax_rate` is `0..1`).
- **No `real`/`double precision` anywhere** in `svc`/`quo`/`inv`. A CI precision scan
  fails the build on any float column or any money-named column that is not
  `numeric(18,4)`.

## Currency

Currency is a `currency_code text` column FK → `shared.currencies(code)` (ISO 4217,
already seeded). No free-text currency, no uuid currency, no invented default — each
company states its own base currency. Carriers: `price_lists`, `discount_rules`,
`pricing_approval_policies`, `quotations`, `quotation_revisions`, `quotation_items`,
and the three restricted cost tables.

## Currency coherence (H12)

- `svc.price_rules` has **no** own currency column — it inherits the currency of its
  `svc.price_lists` book; `svc.resolve_price` returns the book currency.
- `quo.guard_quotation_item` enforces `quotation_item.currency_code =
quotation_revisions.currency_code`; the revision and quotation carry an immutable
  shared `currency_code`.
- An `amount` discount must carry a currency (CHECK); a `percentage` discount must not.

## Exact reconciliation

Captured line totals reconcile exactly to captured revision totals by a per-line
round-then-sum identity, enforced by per-line CHECKs (`captured_tax_amount`,
`captured_line_total`) and the deferred `quo.guard_revision_totals` constraint
trigger. Repeated-decimal totals cannot drift because each line total is rounded to 4
decimals before summation.

**Tests:** the precision scan plus the `svc` pricing and `quo` capture suites in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
