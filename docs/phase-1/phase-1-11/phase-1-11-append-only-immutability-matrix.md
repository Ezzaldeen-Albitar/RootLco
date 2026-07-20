# Phase 1-11 — Append-Only / Immutability Matrix

Every one of the 27 tables is classified by its mutability contract. Deletion is a
soft-delete UPDATE — **no application role holds DELETE on any P1-11 table**, including the
user-owned `rpt.saved_filters`, which an owner removes by soft-delete (UPDATE
`deleted_at`); the append-only ledgers have no soft-delete at all. "Frozen" means
content-immutable once the gating status is reached. Introspected from the live triggers,
grants, and CHECKs.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

## Append-only ledgers — SELECT + INSERT only (6)

No UPDATE/DELETE grant; server-stamped on INSERT.

- `sal.invoice_status_history` — `shared.stamp_status_history` (actor/occurred_at/seq).
- `sal.delivery_status_history` — server-stamped.
- `wty.warranty_status_history` — server-stamped.
- `sal.payment_allocations` — receipt→invoice; whole-row finance-gated; monotonic `seq`.
- `sal.financial_events` — **immutable** (SELECT+INSERT, `seq bigint GENERATED ALWAYS`),
  single-use `UNIQUE(tenant, source_type, source_id, event_type)`, provenance-guarded.
- `sal.delivery_signatures` — append-only; binds an immutable `shared.document_versions`
  sha256; delivery-gated.

(Five of the six append-only ledgers are `sal`; `wty.warranty_status_history` is the sixth.)

## Immutable-after-issue / approval (4)

- `sal.invoices` — `guard_invoice_freeze`: once `status <> 'draft'`, `invoice_number`,
  `issued_at`, `currency_code`, `work_order_id`, `quotation_revision_id` are frozen; status
  advances forward only (`draft→issued→credited`; `draft→void_before_issue`).
- `sal.invoice_lines` + `sal.invoice_line_amounts` — `guard_invoice_line_frozen` /
  `guard_invoice_line_amount_frozen`: frozen once the parent invoice is issued.
- `sal.credit_notes` — immutable once `approval_state='approved'`
  (`guard_dual_control_approval`; `ck_credit_notes_approved_shape`).
- `wty.warranty_records` — `guard_warranty_record_freeze`: frozen after issue.

## Freeze-on-record / freeze-on-deliver (3)

- `sal.receipts` — `guard_receipt_freeze`: once the `receipt_recorded` event exists or
  `status ≠ 'recorded'`, `amount`/`currency_code`/`payment_method_id`/`payer_partner_id`/
  `received_at` are immutable (H-fin-4); corrections via reversal only.
- `sal.receipt_reversals` — immutable once approved (`ck_receipt_reversals_approved_shape`).
- `sal.delivery_checklist_results` + `sal.delivery_records` — checklist results and the
  delivery record freeze once `status='delivered'` (L-dlv-1; `ck_delivery_records_delivered_shape`).

## Correction-linked (never destructive) (2)

- `sal.credit_notes` — reduces open receivable via a linked record; original invoice
  retained.
- `sal.receipt_reversals` — full-receipt reversal; the original receipt is retained
  (`original_receipt_id` FK), never deleted; at most one reversal per receipt.

## Effective-dated / versioned config (3)

- `wty.warranty_coverage` — effective-dated; gist `EXCLUDE` no-overlap on active coverage.
- `sal.invoice_numbering_configs` — one active config per company.
- `rpt.report_configuration_versions` — monotonic; published version immutable
  (`guard_report_version_freeze`).

## User-owned mutable (1)

- `rpt.saved_filters` — owner-only RLS (SELECT/INSERT/UPDATE); removal is soft-delete only
  (**no DELETE grant**); `owner_user_id` immutable (not reassignable).

## Mutable master / config, with immutable anchors (rest)

Soft-deletable masters/config updated in place subject to immutable-column guards
(identity codes, scope, and audit anchors frozen): `sal.payment_methods` (immutable
`scope`/`tenant_id`, dual-scope), `sal.invoice_numbering_configs`,
`sal.delivery_checklist_templates`/`_template_items`, `sal.authorized_receivers`,
`wty.warranty_policies`, `wty.warranty_record_items`, `rpt.report_configurations`.

## Additive-forward backstop (outside the 27)

`rec.custody_history` (a P1-8 table) gains `uq_custody_history_released` (partial unique on
`(reception_visit_id) WHERE to_state='released'`) — the exactly-once custody-release fact
(C1), added additively like P1-10's `wo` forward FKs. A prototyped BEFORE INSERT delivery
gate (`rec.guard_custody_release_requires_delivery` / `tg_custody_history_delivery_gate`)
was **removed** — those objects no longer exist; the delivery gates are enforced inside
`sal.complete_delivery` and H-dlv-1 is an accepted residual.
