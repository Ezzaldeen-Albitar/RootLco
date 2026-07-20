# Phase 1-11 — Index Evidence

**127 indexes** across the 27 tables (introspected: `sal` 92, `wty` 22, `rpt` 13). Every
foreign key is covered by a non-partial index whose leading columns (as a set) equal the FK
columns; partial and gist uniques never count as FK cover, so a plain covering index
accompanies each. The repo FK-index-cover guard reports zero gaps and the duplicate-index
guard reports zero exact duplicates on `sal`/`wty`/`rpt`.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

## `sal`

| Table                               | Notable indexes (beyond the PK)                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoices`                          | `uq_..._scope_id`; `uq_..._number` partial `WHERE invoice_number IS NOT NULL`; `uq_..._work_order_active` partial `WHERE status<>'void_before_issue'`; `uq_..._idempotency` partial; `ix_..._work_order`; `ix_..._quotation_revision`; `ix_..._payer`; `ix_..._payer_status`; `ix_..._status`; `ix_..._currency` |
| `invoice_amounts`                   | `uq_..._invoice` partial (1:1); `ix_..._invoice` (non-partial FK cover)                                                                                                                                                                                                                                          |
| `invoice_lines`                     | `uq_..._scope_id`; `uq_..._number (…,invoice_id,line_number)`; `ix_..._invoice`; `ix_..._tax_class`; `ix_..._currency`                                                                                                                                                                                           |
| `invoice_line_amounts`              | `uq_..._line` partial (1:1); `ix_..._line`; `ix_..._invoice` (non-partial FK cover)                                                                                                                                                                                                                              |
| `invoice_numbering_configs`         | `uq_..._active` partial `WHERE status='active'`; `ix_..._company` (FK cover)                                                                                                                                                                                                                                     |
| `invoice_status_history`            | `ix_..._invoice (…,invoice_id,occurred_at DESC,seq DESC)`                                                                                                                                                                                                                                                        |
| `payment_methods`                   | `uq_..._scope_id`; `uq_..._platform_code (method_code)` partial; `uq_..._tenant_code` partial; `ix_..._tenant`                                                                                                                                                                                                   |
| `receipts`                          | `uq_..._scope_id`; `uq_..._number`; `uq_..._idempotency` partial; `ix_..._method`; `ix_..._payer`; `ix_..._payer_date (…,payer,received_at DESC)`; `ix_..._evidence`; `ix_..._currency`                                                                                                                          |
| `payment_allocations`               | `ix_..._receipt`; `ix_..._invoice`; `ix_..._currency` (all FK cover)                                                                                                                                                                                                                                             |
| `credit_notes`                      | `uq_..._scope_id`; `uq_..._idempotency` partial; `ix_..._invoice`; `ix_..._currency`                                                                                                                                                                                                                             |
| `receipt_reversals`                 | `uq_..._scope_id`; `uq_..._receipt (…,original_receipt_id)` (at-most-one); `uq_..._idempotency` partial; `ix_..._receipt`; `ix_..._currency`                                                                                                                                                                     |
| `financial_events`                  | `uq_..._source (tenant,source_type,source_id,event_type)` (single-use); `ix_..._source`; `ix_..._scope_time (…,occurred_at DESC,seq DESC)`; `ix_..._correlation`; `ix_..._currency`                                                                                                                              |
| `delivery_records`                  | `uq_..._scope_id`; `uq_..._work_order_active` partial `WHERE status<>'exception'`; `uq_..._idempotency` partial; `ix_..._work_order`; `ix_..._visit`; `ix_..._vehicle`; `ix_..._odometer`                                                                                                                        |
| `delivery_checklist_templates`      | `uq_..._scope_id`; `uq_..._code` partial; `ix_..._company`                                                                                                                                                                                                                                                       |
| `delivery_checklist_template_items` | `uq_..._scope_id`; `uq_..._code` partial; `ix_..._template`                                                                                                                                                                                                                                                      |
| `delivery_checklist_results`        | `uq_..._item (…,delivery_record_id,template_item_id)`; `ix_..._delivery`; `ix_..._item`                                                                                                                                                                                                                          |
| `authorized_receivers`              | `uq_..._delivery (…,delivery_record_id)` (one per delivery); `ix_..._delivery`; `ix_..._partner`; `ix_..._evidence`                                                                                                                                                                                              |
| `delivery_signatures`               | `ix_..._delivery`; `ix_..._document` (append-only; FK cover)                                                                                                                                                                                                                                                     |
| `delivery_status_history`           | `ix_..._delivery (…,delivery_record_id,occurred_at DESC,seq DESC)`                                                                                                                                                                                                                                               |

## `wty`

| Table                     | Notable indexes (beyond the PK)                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `warranty_policies`       | `uq_..._scope_id`; `uq_..._code` partial; `ix_..._company`                                                                                                                                                                                                                                     |
| `warranty_coverage`       | `uq_..._scope_id`; **gist** `ex_..._no_overlap (tenant,company,policy_id,covered_scope,daterange(effective_from,effective_to)) WHERE status='active'`; `ix_..._policy`                                                                                                                         |
| `warranty_records`        | `uq_..._scope_id`; `uq_..._idempotency` partial; **gist** `ex_..._no_overlap (tenant,vehicle_id,coverage_id,daterange(start_date,expiry_date)) WHERE status IN (issued,active)`; `ix_..._vehicle`; `ix_..._work_order`; `ix_..._delivery`; `ix_..._policy`; `ix_..._coverage`; `ix_..._expiry` |
| `warranty_record_items`   | `ix_..._record` (FK cover)                                                                                                                                                                                                                                                                     |
| `warranty_status_history` | `ix_..._record (…,warranty_record_id,occurred_at DESC,seq DESC)`                                                                                                                                                                                                                               |

## `rpt`

| Table                           | Notable indexes (beyond the PK)                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `report_configurations`         | `uq_..._id (tenant,id)`; `uq_..._code (tenant,report_code)` partial; `ix_..._owner`; `ix_..._permission`                             |
| `report_configuration_versions` | `uq_..._number (tenant,config,version_number)`; `uq_..._published (tenant,config) WHERE status='published'` partial; `ix_..._config` |
| `saved_filters`                 | `uq_..._name (tenant,owner_user_id,config,name)`; `ix_..._owner_report (tenant,owner_user_id,config)`; `ix_..._config`               |

## Query families (P1-11-DB-019)

- **Open receivable / unpaid invoices:** `ix_invoices_payer_status`, `ix_invoices_status`,
  `ix_payment_allocations_invoice`, `ix_credit_notes_invoice`, and the non-partial
  `uq_receipt_reversals_receipt` (which also covers the reversal→receipt FK) back the
  balance derivation.
- **Delivery-ready WOs:** `ix_delivery_records_work_order`/`_visit`/`_vehicle` +
  `uq_delivery_records_work_order_active`.
- **Warranty expiry:** `ix_warranty_records_expiry`, `ix_warranty_records_vehicle`.
- **Financial-event lookup:** `ix_financial_events_source`, `ix_financial_events_scope_time`,
  `ix_financial_events_correlation`.

Every FK is `ON DELETE RESTRICT` and covered; the two gist `EXCLUDE` indexes are the
warranty no-overlap backstops; `uq_custody_history_released` (on `rec.custody_history`) is
the additive-forward custody-release exactly-once backstop.
