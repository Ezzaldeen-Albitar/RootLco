# P1-11 Structural Contract (Invoice / Billing)

Phase 1-11 builds invoicing and billing **on top of** the P1-10 commercial and stock
layer. This contract states what P1-11 may rely on and what it must not duplicate.
**Phase 1-10 creates no invoice/billing table**; billing amounts derive from the
captured quotation and the stock/service records.

## What P1-11 may reference

| Concept                           | Source                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Work order + scope                | `wo.work_orders(tenant_id, company_id, branch_id, id)`                         |
| Quotation                         | `quo.quotations(tenant_id, company_id, branch_id, id)`                         |
| Issued revision + captured totals | `quo.quotation_revisions` (`captured_subtotal`/`discount`/`tax`/`grand_total`) |
| Captured lines                    | `quo.quotation_items` (captured unit price/quantity/discount/tax/line-total)   |
| Item-level approvals              | `quo.approval_decisions` (approved/rejected per revision-item)                 |
| Service pricing (as-of)           | `svc.resolve_price(...)` and the captured `price_rule_ref`                     |
| Tax                               | `org.tax_classes`/`org.tax_rates` (captured on items)                          |
| Parts issued / returned           | `inv.part_issues` / `inv.part_returns`                                         |
| External purchases (+cost)        | `inv.external_purchase_parts` (+ restricted `..._details`, `inv.cost.view`)    |

## Prohibited duplication

P1-11 must **not** copy quotation, item, price, tax, or stock data into billing tables.
Those remain owned by `quo`/`svc`/`inv`; the invoice **references** them and reuses the
**captured** amounts so the invoice reproduces the quoted figures exactly. Currency and
precision follow the P1-10 standard (`NUMERIC(18,4)`, `shared.currencies`).

## Invoice numbering (P1-OD-042)

Invoice numbering is **P1-11's** decision (deferred here). P1-10 provides only
`quo.quotations.quotation_number` via `shared.next_display_number('quotation', …)`; no
invoice-number policy is invented in P1-10.

## Contract test

A P1-11 structural-contract test will assert the P1-10 commercial surface above remains
stable and that no invoice/billing table exists in P1-10.
