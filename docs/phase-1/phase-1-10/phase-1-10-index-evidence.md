# Phase 1-10 — Index Evidence

**160 indexes** across the 35 tables (introspected). Every foreign key is covered by a
non-partial index whose leading columns (as a set) equal the FK columns; partial,
gist, and `NULLS NOT DISTINCT` uniques never count as FK cover, so a plain covering
index accompanies each. The repo FK-index-cover guard reports zero gaps and the
duplicate-index guard reports zero exact duplicates on `svc`/`quo`/`inv` (added to the
guard's schema list).

## `svc`

| Table                         | Notable indexes (beyond the PK)                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service_categories`          | `uq_..._tenant_id (tenant_id,id)`; `uq_..._code (tenant_id,code)` partial; `ix_..._parent (tenant_id,parent_category_id)` (FK cover)                                                                    |
| `services`                    | `uq_..._tenant_id`; `uq_..._code` partial; `ix_..._category (tenant_id,service_category_id)`                                                                                                            |
| `service_versions`            | `uq_..._tenant_id`; `uq_..._no (tenant_id,service_id,version_no)`; `ix_..._service`; **gist** `ex_..._no_published_overlap`                                                                             |
| `standard_labor_times`        | `uq_..._version_code (…,labor_code) NULLS NOT DISTINCT` partial; `ix_..._version` (FK cover)                                                                                                            |
| `branch_service_availability` | `uq_..._scope_id`; `uq_..._service` partial; `ix_..._branch`; `ix_..._service`                                                                                                                          |
| `price_lists`                 | `uq_..._tenant_id`; `uq_..._code` partial; `ix_..._currency` (FK cover)                                                                                                                                 |
| `price_list_versions`         | `uq_..._tenant_id`; `uq_..._no`; `ix_..._list`; **gist** `ex_..._no_published_overlap`                                                                                                                  |
| `price_rules`                 | `uq_..._signature (version,service,company,branch,customer_class,priority) NULLS NOT DISTINCT` partial; `ix_..._version`; `ix_..._service`; `ix_..._tax_class (tenant,company,tax_class_id)` (FK cover) |
| `price_list_assignments`      | `uq_..._signature NULLS NOT DISTINCT` partial-active; `ix_..._list` (FK cover)                                                                                                                          |
| `discount_rules`              | `uq_..._code` partial; `ix_..._currency`; `ix_..._service`                                                                                                                                              |
| `pricing_approval_policies`   | `uq_..._scope NULLS NOT DISTINCT` partial-active; `ix_..._tenant`; `ix_..._currency`; `ix_..._permission` (FK cover)                                                                                    |

## `inv`

| Table                            | Notable indexes (beyond the PK)                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `units_of_measure`               | `ix_..._tenant`; `uq_..._platform_code (code)` partial; `uq_..._tenant_code (tenant_id,code)` partial                                                                       |
| `item_categories`                | `uq_..._tenant_id`; `uq_..._code` partial; `ix_..._parent`                                                                                                                  |
| `item_master`                    | `uq_..._tenant_id`; `uq_..._sku` partial; `ix_..._category`; `ix_..._uom`; **trigram GIN** `ix_..._name_trgm (lower(name))` partial                                         |
| `item_cost_details`              | `uq_..._item` partial; `ix_..._item` (non-partial FK cover); `ix_..._currency`                                                                                              |
| `stock_locations`                | `uq_..._scope_id`; `uq_..._code` partial; `ix_..._branch`; `ix_..._parent`                                                                                                  |
| `stock_movements`                | `uq_..._source (reference_kind,reference_id,direction)` (single-use); `ix_..._item_location (…,occurred_at,seq)`; `ix_..._branch`; `ix_..._item`; `ix_..._location`         |
| `stock_balances`                 | `uq_..._cell (tenant,company,branch,item,location)`; `ix_..._item`; `ix_..._location`                                                                                       |
| `stock_reservations`             | `uq_..._scope_id`; `uq_..._idempotency` partial (lifetime); `ix_..._cell_active` **partial** `WHERE status='active'`; `ix_..._item`; `ix_..._location`; `ix_..._work_order` |
| `opening_inventory_batches`      | `uq_..._scope_id`; `uq_..._code` partial; `ix_..._branch`                                                                                                                   |
| `opening_inventory_lines`        | `uq_..._tenant_id`; `uq_..._cell` partial; `ix_..._batch`; `ix_..._item`; `ix_..._location`                                                                                 |
| `stock_adjustments`              | `uq_..._scope_id`; `ix_..._branch`; `ix_..._item`; `ix_..._location`                                                                                                        |
| `stock_adjustment_details`       | `uq_..._adjustment` partial; `ix_..._adjustment` (non-partial FK cover); `ix_..._currency`                                                                                  |
| `part_issues`                    | `uq_..._scope_id`; `ix_..._branch`; `ix_..._work_order`; `ix_..._item`; `ix_..._location`; `ix_..._reservation`                                                             |
| `part_returns`                   | `uq_..._scope_id`; `ix_..._issue` (FK cover)                                                                                                                                |
| `damaged_stock`                  | `uq_..._scope_id`; `ix_..._branch`; `ix_..._item`; `ix_..._from_location`; `ix_..._quarantine`                                                                              |
| `customer_supplied_parts`        | `uq_..._scope_id`; `ix_..._branch`; `ix_..._work_order`                                                                                                                     |
| `external_purchase_parts`        | `uq_..._scope_id`; `ix_..._branch`; `ix_..._work_order`                                                                                                                     |
| `external_purchase_part_details` | `uq_..._parent` partial; `ix_..._parent` (non-partial FK cover); `ix_..._currency`                                                                                          |

## `quo`

| Table                      | Notable indexes (beyond the PK)                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quotations`               | `uq_..._scope_id`; `uq_..._number (tenant,company,branch,quotation_number)` partial; `ix_..._branch`; `ix_..._work_order`; `ix_..._currency`         |
| `quotation_revisions`      | `uq_..._scope_id`; `uq_..._number`; `uq_..._one_issued` **partial** `WHERE status='issued'`; `ix_..._quotation`; `ix_..._currency`                   |
| `quotation_items`          | `uq_..._decision_key (…,revision,id)`; `uq_..._line (…,revision,line_number)`; `ix_..._revision`; `ix_..._service`; `ix_..._item`; `ix_..._currency` |
| `approval_decisions`       | `uq_..._item (…,revision,item)` (one per revision-item)                                                                                              |
| `approval_evidence`        | `ix_..._decision`; `ix_..._document (tenant,document_version_id)` (FK cover)                                                                         |
| `quotation_status_history` | `ix_..._quotation (…,occurred_at DESC,seq DESC)`                                                                                                     |

## Forward-FK covering indexes (`…097000`)

`ix_work_order_service_lines_service_ref (tenant_id, service_ref)`,
`ix_required_parts_item_ref (tenant_id, item_ref)`,
`ix_customer_approvals_quotation_revision_ref (tenant_id, company_id, branch_id,
quotation_revision_ref)` — each a non-partial cover for its new FK.
