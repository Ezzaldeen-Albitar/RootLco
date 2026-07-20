# Phase 1-11 — Financial Precision & Currency Contract

**Requirement:** NFR-DAT-001, CON-10, P1-11-QA-005 (zero float money); acceptance criterion 4.
Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
Policy and the Standing Technical Authorization Policy — not an independent third-party review.

## Precision classes

- **Money** is `NUMERIC(18,4)` on every amount column: `invoice_amounts.{net_total, tax_total,
gross_total}`, `invoice_line_amounts.{unit_price, net_amount, tax_amount, gross_amount,
customer_pay_amount, warranty_pay_amount}`, `receipts.amount`, `payment_allocations.amount`,
  `credit_notes.amount`, `receipt_reversals.amount`, `financial_events.amount`.
- **Quantity** is `NUMERIC(12,3)` (`invoice_lines.quantity`).
- **Zero `real`/`double precision`** on any financial column — the CI money-precision scan
  asserts this across `sal`/`wty`/`rpt`.

## Currency

`currency_code text` is an FK → `shared.currencies(code)` RESTRICT on every currency-bearing
table (`invoices`, `invoice_lines`, `receipts`, `payment_allocations`, `credit_notes`,
`receipt_reversals`, `financial_events`). Coherence is enforced (M-fin-4):
`credit_note.currency = invoice.currency`, `receipt_reversal.currency = receipt.currency`, and an
allocation matches both the receipt and the invoice currency.

## Rounding convention (L-fin-3)

The gross identity is `round(net + tax, 4)`, applied identically by `ck_invoice_amounts_gross`,
`ck_invoice_line_amounts_gross`, `sal.issue_invoice`'s recompute, and the deferred reconciliation
trigger — one round-then-sum convention everywhere, so header and line totals never diverge by a
rounding artefact. A NUMERIC round-trip carries no float drift (`p1-11-rollback` precision scan).

## FK deletion posture

Every financial FK is `ON DELETE RESTRICT` (invoices, lines, receipts, allocations, credits,
reversals, financial events) — no cascade path can silently delete a financial fact.

**Tests:** `p1-11-rollback` (precision scan), `sal-invoice`, `sal-derivation`.
