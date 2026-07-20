# Phase 1-11 — Invoice Identity & Issue Contract

**Requirement:** FR-SAL-001 (invoice issued exactly once per billable work order),
P1-11-DB-001/004. Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under
the Solo Developer Review Policy and the Standing Technical Authorization Policy — not an
independent third-party review.

## One billable invoice per approved source

`sal.invoices` is a branch-scoped **structural** master (money lives in the restricted 1:1
`sal.invoice_amounts`, H-priv-1). Identity/provenance columns: `work_order_id` (composite
FK → `wo.work_orders(...)` RESTRICT), `quotation_revision_id` (composite FK →
`quo.quotation_revisions(...)` RESTRICT, nullable — provenance only), `payer_partner_id`
(→ `crm.business_partners`), `currency_code` (→ `shared.currencies`).

- **At most one live invoice per WO:** `uq_invoices_work_order_active UNIQUE(tenant_id,
company_id, branch_id, work_order_id) WHERE status <> 'void_before_issue' AND deleted_at
IS NULL`. Staged/progress billing is **not** in scope; the quotation-revision binding is
  captured for provenance, not to permit a second invoice. A cross-scope WO/revision FK is
  rejected (`23503`).

## Lifecycle-only status (M-fin-1)

`status` CHECK IN `('draft','issued','credited','void_before_issue')` — **lifecycle only.**
`partially_paid`/`paid` are **derived** from the balance (never stored), so a stored 'paid'
can never contradict a reversal-restored balance. Payment milestones may still be recorded
in `sal.invoice_status_history` (whose CHECK allows the derived tokens). Status advances
forward only (`draft→issued→credited`; `draft→void_before_issue`) via `guard_invoice_freeze`.

## Issue is atomic (`sal.issue_invoice`)

`sal.issue_invoice(p_invoice_id uuid, p_correlation_id uuid)` (SECURITY INVOKER, granted to
`app_runtime`), under the parent lock:

1. resolves the active numbering config and allocates the invoice number (see
   [invoice-numbering-contract](phase-1-11-invoice-numbering-contract.md));
2. recomputes + verifies header totals from the immutable lines (`round(net+tax,4)`; RAISE
   `23514` on mismatch), and **forbids a zero-line issue** (L-fin-1);
3. sets `status='issued'`, `issued_at=now()`;
4. emits one `financial_events` row (`invoice_issued`, and `warranty_split_recorded` when
   Σ line `warranty_pay_amount` > 0, M-wty-3);
5. appends a `sal.invoice_status_history` row — all in one transaction.

## Immutability after issue

`guard_invoice_freeze` (BEFORE UPDATE): once `status <> 'draft'`, `invoice_number`,
`issued_at`, `currency_code`, `work_order_id`, `quotation_revision_id` are frozen (`23514`);
`ck_invoices_number_iff_issued` guarantees a number appears **only** at the atomic
draft→issued transition (H-fin-5). Lines freeze via `guard_invoice_line_frozen`.

**Tests:** `sal-invoice`, `sal-idempotency` in
[phase-1-11-test-catalog.md](phase-1-11-test-catalog.md).
