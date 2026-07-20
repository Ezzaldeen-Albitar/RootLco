# Phase 1-11 — Credit-Note Contract

**Requirement:** FR-SAL-004, CON-11, Table 3.10 (invoice credit/void), P1-11-DB-008,
P1-11-SEC-004 (dual control), H-fin-6. Owner-authorized technical self-review by Eng. Ezzaldeen
Al-Bitar under the Solo Developer Review Policy and the Standing Technical Authorization Policy
— not an independent third-party review.

## Invoice-linked, whole-row finance-gated

`sal.credit_notes` is invoice-linked (composite FK → `sal.invoices(...)` RESTRICT) and
whole-row gated by `sal.finance.view`: `amount NUMERIC(18,4)` (>0, **restricted**), `reason`,
`currency_code` (= invoice currency, M-fin-4), `approval_state`, `requested_by`, `approved_by`,
`approved_at`, `issued_at`, `idempotency_key`.

## Dual control (server-stamped, H-fin-6)

- `sal.stamp_dual_control_maker` (BEFORE INSERT) stamps `requested_by := iam.current_user_id()`
  — the maker is never client-supplied.
- `sal.approve_credit_note(p_credit_id, p_correlation_id)` (SECURITY INVOKER, `app_runtime`)
  stamps `approved_by := iam.current_user_id()` at approval via
  `sal.guard_dual_control_approval`.
- `ck_credit_notes_approved_distinct` — `approved_by <> requested_by` (self-approval rejected).
- `ck_credit_notes_approved_shape` — `approval_state='approved'` iff `approved_by`,
  `approved_at`, and `issued_at` are all set.

## Bounded and immutable

`approval_state` CHECK IN `('pending','approved','rejected')`. Under the invoice `FOR UPDATE`
lock (H-fin-2), `approve_credit_note` asserts `amount ≤ sal.invoice_open_receivable(invoice)`
at approval, then emits one `credit_note_issued` financial event
(`tg_credit_notes_event_completeness` forces it, H-fin-3). Once approved, the row is immutable
(`org.guard_immutable_columns` freezes `invoice_id`/`currency_code`/scope; the approval guard
blocks reversion). A credit **reduces** open receivable via a linked record — the original
invoice is retained, never edited or deleted.

**Tests:** `sal-credit-reversal`, `sal-derivation`.
