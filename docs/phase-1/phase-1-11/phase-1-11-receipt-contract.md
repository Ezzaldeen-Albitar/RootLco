# Phase 1-11 — Receipt Contract

**Requirement:** FR-SAL-003 (payment recording), P1-11-DB-005, H-fin-4 (receipt freeze).
Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent third-party
review.

## Branch-scoped, whole-row finance-gated

`sal.receipts` is branch-scoped and **whole-row gated** by `iam.has_permission('sal.finance.
view')` (H-priv-1) — a role without finance permission sees no receipt row. Columns:
`receipt_number` (via `shared.next_display_number`; `uq_receipts_number`), `payment_method_id`
(composite FK → `sal.payment_methods`), `payer_partner_id` (→ `crm.business_partners`),
`currency_code` (→ `shared.currencies`), `amount NUMERIC(18,4)` (>0, **restricted**),
`received_by`, `received_at`, `evidence_document_version_id` (→ `shared.document_versions`,
nullable), `status`, `idempotency_key`.

## Recording (`sal.record_receipt`)

`sal.record_receipt(p_company_id, p_branch_id, p_method_id, p_payer_partner_id,
p_currency_code, p_amount, p_evidence_document_version_id, p_idempotency_key,
p_correlation_id)` (SECURITY INVOKER, `app_runtime`) inserts the receipt, emits one
`financial_events` row (`receipt_recorded`, amount bound to the receipt), and is idempotent
by `uq_receipts_idempotency`. The completeness constraint trigger
`tg_receipts_event_completeness` forces the event to exist in the same transaction (H-fin-3).

## Freeze once recorded (H-fin-4)

`sal.guard_receipt_freeze` (BEFORE UPDATE): once the `receipt_recorded` event exists or
`status ≠ 'recorded'`, `amount`, `currency_code`, `payment_method_id`, `payer_partner_id`, and
`received_at` are immutable. **Corrections are receipt reversals only** — there is no path to
edit a recorded receipt's amount.

## Status lifecycle

`status` CHECK IN `('recorded','partially_allocated','allocated','reversed')`. Allocation
advances `recorded → partially_allocated → allocated` (derived from
`sal.payment_allocations`); a full reversal flips to `'reversed'` (H-fin-1), after which the
receipt's allocations are excluded from the outstanding-balance derivation. Append-only in
spirit; the receipt row is retained on reversal.

**Tests:** `sal-payment`, `sal-credit-reversal`.
