# Phase 1-11 — Outstanding-Balance Derivation Contract

**Requirement:** FR-SAL-003, P1-11-DB-007, TC-P1-11-004, §17-4. Owner-authorized technical
self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing
Technical Authorization Policy — not an independent third-party review.

## Derived, never stored

No table stores an editable balance. Open receivable is derived by two SECURITY INVOKER
functions (granted to `app_runtime` **and** `app_readonly`):

- `sal.invoice_open_receivable(p_invoice_id uuid)` — issued invoice gross (from
  `sal.invoice_amounts`) − Σ active allocations − Σ approved credit notes, with receipt
  reversals restoring receivable where an allocation's receipt is reversed.
- `sal.partner_outstanding_balance(p_partner_id uuid)` — the same, aggregated per payer partner.
- `sal.receipt_unallocated(p_receipt_id uuid)` — receipt amount − Σ active allocations (a
  reversed receipt has no remaining unallocated).

## Reversed-receipt exclusion (H-fin-1)

The derivation **excludes allocations of reversed receipts**: when a receipt's status is
`'reversed'`, its allocations no longer reduce the invoice's open receivable, so the receivable
is restored automatically without deleting the append-only allocation rows.

## Consumers take the invoice lock (H-fin-2)

Any consumer that then **mutates** based on the derived value (`sal.allocate_receipt`,
`sal.approve_credit_note`) takes `SELECT … FOR UPDATE` on the invoice row **before** deriving
and inserting, so a credit or allocation can never drive open receivable below zero under
concurrency. Read-only callers (reporting) use the functions without the lock.

## Correctness property

A property test (`sal-derivation`, TC-P1-11-004) compares the derivation to a fact-level
recomputation across randomized allocation / credit-note / receipt-reversal sequences; the two
always agree.

## Documented residual

The derivation is `O(n)` in the invoice's allocation/credit/reversal count. This is an
**accepted** performance residual (correctness over performance for a foundation phase);
incremental caching is deferred to the P1-22 backend.

**Tests:** `sal-derivation`.
