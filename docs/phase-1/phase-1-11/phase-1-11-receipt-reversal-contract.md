# Phase 1-11 — Receipt-Reversal Contract

**Requirement:** FR-SAL-004, CON-11, Table 3.10 (payment reversal), P1-11-DB-008,
P1-11-SEC-004, H-fin-1 / H-fin-6. Owner-authorized technical self-review by Eng. Ezzaldeen
Al-Bitar under the Solo Developer Review Policy and the Standing Technical Authorization Policy
— not an independent third-party review.

## Full-receipt reversal, original retained

`sal.receipt_reversals` links `original_receipt_id` (composite FK → `sal.receipts(...)`
RESTRICT) — the **original receipt is retained, never deleted**. Whole-row gated by
`sal.finance.view`. Columns: `amount NUMERIC(18,4)` (>0, **restricted**), `reason`,
`currency_code` (= receipt currency, M-fin-4), `approval_state`, `requested_by`,
`approved_by`, `approved_at`, `reversed_at`, `idempotency_key`.

- **Full-receipt only (H-fin-1):** partial reversal is out of scope (documented); `CHECK
receipt_reversals.amount = original receipt amount` (enforced in the approval primitive
  under the receipt lock).
- **At most one reversal per receipt:** `uq_receipt_reversals_receipt (tenant_id, company_id,
branch_id, original_receipt_id)`.

## Dual control + concurrency safe

`sal.stamp_dual_control_maker` stamps `requested_by`; `sal.approve_receipt_reversal(p_reversal_
id, p_correlation_id)` (SECURITY INVOKER, `app_runtime`) stamps `approved_by` and enforces
`ck_receipt_reversals_approved_distinct` (`approved_by <> requested_by`) and
`ck_receipt_reversals_approved_shape`. It row-locks the original receipt, verifies the amount,
flips `receipts.status → 'reversed'`, emits one `receipt_reversed` financial event
(`tg_receipt_reversals_event_completeness`, H-fin-3), and is concurrency-safe against a second
reversal (row-lock + at-most-one unique). No destructive update/delete.

## Effect on the balance

A reversed receipt's allocations are **excluded** from the outstanding-balance derivation
(H-fin-1), restoring the invoice's open receivable without mutating the append-only
`sal.payment_allocations` rows. See
[phase-1-11-outstanding-balance-derivation-contract.md](phase-1-11-outstanding-balance-derivation-contract.md).

**Tests:** `sal-credit-reversal`, `sal-derivation`.
