# Phase 1-11 — Object Inventory

Introspected from the live catalog (PostgreSQL 17.6, fully migrated to P1-11). Counts:
**27 tables, 26 functions, 67 triggers, 75 policies, 127 indexes, 427 columns, 0
`SECURITY DEFINER`.**

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo
Developer Review Policy and the Standing Technical Authorization Policy — not an
independent third-party review.

## Tables

### `sal` — Billing / Payment / Delivery (19)

| Table                                   | Kind                                    | Purpose                                                                                              |
| --------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `sal.invoices`                          | branch-scoped master (structural)       | One live invoice per work order (`uq_invoices_work_order_active`); lifecycle-only `status` (M-fin-1) |
| `sal.invoice_amounts`                   | restricted 1:1 (`sal.finance.view`)     | Header net/tax/gross; `gross = round(net+tax,4)`; reconciled to lines (H-priv-1)                     |
| `sal.invoice_lines`                     | child (structural, frozen once issued)  | Service/part/fee lines; amounts in the restricted detail                                             |
| `sal.invoice_line_amounts`              | restricted 1:1 (`sal.finance.view`)     | Line money + `customer_pay + warranty_pay = gross` payer split (FR-WTY-004)                          |
| `sal.invoice_numbering_configs`         | per (tenant, company) config            | `mode` gapless/gapped (P1-OD-042); one active config per company                                     |
| `sal.invoice_status_history`            | append-only ledger (SELECT+INSERT)      | Lifecycle + derived payment milestones; server-stamped                                               |
| `sal.payment_methods`                   | dual-scope reference                    | Platform cash/card_terminal/bank_transfer + tenant rows; no gateway kinds                            |
| `sal.receipts`                          | branch-scoped (whole-row gated)         | Amount/method/payer/currency/time freeze once recorded (H-fin-4)                                     |
| `sal.payment_allocations`               | append-only ledger (whole-row gated)    | Receipt→invoice; `Σ active + unallocated = receipt` (BR-SAL-002)                                     |
| `sal.credit_notes`                      | correction master (whole-row gated)     | Invoice-linked; dual control; immutable once approved                                                |
| `sal.receipt_reversals`                 | correction master (whole-row gated)     | Full-receipt reversal; original retained; dual control                                               |
| `sal.financial_events`                  | immutable append-only (whole-row gated) | One event per financial command; provenance-guarded; no journal columns                              |
| `sal.delivery_records`                  | branch-scoped master                    | One live delivery per WO; closes custody chain (BR-REC-001)                                          |
| `sal.delivery_checklist_templates`      | tenant config                           | Structural checklist template (no business seed)                                                     |
| `sal.delivery_checklist_template_items` | child config                            | `is_mandatory` blocks completion unless passed/waived                                                |
| `sal.delivery_checklist_results`        | per-delivery result (frozen once done)  | `passed`/`failed`/`waived` (+ reason); mandatory gate (L-dlv-1)                                      |
| `sal.authorized_receivers`              | verified receiver (`sal.delivery.view`) | Active reception party role for the visit (M-dlv-2); identity evidence restricted                    |
| `sal.delivery_signatures`               | append-only (`sal.delivery.view`)       | Binds an immutable `shared.document_versions` sha256                                                 |
| `sal.delivery_status_history`           | append-only ledger (SELECT+INSERT)      | Delivery lifecycle; server-stamped                                                                   |

### `wty` — Warranty (5)

| Table                         | Kind                               | Purpose                                                               |
| ----------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `wty.warranty_policies`       | tenant/company master              | Policy identity; terms live in effective-dated coverage               |
| `wty.warranty_coverage`       | effective-dated config             | Gist EXCLUDE no-overlap on active coverage (BR-WTY-001)               |
| `wty.warranty_records`        | branch-scoped (immutable at issue) | Bound to the delivery (M-wty-2); no overlapping live record (M-wty-1) |
| `wty.warranty_record_items`   | child                              | Covered jobs/parts with source links (FR-WTY-002)                     |
| `wty.warranty_status_history` | append-only ledger (SELECT+INSERT) | issued/active/expired/voided/claimed_against (FR-WTY-003)             |

### `rpt` — Reporting configuration (3)

| Table                               | Kind                         | Purpose                                                              |
| ----------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `rpt.report_configurations`         | tenant-scoped master         | `report_code`, `scope_level`, `export_permission_code`; versioned    |
| `rpt.report_configuration_versions` | versioned (published frozen) | Monotonic version; one published version per config (partial unique) |
| `rpt.saved_filters`                 | user-owned mutable           | Owner-only RLS; `scope_level ≤ report scope` (BR-RPT-001)            |

## Functions (26)

All 26 functions are `SECURITY INVOKER` with `SET search_path = ''` and `REVOKE EXECUTE
FROM PUBLIC`; **none is `SECURITY DEFINER`** (repo-wide prohibition). Because no write
path hides behind a privileged role, integrity is enforced by constraints, triggers,
provenance/coherence guards, and in-lock derivation — not by a privilege boundary.

### `sal` (21)

- **App-runtime primitives (`GRANT EXECUTE TO app_runtime`):** `issue_invoice(uuid,
uuid)`, `record_receipt(uuid, uuid, uuid, uuid, text, numeric, uuid, text, uuid)`,
  `allocate_receipt(uuid, uuid, numeric, uuid)`, `approve_credit_note(uuid, uuid)`,
  `approve_receipt_reversal(uuid, uuid)`, `complete_delivery(uuid, numeric, text, uuid)`.
- **Derivation (`GRANT EXECUTE TO app_runtime, app_readonly`):**
  `invoice_open_receivable(uuid)`, `partner_outstanding_balance(uuid)`,
  `receipt_unallocated(uuid)` — never stored; derived under `FOR UPDATE` on the invoice
  row for the consumers that mutate.
- **Guards / stampers (no grant — run only as triggers):** `guard_invoice_freeze`
  (also BEFORE INSERT — a new invoice must be born `status='draft'`; number/issued status
  appear only at the draft→issued transition, H-3),
  `guard_invoice_amount_frozen` (freezes header `net_total`/`tax_total`/`gross_total` once
  the parent invoice leaves draft, symmetric to the line-amount freeze, H-2),
  `guard_invoice_line_frozen`, `guard_invoice_line_amount_frozen` (also raises 23503 when a
  line-amount's `invoice_id` does not match its parent line's invoice, L-fin-4),
  `guard_invoice_totals_reconcile` (deferred constraint trigger), `guard_receipt_freeze`
  (a receipt may reach `reversed` only when an approved `receipt_reversals` row exists, H-1),
  `guard_dual_control_approval`, `stamp_dual_control_maker`, `guard_event_completeness`
  (deferred constraint trigger), `guard_financial_event_provenance`,
  `guard_delivery_coherence`, `guard_authorized_receiver`.

### `wty` (3)

- **Primitive:** `issue_warranty(uuid, uuid, uuid, text)` → `app_runtime`.
- **Guards:** `guard_warranty_record_freeze` (issued record frozen);
  `guard_warranty_record_coherence` (BEFORE INSERT — the referenced delivery must be
  `status='delivered'` and its `vehicle_id`/`work_order_id` must match the record, M-wty-2).

### `rpt` (2)

- **Guards:** `guard_report_version_freeze` (published version immutable),
  `guard_saved_filter_scope` (scope_level ≤ report scope, owner pin).

> **Additive-forward object on `rec` (not in the 26-count, like P1-10's `wo` forward
> FKs):** the partial unique `uq_custody_history_released` on
> `rec.custody_history(reception_visit_id) WHERE to_state='released'` — the exactly-once
> custody-release backstop (C1). A rec-forward `BEFORE INSERT` delivery gate
> (`rec.guard_custody_release_requires_delivery` / `tg_custody_history_delivery_gate`) was
> prototyped but **removed** — those objects no longer exist. The delivery gates are
> enforced inside `sal.complete_delivery`; a raw custody-release INSERT produces no
> delivery/warranty/invoice, so H-dlv-1 is an **accepted residual** (see
> [phase-1-11-review-response.md](phase-1-11-review-response.md)).

## Triggers (67)

Every table carries the standard set — `BEFORE UPDATE shared.touch_row_metadata` on
mutable tables and `org.guard_immutable_columns(...)` immutable-column guards — plus the
domain-specific guards above. Append-only ledgers (`invoice_status_history`,
`delivery_status_history`, `warranty_status_history`) carry a `BEFORE INSERT
shared.stamp_status_history` server-stamp. Financial completeness is enforced by five
`DEFERRABLE INITIALLY DEFERRED` **constraint triggers** (`tg_invoices_event_completeness`,
`tg_receipts_event_completeness`, `tg_payment_allocations_event_completeness`,
`tg_credit_notes_event_completeness`, `tg_receipt_reversals_event_completeness`) that make
the matching `financial_events` row a commit-time constraint (H-fin-3); line/header
reconciliation is a sixth deferred constraint trigger
(`tg_invoice_line_amounts_reconcile`). `financial_events` carries the BEFORE INSERT
`tg_financial_events_provenance`; the dual-control masters carry a BEFORE INSERT maker
stamp + a BEFORE UPDATE approval guard. Two final red-team (PART S) freeze/coherence
triggers close raw-DML gaps: `tg_invoice_amounts_frozen` on `sal.invoice_amounts` freezes
the header `net_total`/`tax_total`/`gross_total` once the parent invoice leaves draft
(H-2), and `tg_warranty_records_coherence` (BEFORE INSERT) on `wty.warranty_records`
requires the referenced delivery to be `delivered` with matching `vehicle_id`/`work_order_id`
(M-wty-2).

## Policies (75)

Every table is `ENABLE` + `FORCE ROW LEVEL SECURITY`. Shapes: tenant-scoped
(`report_configurations`/`_versions`), branch-scoped business tables (add the
`allowed_company_ids()`/`allowed_branch_ids()` clause), the dual-scope `payment_methods`
reference (`scope='platform' OR tenant_id=current` for SELECT, tenant-only write), the
**finance-gated** tables (`AND iam.has_permission('sal.finance.view')` on `receipts`,
`payment_allocations`, `credit_notes`, `receipt_reversals`, `financial_events`,
`invoice_amounts`, `invoice_line_amounts`), the **delivery-gated** tables
(`authorized_receivers`/`delivery_signatures`, `sal.delivery.view` on SELECT), and the
owner-only `saved_filters` (`owner_user_id = iam.current_user_id()` in USING and WITH
CHECK on SELECT/INSERT/UPDATE; removal is soft-delete only, **no DELETE grant**).
Append-only ledgers carry SELECT+INSERT policies only. See
[phase-1-11-rls-matrix.md](phase-1-11-rls-matrix.md).

## Indexes (127)

`sal` 94, `wty` 22, `rpt` 13. Every foreign key is covered by a non-partial index whose
leading columns (as a set) equal the FK columns; partial/gist uniques never count as FK
cover. Notable specialised indexes: the two **gist** no-overlap indexes
(`ex_warranty_coverage_no_overlap` on active coverage, `ex_warranty_records_no_overlap`
on live records); the single-use financial-event `uq_financial_events_source`; the
one-live partial uniques `uq_invoices_work_order_active` and
`uq_delivery_records_work_order_active`; the number-iff-issued unique `uq_invoices_number`
(partial); the four idempotency partial uniques; and the additive-forward
`uq_custody_history_released` on `rec.custody_history`. See
[phase-1-11-index-evidence.md](phase-1-11-index-evidence.md).

## Migrations (7, forward-only)

| Migration                      | Summary                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…090000_salwtyrpt_schemas`    | Reserve `sal`/`wty`/`rpt` module schemas; USAGE grants; additive `rec.custody_history` exactly-once release backstop (`uq_custody_history_released`, C1) |
| `…091000_sal_invoices`         | Invoices + restricted `invoice_amounts`; lines + restricted `invoice_line_amounts`; numbering configs; status history; `issue_invoice`                   |
| `…092000_sal_payments`         | Payment methods; receipts; allocations; `record_receipt`, `allocate_receipt`; derivation functions                                                       |
| `…093000_sal_financial_events` | Immutable `financial_events` (provenance + single-use + completeness); credit notes / receipt reversals; `approve_*`                                     |
| `…094000_sal_delivery`         | Delivery records; checklist templates/items/results; authorized receivers; signatures; status history; `complete_delivery`                               |
| `…095000_wty_warranty`         | Warranty policies; effective-dated coverage (gist EXCLUDE); records + items; status history; `issue_warranty`                                            |
| `…096000_rpt_reporting`        | Report configurations + versions (published-immutable); user-owned saved filters                                                                         |
