# Phase 1-11 — Data Dictionary (`sal`)

Column-level dictionary for the 19 `sal` tables (billing, payments, credit/reversal, financial events, delivery). Money is `NUMERIC(18,4)`; quantity `NUMERIC(12,3)`; all money/identity-evidence columns are `restricted` and physically isolated in RLS-gated tables. All 14 restricted amount columns gate on `sal.finance.view`; the 2 restricted delivery evidence columns gate on `sal.delivery.view`. Every FK is `ON DELETE RESTRICT`.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo
Developer Review Policy and the Standing Technical Authorization Policy — not an
independent third-party review. Generated from live introspection; classification from
`docs/database/sal-wty-rpt-personal-data-classification.json`. `class` is the column
classification (`internal`/`restricted`); **restricted** columns are physically isolated
in RLS-gated tables and are never searchable.

## `sal.authorized_receivers`

Verified authorized receiver (WHOLE ROW gated by `sal.delivery.view`).

| Column                                  | Type          | class      | Null? | Purpose                                                                                                                  |
| --------------------------------------- | ------------- | ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`                                    | `uuid`        | internal   | no    | Primary key (UUID).                                                                                                      |
| `tenant_id`                             | `uuid`        | internal   | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                                          |
| `company_id`                            | `uuid`        | internal   | no    | Company scope (branch composite scope).                                                                                  |
| `branch_id`                             | `uuid`        | internal   | no    | Branch scope (branch composite scope).                                                                                   |
| `delivery_record_id`                    | `uuid`        | internal   | no    | Composite FK -> `sal.delivery_records(...)` RESTRICT; one receiver per delivery (unique).                                |
| `receiver_partner_id`                   | `uuid`        | internal   | no    | Receiver; composite FK -> `crm.business_partners(tenant_id, id)` RESTRICT; validated vs reception party roles (M-dlv-2). |
| `identity_evidence_document_version_id` | `uuid`        | restricted | yes   | RESTRICTED identity evidence; composite FK -> `shared.document_versions(tenant_id, id)` (gated by `sal.delivery.view`).  |
| `verified_by`                           | `uuid`        | internal   | no    | Verifying actor.                                                                                                         |
| `verified_at`                           | `timestamptz` | internal   | no    | Verification time.                                                                                                       |
| `record_version`                        | `integer`     | internal   | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                                   |
| `created_at`                            | `timestamptz` | internal   | no    | Row creation timestamp.                                                                                                  |
| `created_by`                            | `uuid`        | internal   | no    | Creating actor (user id).                                                                                                |
| `updated_at`                            | `timestamptz` | internal   | yes   | Last-update timestamp (NULL until first update).                                                                         |
| `updated_by`                            | `uuid`        | internal   | yes   | Last-updating actor.                                                                                                     |
| `deleted_at`                            | `timestamptz` | internal   | yes   | Soft-delete timestamp (NULL = live).                                                                                     |
| `deleted_by`                            | `uuid`        | internal   | yes   | Soft-deleting actor.                                                                                                     |

## `sal.credit_notes`

Credit-note (invoice-linked, WHOLE ROW gated); dual control.

| Column            | Type            | class      | Null? | Purpose                                                                                                |
| ----------------- | --------------- | ---------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `id`              | `uuid`          | internal   | no    | Primary key (UUID).                                                                                    |
| `tenant_id`       | `uuid`          | internal   | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                        |
| `company_id`      | `uuid`          | internal   | no    | Company scope (branch composite scope).                                                                |
| `branch_id`       | `uuid`          | internal   | no    | Branch scope (branch composite scope).                                                                 |
| `invoice_id`      | `uuid`          | internal   | no    | Composite FK -> `sal.invoices(...)` RESTRICT.                                                          |
| `currency_code`   | `text`          | internal   | no    | ISO currency; FK -> `shared.currencies(code)` RESTRICT.                                                |
| `amount`          | `numeric(18,4)` | restricted | no    | RESTRICTED credit amount (>0); credit <= invoice open receivable at approval (under the invoice lock). |
| `reason`          | `text`          | internal   | no    | Free-text reason.                                                                                      |
| `approval_state`  | `text`          | internal   | no    | CHECK IN ('pending','approved','rejected'); immutable once approved.                                   |
| `requested_by`    | `uuid`          | internal   | no    | Maker; server-stamped `iam.current_user_id()` (H-fin-6).                                               |
| `approved_by`     | `uuid`          | internal   | yes   | Approver; server-stamped at approval; CHECK `approved_by <> requested_by`.                             |
| `approved_at`     | `timestamptz`   | internal   | yes   | Approval time (set with approval).                                                                     |
| `issued_at`       | `timestamptz`   | internal   | yes   | Issue time (set at approval).                                                                          |
| `idempotency_key` | `text`          | internal   | yes   | Business idempotency key; partial `UNIQUE(tenant_id, idempotency_key)` (BR-SAL-001).                   |
| `record_version`  | `integer`       | internal   | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                 |
| `created_at`      | `timestamptz`   | internal   | no    | Row creation timestamp.                                                                                |
| `created_by`      | `uuid`          | internal   | no    | Creating actor (user id).                                                                              |
| `updated_at`      | `timestamptz`   | internal   | yes   | Last-update timestamp (NULL until first update).                                                       |
| `updated_by`      | `uuid`          | internal   | yes   | Last-updating actor.                                                                                   |

## `sal.delivery_checklist_results`

Per-delivery checklist result.

| Column               | Type          | class    | Null? | Purpose                                                                                                                      |
| -------------------- | ------------- | -------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`        | internal | no    | Primary key (UUID).                                                                                                          |
| `tenant_id`          | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                                              |
| `company_id`         | `uuid`        | internal | no    | Company scope (branch composite scope).                                                                                      |
| `branch_id`          | `uuid`        | internal | no    | Branch scope (branch composite scope).                                                                                       |
| `delivery_record_id` | `uuid`        | internal | no    | Composite FK -> `sal.delivery_records(...)` RESTRICT.                                                                        |
| `template_item_id`   | `uuid`        | internal | no    | Composite FK -> `sal.delivery_checklist_template_items(tenant_id, company_id, id)` RESTRICT; one result per (delivery,item). |
| `outcome`            | `text`        | internal | no    | CHECK IN ('passed','failed','waived'); waived requires waiver_reason.                                                        |
| `waiver_reason`      | `text`        | internal | yes   | Required iff outcome='waived' (CHECK).                                                                                       |
| `recorded_by`        | `uuid`        | internal | no    | Recording actor.                                                                                                             |
| `record_version`     | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                                       |
| `created_at`         | `timestamptz` | internal | no    | Row creation timestamp.                                                                                                      |
| `created_by`         | `uuid`        | internal | no    | Creating actor (user id).                                                                                                    |
| `updated_at`         | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                                                             |
| `updated_by`         | `uuid`        | internal | yes   | Last-updating actor.                                                                                                         |
| `deleted_at`         | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                                                         |
| `deleted_by`         | `uuid`        | internal | yes   | Soft-deleting actor.                                                                                                         |

## `sal.delivery_checklist_template_items`

Delivery checklist template item.

| Column           | Type          | class    | Null? | Purpose                                                                                 |
| ---------------- | ------------- | -------- | ----- | --------------------------------------------------------------------------------------- |
| `id`             | `uuid`        | internal | no    | Primary key (UUID).                                                                     |
| `tenant_id`      | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                         |
| `company_id`     | `uuid`        | internal | no    | Company scope (branch composite scope).                                                 |
| `template_id`    | `uuid`        | internal | no    | Composite FK -> `sal.delivery_checklist_templates(tenant_id, company_id, id)` RESTRICT. |
| `item_code`      | `text`        | internal | no    | Item code; `UNIQUE(tenant_id, template_id, item_code)`.                                 |
| `label`          | `text`        | internal | no    | Checklist item label.                                                                   |
| `is_mandatory`   | `boolean`     | internal | no    | When true, blocks completion unless passed/waived (L-dlv-1).                            |
| `sort_order`     | `integer`     | internal | no    | Display order.                                                                          |
| `record_version` | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                  |
| `created_at`     | `timestamptz` | internal | no    | Row creation timestamp.                                                                 |
| `created_by`     | `uuid`        | internal | no    | Creating actor (user id).                                                               |
| `updated_at`     | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                        |
| `updated_by`     | `uuid`        | internal | yes   | Last-updating actor.                                                                    |
| `deleted_at`     | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                    |
| `deleted_by`     | `uuid`        | internal | yes   | Soft-deleting actor.                                                                    |

## `sal.delivery_checklist_templates`

Tenant-configurable delivery checklist template.

| Column           | Type          | class    | Null? | Purpose                                                                |
| ---------------- | ------------- | -------- | ----- | ---------------------------------------------------------------------- |
| `id`             | `uuid`        | internal | no    | Primary key (UUID).                                                    |
| `tenant_id`      | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                        |
| `company_id`     | `uuid`        | internal | no    | Company scope (branch composite scope).                                |
| `template_code`  | `text`        | internal | no    | Template code; `UNIQUE(tenant_id, company_id, template_code)`.         |
| `name`           | `text`        | internal | no    | Human-readable name.                                                   |
| `status`         | `text`        | internal | no    | CHECK IN ('active','inactive').                                        |
| `record_version` | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`. |
| `created_at`     | `timestamptz` | internal | no    | Row creation timestamp.                                                |
| `created_by`     | `uuid`        | internal | no    | Creating actor (user id).                                              |
| `updated_at`     | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                       |
| `updated_by`     | `uuid`        | internal | yes   | Last-updating actor.                                                   |
| `deleted_at`     | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                   |
| `deleted_by`     | `uuid`        | internal | yes   | Soft-deleting actor.                                                   |

## `sal.delivery_records`

Delivery record (branch-scoped) closing the reception custody chain.

| Column                      | Type          | class    | Null? | Purpose                                                                                                                       |
| --------------------------- | ------------- | -------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `uuid`        | internal | no    | Primary key (UUID).                                                                                                           |
| `tenant_id`                 | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                                               |
| `company_id`                | `uuid`        | internal | no    | Company scope (branch composite scope).                                                                                       |
| `branch_id`                 | `uuid`        | internal | no    | Branch scope (branch composite scope).                                                                                        |
| `work_order_id`             | `uuid`        | internal | no    | Composite FK -> `wo.work_orders(...)` RESTRICT; one live delivery per WO (`uq_delivery_records_work_order_active`).           |
| `reception_visit_id`        | `uuid`        | internal | no    | Composite FK -> `rec.reception_visits(...)` RESTRICT; must match the WO (M-dlv-1).                                            |
| `vehicle_id`                | `uuid`        | internal | no    | Composite FK -> `veh.vehicles(tenant_id, id)` RESTRICT; must match the WO (M-dlv-1).                                          |
| `delivering_employee_id`    | `uuid`        | internal | no    | Delivering employee (user id).                                                                                                |
| `status`                    | `text`        | internal | no    | CHECK IN ('ready','receiver_verified','signed','delivered','exception'); delivered-shape CHECK binds delivered_at + odometer. |
| `delivered_at`              | `timestamptz` | internal | yes   | Delivery time; set at completion.                                                                                             |
| `final_odometer_reading_id` | `uuid`        | internal | yes   | Composite FK -> `veh.odometer_readings(tenant_id, vehicle_id, id)` RESTRICT (nullable until delivered).                       |
| `idempotency_key`           | `text`        | internal | yes   | Business idempotency key; partial `UNIQUE(tenant_id, idempotency_key)` (BR-SAL-001).                                          |
| `record_version`            | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                                        |
| `created_at`                | `timestamptz` | internal | no    | Row creation timestamp.                                                                                                       |
| `created_by`                | `uuid`        | internal | no    | Creating actor (user id).                                                                                                     |
| `updated_at`                | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                                                              |
| `updated_by`                | `uuid`        | internal | yes   | Last-updating actor.                                                                                                          |
| `deleted_at`                | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                                                          |
| `deleted_by`                | `uuid`        | internal | yes   | Soft-deleting actor.                                                                                                          |

## `sal.delivery_signatures`

Delivery signature (append-only, WHOLE ROW gated by `sal.delivery.view`).

| Column                          | Type          | class      | Null? | Purpose                                                                                                                                               |
| ------------------------------- | ------------- | ---------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                            | `uuid`        | internal   | no    | Primary key (UUID).                                                                                                                                   |
| `tenant_id`                     | `uuid`        | internal   | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                                                                       |
| `company_id`                    | `uuid`        | internal   | no    | Company scope (branch composite scope).                                                                                                               |
| `branch_id`                     | `uuid`        | internal   | no    | Branch scope (branch composite scope).                                                                                                                |
| `delivery_record_id`            | `uuid`        | internal   | no    | Composite FK -> `sal.delivery_records(...)` RESTRICT; append-only.                                                                                    |
| `signer_role`                   | `text`        | internal   | no    | CHECK IN ('receiver','delivering_employee','witness').                                                                                                |
| `signature_document_version_id` | `uuid`        | restricted | no    | RESTRICTED signature doc; composite FK -> `shared.document_versions(tenant_id, id)` (its sha256 anchors the signature; gated by `sal.delivery.view`). |
| `signed_at`                     | `timestamptz` | internal   | no    | Signature time.                                                                                                                                       |
| `created_at`                    | `timestamptz` | internal   | no    | Row creation timestamp.                                                                                                                               |
| `created_by`                    | `uuid`        | internal   | no    | Creating actor (user id).                                                                                                                             |

## `sal.delivery_status_history`

Append-only delivery status ledger (SELECT+INSERT).

| Column               | Type          | class    | Null? | Purpose                                                                            |
| -------------------- | ------------- | -------- | ----- | ---------------------------------------------------------------------------------- |
| `id`                 | `uuid`        | internal | no    | Primary key (UUID).                                                                |
| `tenant_id`          | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                    |
| `company_id`         | `uuid`        | internal | no    | Company scope (branch composite scope).                                            |
| `branch_id`          | `uuid`        | internal | no    | Branch scope (branch composite scope).                                             |
| `delivery_record_id` | `uuid`        | internal | no    | Composite FK -> `sal.delivery_records(...)` RESTRICT.                              |
| `from_status`        | `text`        | internal | yes   | Prior status (NULL on first row).                                                  |
| `to_status`          | `text`        | internal | no    | New status recorded by this ledger row.                                            |
| `reason`             | `text`        | internal | yes   | Free-text reason.                                                                  |
| `correlation_id`     | `uuid`        | internal | yes   | Optional correlation id linking the row to its originating command.                |
| `actor_id`           | `uuid`        | internal | no    | Server-stamped acting user (`stamp_status_history`).                               |
| `occurred_at`        | `timestamptz` | internal | no    | Server-stamped event time (`stamp_status_history`).                                |
| `seq`                | `bigint`      | internal | no    | Monotonic `bigint GENERATED ALWAYS AS IDENTITY` ordering key (append-only ledger). |

## `sal.financial_events`

IMMUTABLE append-only financial-event ledger (WHOLE ROW gated).

| Column            | Type            | class      | Null? | Purpose                                                                                                                               |
| ----------------- | --------------- | ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `uuid`          | internal   | no    | Primary key (UUID).                                                                                                                   |
| `tenant_id`       | `uuid`          | internal   | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                                                       |
| `company_id`      | `uuid`          | internal   | no    | Company scope (branch composite scope).                                                                                               |
| `branch_id`       | `uuid`          | internal   | no    | Branch scope (branch composite scope).                                                                                                |
| `event_type`      | `text`          | internal   | no    | CHECK IN ('invoice_issued','receipt_recorded','payment_allocated','credit_note_issued','receipt_reversed','warranty_split_recorded'). |
| `source_type`     | `text`          | internal   | no    | CHECK IN ('invoice','receipt','payment_allocation','credit_note','receipt_reversal').                                                 |
| `source_id`       | `uuid`          | internal   | no    | Source row id; single-use `UNIQUE(tenant_id, source_type, source_id, event_type)`; provenance-guarded.                                |
| `currency_code`   | `text`          | internal   | no    | ISO currency; FK -> `shared.currencies(code)` RESTRICT.                                                                               |
| `amount`          | `numeric(18,4)` | restricted | no    | RESTRICTED event amount (>=0); bound to the source by the provenance guard.                                                           |
| `occurred_at`     | `timestamptz`   | internal   | no    | Event time.                                                                                                                           |
| `actor_id`        | `uuid`          | internal   | no    | Acting user.                                                                                                                          |
| `correlation_id`  | `uuid`          | internal   | yes   | Optional correlation id linking the row to its originating command.                                                                   |
| `idempotency_key` | `text`          | internal   | yes   | Business idempotency key; partial `UNIQUE(tenant_id, idempotency_key)` (BR-SAL-001).                                                  |
| `seq`             | `bigint`        | internal   | no    | Monotonic `bigint GENERATED ALWAYS AS IDENTITY` ordering key (append-only ledger).                                                    |
| `created_at`      | `timestamptz`   | internal   | no    | Row creation timestamp.                                                                                                               |
| `created_by`      | `uuid`          | internal   | no    | Creating actor (user id).                                                                                                             |

## `sal.invoice_amounts`

RESTRICTED 1:1 invoice header totals (gated by `sal.finance.view`).

| Column           | Type            | class      | Null? | Purpose                                                                           |
| ---------------- | --------------- | ---------- | ----- | --------------------------------------------------------------------------------- |
| `id`             | `uuid`          | internal   | no    | Primary key (UUID).                                                               |
| `tenant_id`      | `uuid`          | internal   | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                   |
| `company_id`     | `uuid`          | internal   | no    | Company scope (branch composite scope).                                           |
| `branch_id`      | `uuid`          | internal   | no    | Branch scope (branch composite scope).                                            |
| `invoice_id`     | `uuid`          | internal   | no    | Composite FK -> `sal.invoices(...)` RESTRICT; 1:1 (`uq_invoice_amounts_invoice`). |
| `net_total`      | `numeric(18,4)` | restricted | no    | RESTRICTED net total; reconciled to lines (deferred trigger).                     |
| `tax_total`      | `numeric(18,4)` | restricted | no    | RESTRICTED tax total.                                                             |
| `gross_total`    | `numeric(18,4)` | restricted | no    | RESTRICTED gross; CHECK `= round(net_total + tax_total, 4)`.                      |
| `classification` | `text`          | internal   | no    | Restricted-table marker; CHECK `= 'restricted'` (immutable).                      |
| `record_version` | `integer`       | internal   | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.            |
| `created_at`     | `timestamptz`   | internal   | no    | Row creation timestamp.                                                           |
| `created_by`     | `uuid`          | internal   | no    | Creating actor (user id).                                                         |
| `updated_at`     | `timestamptz`   | internal   | yes   | Last-update timestamp (NULL until first update).                                  |
| `updated_by`     | `uuid`          | internal   | yes   | Last-updating actor.                                                              |
| `deleted_at`     | `timestamptz`   | internal   | yes   | Soft-delete timestamp (NULL = live).                                              |
| `deleted_by`     | `uuid`          | internal   | yes   | Soft-deleting actor.                                                              |

## `sal.invoice_line_amounts`

RESTRICTED 1:1 invoice-line money + payer split (gated by `sal.finance.view`).

| Column                | Type            | class      | Null? | Purpose                                                                                  |
| --------------------- | --------------- | ---------- | ----- | ---------------------------------------------------------------------------------------- |
| `id`                  | `uuid`          | internal   | no    | Primary key (UUID).                                                                      |
| `tenant_id`           | `uuid`          | internal   | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                          |
| `company_id`          | `uuid`          | internal   | no    | Company scope (branch composite scope).                                                  |
| `branch_id`           | `uuid`          | internal   | no    | Branch scope (branch composite scope).                                                   |
| `invoice_line_id`     | `uuid`          | internal   | no    | Composite FK -> `sal.invoice_lines(...)` RESTRICT; 1:1 (`uq_invoice_line_amounts_line`). |
| `invoice_id`          | `uuid`          | internal   | no    | Composite FK -> `sal.invoices(...)` RESTRICT (reconciliation join).                      |
| `unit_price`          | `numeric(18,4)` | restricted | no    | RESTRICTED unit price.                                                                   |
| `net_amount`          | `numeric(18,4)` | restricted | no    | RESTRICTED net amount.                                                                   |
| `tax_amount`          | `numeric(18,4)` | restricted | no    | RESTRICTED tax amount.                                                                   |
| `gross_amount`        | `numeric(18,4)` | restricted | no    | RESTRICTED gross; CHECK `= round(net + tax, 4)`.                                         |
| `customer_pay_amount` | `numeric(18,4)` | restricted | no    | RESTRICTED customer-pay split.                                                           |
| `warranty_pay_amount` | `numeric(18,4)` | restricted | no    | RESTRICTED warranty-pay split; CHECK `customer_pay + warranty_pay = gross` (FR-WTY-004). |
| `classification`      | `text`          | internal   | no    | Restricted-table marker; CHECK `= 'restricted'` (immutable).                             |
| `record_version`      | `integer`       | internal   | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                   |
| `created_at`          | `timestamptz`   | internal   | no    | Row creation timestamp.                                                                  |
| `created_by`          | `uuid`          | internal   | no    | Creating actor (user id).                                                                |
| `updated_at`          | `timestamptz`   | internal   | yes   | Last-update timestamp (NULL until first update).                                         |
| `updated_by`          | `uuid`          | internal   | yes   | Last-updating actor.                                                                     |
| `deleted_at`          | `timestamptz`   | internal   | yes   | Soft-delete timestamp (NULL = live).                                                     |
| `deleted_by`          | `uuid`          | internal   | yes   | Soft-deleting actor.                                                                     |

## `sal.invoice_lines`

Invoice line (structural); amounts + payer split in restricted `sal.invoice_line_amounts`.

| Column                     | Type            | class    | Null? | Purpose                                                                                                 |
| -------------------------- | --------------- | -------- | ----- | ------------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid`          | internal | no    | Primary key (UUID).                                                                                     |
| `tenant_id`                | `uuid`          | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                         |
| `company_id`               | `uuid`          | internal | no    | Company scope (branch composite scope).                                                                 |
| `branch_id`                | `uuid`          | internal | no    | Branch scope (branch composite scope).                                                                  |
| `invoice_id`               | `uuid`          | internal | no    | Composite FK -> `sal.invoices(...)` RESTRICT; frozen once invoice issued (`guard_invoice_line_frozen`). |
| `line_number`              | `integer`       | internal | no    | Line ordinal (>=1); `UNIQUE(...,invoice_id, line_number)`.                                              |
| `line_type`                | `text`          | internal | no    | CHECK IN ('service','part','fee').                                                                      |
| `quantity`                 | `numeric(12,3)` | internal | no    | Line quantity `NUMERIC(12,3)` (>0).                                                                     |
| `tax_class_id`             | `uuid`          | internal | yes   | Composite FK -> `org.tax_classes(tenant_id, company_id, id)` RESTRICT (nullable).                       |
| `currency_code`            | `text`          | internal | no    | ISO currency; FK -> `shared.currencies(code)` RESTRICT.                                                 |
| `source_service_line_id`   | `uuid`          | internal | yes   | Opaque source ref to a work-order service line (nullable).                                              |
| `source_part_issue_id`     | `uuid`          | internal | yes   | Opaque source ref to an `inv` part issue (nullable).                                                    |
| `source_quotation_item_id` | `uuid`          | internal | yes   | Opaque source ref to a `quo` quotation item (nullable).                                                 |
| `record_version`           | `integer`       | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                  |
| `created_at`               | `timestamptz`   | internal | no    | Row creation timestamp.                                                                                 |
| `created_by`               | `uuid`          | internal | no    | Creating actor (user id).                                                                               |
| `updated_at`               | `timestamptz`   | internal | yes   | Last-update timestamp (NULL until first update).                                                        |
| `updated_by`               | `uuid`          | internal | yes   | Last-updating actor.                                                                                    |
| `deleted_at`               | `timestamptz`   | internal | yes   | Soft-delete timestamp (NULL = live).                                                                    |
| `deleted_by`               | `uuid`          | internal | yes   | Soft-deleting actor.                                                                                    |

## `sal.invoice_numbering_configs`

Per (tenant, company) invoice numbering configuration (P1-OD-042).

| Column           | Type          | class    | Null? | Purpose                                                                                                   |
| ---------------- | ------------- | -------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `id`             | `uuid`        | internal | no    | Primary key (UUID).                                                                                       |
| `tenant_id`      | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                           |
| `company_id`     | `uuid`        | internal | no    | Company scope (branch composite scope).                                                                   |
| `mode`           | `text`        | internal | no    | CHECK IN ('gapless','gapped'); documents legal posture (P1-OD-042); both use the rollback-safe allocator. |
| `sequence_code`  | `text`        | internal | no    | Number-sequence code resolved by `issue_invoice`; `^[a-z][a-z0-9_]{1,62}$`.                               |
| `status`         | `text`        | internal | no    | CHECK IN ('active','inactive'); one active config per company (partial unique).                           |
| `record_version` | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                    |
| `created_at`     | `timestamptz` | internal | no    | Row creation timestamp.                                                                                   |
| `created_by`     | `uuid`        | internal | no    | Creating actor (user id).                                                                                 |
| `updated_at`     | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                                          |
| `updated_by`     | `uuid`        | internal | yes   | Last-updating actor.                                                                                      |
| `deleted_at`     | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                                      |
| `deleted_by`     | `uuid`        | internal | yes   | Soft-deleting actor.                                                                                      |

## `sal.invoice_status_history`

Append-only invoice status ledger (SELECT+INSERT).

| Column           | Type          | class    | Null? | Purpose                                                                                                                      |
| ---------------- | ------------- | -------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `uuid`        | internal | no    | Primary key (UUID).                                                                                                          |
| `tenant_id`      | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                                              |
| `company_id`     | `uuid`        | internal | no    | Company scope (branch composite scope).                                                                                      |
| `branch_id`      | `uuid`        | internal | no    | Branch scope (branch composite scope).                                                                                       |
| `invoice_id`     | `uuid`        | internal | no    | Composite FK -> `sal.invoices(...)` RESTRICT.                                                                                |
| `from_status`    | `text`        | internal | yes   | Prior status (NULL on first row).                                                                                            |
| `to_status`      | `text`        | internal | no    | CHECK IN ('draft','issued','partially_paid','paid','credited','void_before_issue') — records derived payment milestones too. |
| `reason`         | `text`        | internal | yes   | Free-text reason.                                                                                                            |
| `correlation_id` | `uuid`        | internal | yes   | Optional correlation id linking the row to its originating command.                                                          |
| `actor_id`       | `uuid`        | internal | no    | Server-stamped acting user (`stamp_status_history`).                                                                         |
| `occurred_at`    | `timestamptz` | internal | no    | Server-stamped event time (`stamp_status_history`).                                                                          |
| `seq`            | `bigint`      | internal | no    | Monotonic `bigint GENERATED ALWAYS AS IDENTITY` ordering key (append-only ledger).                                           |

## `sal.invoices`

Invoice master (branch-scoped, structural). Money lives in restricted `sal.invoice_amounts`.

| Column                  | Type          | class    | Null? | Purpose                                                                                                                |
| ----------------------- | ------------- | -------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `uuid`        | internal | no    | Primary key (UUID).                                                                                                    |
| `tenant_id`             | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                                        |
| `company_id`            | `uuid`        | internal | no    | Company scope (branch composite scope).                                                                                |
| `branch_id`             | `uuid`        | internal | no    | Branch scope (branch composite scope).                                                                                 |
| `work_order_id`         | `uuid`        | internal | no    | Composite FK -> `wo.work_orders(...)` RESTRICT; one live invoice per WO (`uq_invoices_work_order_active`).             |
| `quotation_revision_id` | `uuid`        | internal | yes   | Composite FK -> `quo.quotation_revisions(...)` RESTRICT; provenance only (nullable).                                   |
| `payer_partner_id`      | `uuid`        | internal | no    | Payer; composite FK -> `crm.business_partners(tenant_id, id)` RESTRICT.                                                |
| `currency_code`         | `text`        | internal | no    | ISO currency; FK -> `shared.currencies(code)` RESTRICT.                                                                |
| `status`                | `text`        | internal | no    | Lifecycle only; CHECK IN ('draft','issued','credited','void_before_issue'); paid/partially_paid are derived (M-fin-1). |
| `invoice_number`        | `text`        | internal | yes   | Allocated at issue via `shared.next_display_number`; NULL until issued; CHECK number-iff-issued (H-fin-5).             |
| `issued_at`             | `timestamptz` | internal | yes   | Issue timestamp; NULL until issued; frozen by `guard_invoice_freeze`.                                                  |
| `idempotency_key`       | `text`        | internal | yes   | Business idempotency key; partial `UNIQUE(tenant_id, idempotency_key)` (BR-SAL-001).                                   |
| `record_version`        | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                                 |
| `created_at`            | `timestamptz` | internal | no    | Row creation timestamp.                                                                                                |
| `created_by`            | `uuid`        | internal | no    | Creating actor (user id).                                                                                              |
| `updated_at`            | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                                                       |
| `updated_by`            | `uuid`        | internal | yes   | Last-updating actor.                                                                                                   |
| `deleted_at`            | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                                                   |
| `deleted_by`            | `uuid`        | internal | yes   | Soft-deleting actor.                                                                                                   |

## `sal.payment_allocations`

Append-only receipt->invoice allocation (WHOLE ROW gated).

| Column           | Type            | class      | Null? | Purpose                                                                                                            |
| ---------------- | --------------- | ---------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `id`             | `uuid`          | internal   | no    | Primary key (UUID).                                                                                                |
| `tenant_id`      | `uuid`          | internal   | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                                    |
| `company_id`     | `uuid`          | internal   | no    | Company scope (branch composite scope).                                                                            |
| `branch_id`      | `uuid`          | internal   | no    | Branch scope (branch composite scope).                                                                             |
| `receipt_id`     | `uuid`          | internal   | no    | Composite FK -> `sal.receipts(...)` RESTRICT (same-branch, M-fin-5).                                               |
| `invoice_id`     | `uuid`          | internal   | no    | Composite FK -> `sal.invoices(...)` RESTRICT (same-branch, M-fin-5).                                               |
| `currency_code`  | `text`          | internal   | no    | ISO currency; FK -> `shared.currencies(code)` RESTRICT.                                                            |
| `amount`         | `numeric(18,4)` | restricted | no    | RESTRICTED allocated amount (>0); bounded by derived receipt-unallocated and invoice-open under fixed-order locks. |
| `allocated_by`   | `uuid`          | internal   | no    | Allocating actor.                                                                                                  |
| `allocated_at`   | `timestamptz`   | internal   | no    | Allocation time.                                                                                                   |
| `correlation_id` | `uuid`          | internal   | yes   | Optional correlation id linking the row to its originating command.                                                |
| `seq`            | `bigint`        | internal   | no    | Monotonic `bigint GENERATED ALWAYS AS IDENTITY` ordering key (append-only ledger).                                 |
| `created_at`     | `timestamptz`   | internal   | no    | Row creation timestamp.                                                                                            |
| `created_by`     | `uuid`          | internal   | no    | Creating actor (user id).                                                                                          |

## `sal.payment_methods`

Dual-scope payment-method reference (platform + tenant).

| Column           | Type          | class    | Null? | Purpose                                                                                          |
| ---------------- | ------------- | -------- | ----- | ------------------------------------------------------------------------------------------------ |
| `id`             | `uuid`        | internal | no    | Primary key (UUID).                                                                              |
| `scope`          | `text`        | internal | no    | CHECK IN ('platform','tenant'); platform rows have NULL tenant_id, tenant rows NOT NULL.         |
| `tenant_id`      | `uuid`        | internal | yes   | Tenant (NULL for platform rows).                                                                 |
| `method_code`    | `text`        | internal | no    | Method code; platform-unique / tenant-unique (partial uniques).                                  |
| `kind`           | `text`        | internal | no    | CHECK IN ('cash','card_terminal','bank_transfer') — no gateway/settlement kinds (ASM-14/CON-04). |
| `display_name`   | `text`        | internal | no    | Display label.                                                                                   |
| `status`         | `text`        | internal | no    | Lifecycle status (see table CHECK).                                                              |
| `record_version` | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                           |
| `created_at`     | `timestamptz` | internal | no    | Row creation timestamp.                                                                          |
| `created_by`     | `uuid`        | internal | no    | Creating actor (user id).                                                                        |
| `updated_at`     | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                                 |
| `updated_by`     | `uuid`        | internal | yes   | Last-updating actor.                                                                             |
| `deleted_at`     | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                             |
| `deleted_by`     | `uuid`        | internal | yes   | Soft-deleting actor.                                                                             |

## `sal.receipt_reversals`

Full-receipt reversal (WHOLE ROW gated); dual control.

| Column                | Type            | class      | Null? | Purpose                                                                                              |
| --------------------- | --------------- | ---------- | ----- | ---------------------------------------------------------------------------------------------------- |
| `id`                  | `uuid`          | internal   | no    | Primary key (UUID).                                                                                  |
| `tenant_id`           | `uuid`          | internal   | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                      |
| `company_id`          | `uuid`          | internal   | no    | Company scope (branch composite scope).                                                              |
| `branch_id`           | `uuid`          | internal   | no    | Branch scope (branch composite scope).                                                               |
| `original_receipt_id` | `uuid`          | internal   | no    | Composite FK -> `sal.receipts(...)` RESTRICT; original retained; at most one reversal per receipt.   |
| `currency_code`       | `text`          | internal   | no    | ISO currency; FK -> `shared.currencies(code)` RESTRICT.                                              |
| `amount`              | `numeric(18,4)` | restricted | no    | RESTRICTED reversal amount (>0); CHECK `= original receipt amount` (full-receipt reversal, H-fin-1). |
| `reason`              | `text`          | internal   | no    | Free-text reason.                                                                                    |
| `approval_state`      | `text`          | internal   | no    | CHECK IN ('pending','approved','rejected').                                                          |
| `requested_by`        | `uuid`          | internal   | no    | Maker; server-stamped (H-fin-6).                                                                     |
| `approved_by`         | `uuid`          | internal   | yes   | Approver; server-stamped; CHECK `approved_by <> requested_by`.                                       |
| `approved_at`         | `timestamptz`   | internal   | yes   | Approval time.                                                                                       |
| `reversed_at`         | `timestamptz`   | internal   | yes   | Reversal time (set at approval).                                                                     |
| `idempotency_key`     | `text`          | internal   | yes   | Business idempotency key; partial `UNIQUE(tenant_id, idempotency_key)` (BR-SAL-001).                 |
| `record_version`      | `integer`       | internal   | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                               |
| `created_at`          | `timestamptz`   | internal   | no    | Row creation timestamp.                                                                              |
| `created_by`          | `uuid`          | internal   | no    | Creating actor (user id).                                                                            |
| `updated_at`          | `timestamptz`   | internal   | yes   | Last-update timestamp (NULL until first update).                                                     |
| `updated_by`          | `uuid`          | internal   | yes   | Last-updating actor.                                                                                 |

## `sal.receipts`

Receipt (branch-scoped, WHOLE ROW gated by `sal.finance.view`).

| Column                         | Type            | class      | Null? | Purpose                                                                                                    |
| ------------------------------ | --------------- | ---------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `id`                           | `uuid`          | internal   | no    | Primary key (UUID).                                                                                        |
| `tenant_id`                    | `uuid`          | internal   | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                            |
| `company_id`                   | `uuid`          | internal   | no    | Company scope (branch composite scope).                                                                    |
| `branch_id`                    | `uuid`          | internal   | no    | Branch scope (branch composite scope).                                                                     |
| `receipt_number`               | `text`          | internal   | no    | Allocated via `shared.next_display_number`; `UNIQUE(...,receipt_number)`.                                  |
| `payment_method_id`            | `uuid`          | internal   | no    | Composite FK -> `sal.payment_methods(tenant_id, id)` RESTRICT.                                             |
| `payer_partner_id`             | `uuid`          | internal   | no    | Payer; composite FK -> `crm.business_partners(tenant_id, id)` RESTRICT.                                    |
| `currency_code`                | `text`          | internal   | no    | ISO currency; FK -> `shared.currencies(code)` RESTRICT.                                                    |
| `amount`                       | `numeric(18,4)` | restricted | no    | RESTRICTED receipt amount (>0); frozen once recorded (`guard_receipt_freeze`, H-fin-4).                    |
| `received_by`                  | `uuid`          | internal   | no    | Recording cashier (user id).                                                                               |
| `received_at`                  | `timestamptz`   | internal   | no    | Receipt time; frozen once recorded.                                                                        |
| `evidence_document_version_id` | `uuid`          | internal   | yes   | Composite FK -> `shared.document_versions(tenant_id, id)` RESTRICT (nullable).                             |
| `status`                       | `text`          | internal   | no    | CHECK IN ('recorded','partially_allocated','allocated','reversed'); full reversal -> 'reversed' (H-fin-1). |
| `idempotency_key`              | `text`          | internal   | yes   | Business idempotency key; partial `UNIQUE(tenant_id, idempotency_key)` (BR-SAL-001).                       |
| `record_version`               | `integer`       | internal   | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                     |
| `created_at`                   | `timestamptz`   | internal   | no    | Row creation timestamp.                                                                                    |
| `created_by`                   | `uuid`          | internal   | no    | Creating actor (user id).                                                                                  |
| `updated_at`                   | `timestamptz`   | internal   | yes   | Last-update timestamp (NULL until first update).                                                           |
| `updated_by`                   | `uuid`          | internal   | yes   | Last-updating actor.                                                                                       |
| `deleted_at`                   | `timestamptz`   | internal   | yes   | Soft-delete timestamp (NULL = live).                                                                       |
| `deleted_by`                   | `uuid`          | internal   | yes   | Soft-deleting actor.                                                                                       |
