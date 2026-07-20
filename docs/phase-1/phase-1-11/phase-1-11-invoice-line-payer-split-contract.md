# Phase 1-11 — Invoice Line & Payer-Split Contract

**Requirement:** FR-WTY-004 (one unambiguous payer allocation per line), BR-SAL-002 (header
reconcile), P1-11-DB-002. Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar
under the Solo Developer Review Policy and the Standing Technical Authorization Policy — not
an independent third-party review.

## Structural line + restricted money (H-priv-1)

`sal.invoice_lines` is a **structural** child: `line_number` (>=1, unique per invoice),
`line_type` CHECK IN `('service','part','fee')`, `quantity NUMERIC(12,3)` (>0), `tax_class_id`
(composite FK → `org.tax_classes`, nullable), `currency_code` (= header currency), and three
opaque nullable source refs (`source_service_line_id` → wo, `source_part_issue_id` → inv,
`source_quotation_item_id` → quo). It carries **no money column**.

All monetary values live in the restricted 1:1 `sal.invoice_line_amounts` (gated by
`sal.finance.view`): `unit_price`, `net_amount`, `tax_amount`, `gross_amount`,
`customer_pay_amount`, `warranty_pay_amount` — all `NUMERIC(18,4)`, all `>= 0`
(`ck_invoice_line_amounts_nonneg`). A non-finance role sees the line exists and its type/
quantity, but not any amount.

## Two enforced identities

- **Gross identity:** `ck_invoice_line_amounts_gross` — `gross_amount = round(net_amount +
tax_amount, 4)`.
- **Payer split (FR-WTY-004):** `ck_invoice_line_amounts_payer_split` — `customer_pay_amount
  - warranty_pay_amount = gross_amount`. Every line carries exactly one unambiguous payer
allocation; the Σ warranty-pay across lines drives the `warranty_split_recorded` financial
    event at issue (M-wty-3).

## Header reconciliation (BR-SAL-002)

`tg_invoice_line_amounts_reconcile` is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger
(`guard_invoice_totals_reconcile`) on `sal.invoice_line_amounts`: on any INSERT/UPDATE/DELETE
it re-asserts that `sal.invoice_amounts` (net/tax/gross) equals the round-then-sum of the
lines (L-fin-3, identical convention to `sal.issue_invoice`). `sal.invoice_amounts` itself
carries `ck_invoice_amounts_gross` (`gross_total = round(net_total + tax_total, 4)`).

## Freeze once issued

`guard_invoice_line_frozen` / `guard_invoice_line_amount_frozen` (BEFORE INSERT OR UPDATE):
lines and their amounts are frozen once the parent invoice is issued. Corrections are credit
notes, never edits.

**Tests:** `sal-invoice`.
