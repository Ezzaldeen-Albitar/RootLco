# Phase 1-11 — Allocation Locking Contract

**Requirement:** FR-SAL-003, BR-SAL-002 (Σ allocations + unallocated = receipt), P1-11-DB-006,
§17-3 / H-fin-2. Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the
Solo Developer Review Policy and the Standing Technical Authorization Policy — not an
independent third-party review.

## Append-only allocations, no editable balance

`sal.payment_allocations` is an **append-only** ledger (SELECT+INSERT only; whole-row gated by
`sal.finance.view`): `receipt_id` and `invoice_id` (composite scoped FKs forcing the
**same branch** for receipt and invoice, M-fin-5), `currency_code`, `amount NUMERIC(18,4)`
(>0, **restricted**), `allocated_by`, `allocated_at`, monotonic `seq`. There is **no editable
balance column** anywhere — receipt-unallocated and invoice-open are derived.

## Fixed lock order (deadlock-free)

`sal.allocate_receipt(p_receipt_id, p_invoice_id, p_amount, p_correlation_id)` (SECURITY
INVOKER, `app_runtime`) locks the **receipt row then the invoice row** `FOR UPDATE` — one
global lock order (receipts by id → invoices by id, H-fin-2) that prevents deadlock across
concurrent allocations, credits, and reversals. Under the lock it enforces:

- `amount ≤ sal.receipt_unallocated(receipt)` (derived: receipt amount − Σ active allocations,
  reversed receipts excluded);
- `amount ≤ sal.invoice_open_receivable(invoice)` (derived, incl. credits/reversals);
- `receipt.currency = invoice.currency = allocation.currency`;

then inserts the allocation and emits one `payment_allocated` financial event
(`tg_payment_allocations_event_completeness` forces it, H-fin-3).

## Invariant (BR-SAL-002)

`Σ active allocations + unallocated = receipt amount`. Concurrent allocations to one receipt
**cannot overspend** it, and concurrent allocations to one invoice **cannot overpay** it —
proven by ×5 race tests. The loser of a genuine race gets a deterministic error, not a
corrupt balance.

**Tests:** `sal-allocation-concurrency`, `sal-payment`.
