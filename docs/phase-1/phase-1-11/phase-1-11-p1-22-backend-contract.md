# P1-22 (Backend) Data Contract

Phase 1-11 is database-only. This document records the database primitives the Phase 1-22
Billing / Payment / Delivery / Warranty backend will orchestrate, and the outbox event
contracts it will publish. **No backend or API is implemented in this phase.**

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
Policy and the Standing Technical Authorization Policy — not an independent third-party review.

## Database primitives P1-22 will call

All are `SECURITY INVOKER`, granted to `app_runtime`; they run under the caller's RLS and cannot
bypass tenant/branch or finance/delivery gates.

| Operation                     | DB primitive                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Issue an invoice              | `sal.issue_invoice(p_invoice_id uuid, p_correlation_id uuid)` — number, totals verify, event, freeze |
| Record a receipt              | `sal.record_receipt(company, branch, method, payer, currency, amount, evidence, idem, correlation)`  |
| Allocate a receipt to invoice | `sal.allocate_receipt(receipt, invoice, amount, correlation)` — receipt→invoice lock, bounds         |
| Approve a credit note         | `sal.approve_credit_note(credit, correlation)` — invoice lock, credit ≤ open, dual control           |
| Approve a receipt reversal    | `sal.approve_receipt_reversal(reversal, correlation)` — full-receipt, dual control                   |
| Complete a delivery           | `sal.complete_delivery(delivery, final_odometer_value, unit, correlation)` — gates + custody once    |
| Issue a warranty              | `wty.issue_warranty(delivery, policy, correlation, idem)` — bound to the delivery, immutable         |
| Derive open receivable        | `sal.invoice_open_receivable(invoice)` / `sal.partner_outstanding_balance(partner)` (read model)     |
| Derive receipt-unallocated    | `sal.receipt_unallocated(receipt)`                                                                   |

The database rejects impossible states directly (one live invoice per WO, number-iff-issued,
allocation bounds, maker≠approver, single-use provenance-guarded events, exactly-once custody
release, no-overlap warranty). Correctness invariants are **not** deferred to P1-22 — the backend
orchestrates workflow, authorization, and idempotency-key management on top of a DB that cannot be
driven into an inconsistent financial state even under concurrency.

## What P1-22 owns (not built here)

- Idempotency-Key request handling (the Phase 1-4 store) layered over the P1-11 unique business
  keys.
- Authorization checks beyond RLS (e.g. approver ↔ payer relationship).
- Incremental balance caching (the O(n) derivation residual).
- Full warranty **claim adjudication** (P1-OD-024) — only records + status history exist now.

## Outbox event contracts (documented, not implemented)

P1-22 will publish via the existing `shared.event_outbox` (Phase 1-5). Anticipated contracts:
`invoice.issued.v1` (EVT-SAL-001), `payment.recorded.v1`, `payment.allocated.v1`,
`credit-note.issued.v1`, `receipt.reversed.v1`, `delivery.completed.v1`,
`warranty.issued.v1`, and `warranty-claim.status.changed.v1` (EVT-WTY-001, if claims activate).
The `sal.financial_events` ledger and the append-only status histories are the source of truth
these events project from. No outbox producer is implemented in this phase.
