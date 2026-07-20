# P1-30 / P1-31 (Frontend) Data Contract

Phase 1-11 is database-only. This document records the read-model expectations the Phase 1-30
(billing/payments) and Phase 1-31 (delivery, warranty, reporting) frontends inherit, against
approved prototypes (OIR-06). **No UI is implemented in this phase.**

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
Policy and the Standing Technical Authorization Policy — not an independent third-party review.

## Read models the frontend consumes

| Screen area             | Source                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Invoice header + status | `sal.invoices` (structural: number/status/dates) + `sal.invoice_amounts` (amounts, finance-gated)    |
| Invoice lines           | `sal.invoice_lines` (structural) + `sal.invoice_line_amounts` (amounts + payer split, finance-gated) |
| Payments / receipts     | `sal.receipts`, `sal.payment_allocations` (finance-gated)                                            |
| Outstanding balance     | `sal.invoice_open_receivable` / `sal.partner_outstanding_balance` (derivations)                      |
| Corrections             | `sal.credit_notes`, `sal.receipt_reversals` (finance-gated)                                          |
| Delivery / custody      | `sal.delivery_records`, `_checklist_results`, `_status_history`; receiver/signature (delivery-gated) |
| Warranty                | `wty.warranty_records`, `_record_items`, `_status_history`, `wty.warranty_coverage`                  |
| Reporting               | `rpt.report_configurations`, `_versions`, `rpt.saved_filters` (owner-only)                           |

## Permission-shaped UI

- A non-finance role (**no `sal.finance.view`**) sees invoices/lines **exist** with their status
  and dates, but **no amounts** — the restricted amount tables and the finance-gated tables return
  no rows. The UI must render amount areas as unavailable, not zero.
- A role without `sal.delivery.view` sees deliveries but not receiver identity evidence or
  signature references.
- Saved filters are visible only to their owner; the UI must not attempt to list another user's
  filters.

## Money serialization (FR-SAL-002)

The database stores canonical `NUMERIC(18,4)`; money serialization/formatting for display is a
backend/frontend concern (FR-SAL-002), applied at the API layer over the canonical value. The
frontend must not round or reformat amounts in a way that diverges from the stored NUMERIC.

## Optimistic concurrency

Every mutable master carries `record_version` (bumped by `shared.touch_row_metadata`); the
frontend passes it back so a stale edit is rejected. Append-only ledgers and issued/immutable
records are read-only in the UI.
