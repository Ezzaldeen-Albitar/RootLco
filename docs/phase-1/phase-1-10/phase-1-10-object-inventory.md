# Phase 1-10 — Object Inventory

Introspected from the live catalog. Counts: **35 tables, 39 functions, 85 triggers,
101 policies, 160 indexes, 582 columns.**

## Tables

### `svc` — Service Catalog + Pricing (11)

| Table                             | Kind                              | Purpose                                                                                            |
| --------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `svc.service_categories`          | tenant catalog (hierarchy)        | Service taxonomy; per-tenant advisory-locked cycle guard                                           |
| `svc.services`                    | tenant master                     | Stable service identity (FR-SVC-001); immutable `service_code`; `active`/`archived`                |
| `svc.service_versions`            | versioned (frozen)                | Effective-dated versions; gist `EXCLUDE` no-overlap on published; forward-only succession          |
| `svc.standard_labor_times`        | child (frozen once published)     | Positive `standard_minutes` per version                                                            |
| `svc.branch_service_availability` | branch-scoped                     | Where a service is offered (branch∈company); archived service cannot be newly offered              |
| `svc.price_lists`                 | tenant catalog                    | Named price book in one `currency_code`                                                            |
| `svc.price_list_versions`         | versioned (frozen once published) | Immutable published versions (BR-SVC-001); gist `EXCLUDE` no-overlap                               |
| `svc.price_rules`                 | child (frozen once published)     | A rule targets a service; optional company/branch/customer-class narrowing; inherits list currency |
| `svc.price_list_assignments`      | tenant mapping                    | One applicable price list per scope context (single-book resolution)                               |
| `svc.discount_rules`              | tenant catalog                    | Bounded percentage(0..100)/amount discounts                                                        |
| `svc.pricing_approval_policies`   | tenant config                     | When approval is required + which permission authorizes it                                         |

### `quo` — Quotation + Approvals (6)

| Table                          | Kind                           | Purpose                                                                                   |
| ------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `quo.quotations`               | branch-scoped master           | Quotation (WO-origin); branch-scoped `quotation_number`                                   |
| `quo.quotation_revisions`      | versioned (frozen once issued) | Numbered revisions capturing subtotal/discount/tax/grand totals; one issued per quotation |
| `quo.quotation_items`          | child (frozen once issued)     | Captured lines; per-line arithmetic CHECK-enforced                                        |
| `quo.approval_decisions`       | append-only ledger             | Item-granular decision bound to exact revision+item; one per revision-item                |
| `quo.approval_evidence`        | append-only ledger             | Document-bound (`shared.document_versions`) evidence                                      |
| `quo.quotation_status_history` | append-only ledger             | Emitted quotation status transitions                                                      |

### `inv` — Inventory + Stock (18)

| Table                                | Kind                         | Purpose                                                                         |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------- |
| `inv.units_of_measure`               | dual-scope catalog           | Platform structural UoM + tenant UoM                                            |
| `inv.item_categories`                | tenant catalog (hierarchy)   | Item taxonomy; advisory-locked cycle guard                                      |
| `inv.item_master`                    | tenant master                | Stable tenant-unique SKU; trigram name search; `active`/`archived`              |
| `inv.item_cost_details`              | restricted 1:1               | `standard_cost` (gated by `inv.cost.view`), tenant-scoped                       |
| `inv.stock_locations`                | branch-scoped (hierarchy)    | Warehouse/storage/quarantine; parent-warehouse coherence                        |
| `inv.stock_movements`                | append-only ledger           | Immutable ledger; `GENERATED signed_qty`; single-use source; provenance-guarded |
| `inv.stock_balances`                 | derived (coherence-guarded)  | `on_hand`/`reserved`/`available (GENERATED)` per (item, location)               |
| `inv.stock_reservations`             | atomic reservation           | Single-winner last-unit race; status-only activeness; lifetime idempotency      |
| `inv.opening_inventory_batches`      | approval master              | Opening batch (maker≠approver); approval posts `opening` movements              |
| `inv.opening_inventory_lines`        | child (frozen once approved) | Quantity-only opening lines                                                     |
| `inv.stock_adjustments`              | approval master              | Signed adjustment (`in`/`out`); over-threshold stays pending; maker≠approver    |
| `inv.stock_adjustment_details`       | restricted 1:1               | `value_impact` (gated by `inv.cost.view`), branch-scoped                        |
| `inv.part_issues`                    | operation                    | Issue a part to a WO; consumes a reservation; issue movement                    |
| `inv.part_returns`                   | operation                    | Return a previously issued part; return movement; `Σ returns ≤ issued`          |
| `inv.damaged_stock`                  | operation                    | Damage disposition; paired out/in `damage` movement to quarantine               |
| `inv.customer_supplied_parts`        | custody record               | Customer-owned; **no** stock movement, **no** balance change                    |
| `inv.external_purchase_parts`        | non-procurement foundation   | WO-linked purchase reference (`is_procurement=false`)                           |
| `inv.external_purchase_part_details` | restricted 1:1               | `unit_cost` (gated by `inv.cost.view`), branch-scoped                           |

## Functions (39)

All 39 functions are `SECURITY INVOKER` with `SET search_path = ''` and `REVOKE
EXECUTE FROM PUBLIC`; **none is `SECURITY DEFINER`** (the repo forbids it entirely).
Because no write path hides behind a privileged role, integrity is enforced by
constraints, triggers, and coherence/provenance guards, not by a privilege boundary.

### `svc` (10)

- **Guards:** `guard_service_category_no_cycle`, `guard_service_lifecycle`,
  `guard_service_version_freeze`, `guard_labor_time_parent_frozen`,
  `guard_branch_availability_service_active`, `guard_price_list_version_freeze`,
  `guard_price_rule_parent_frozen`.
- **App-runtime primitives (`GRANT EXECUTE`):** `publish_service_version(uuid, uuid,
date)`, `publish_price_list_version(uuid, uuid, date)` → `app_runtime`;
  `resolve_price(uuid, uuid, uuid, text, date)` → `app_runtime, app_readonly`.

### `inv` (23)

- **Guards:** `guard_item_category_no_cycle`, `guard_item_lifecycle`,
  `guard_item_uom_scope`, `guard_stock_location_hierarchy`,
  `guard_stock_balance_coherence`, `guard_stock_reservation_status`,
  `guard_opening_batch_approval`, `guard_adjustment_approval`,
  `guard_part_return_ceiling` (constraint-layer `Σ returns ≤ issued`, row-locks the
  parent issue), `guard_stock_movement_provenance` (the movement trust root).
- **Internal helpers (`REVOKE PUBLIC`, no grant — called only by other functions):**
  `lock_stock_balance`, `sync_reserved`, `free_reservations_for_loss`.
- **App-runtime primitives (`GRANT EXECUTE TO app_runtime`):** `post_stock_movement`,
  `reserve_stock`, `release_reservation`, `consume_reservation`,
  `expire_reservations`, `issue_part`, `return_part`, `record_damage`,
  `approve_opening_batch`, `approve_adjustment`.

### `quo` (6)

- **Guards / emitters:** `guard_quotation_item` (parent-freeze + currency coherence),
  `guard_quotation_revision_freeze` (issued revision captured totals/`issued_at`
  immutable; status may only advance issued→superseded/rejected/expired),
  `guard_revision_totals` (deferred constraint-trigger totals identity),
  `emit_quotation_status_history`.
- **App-runtime primitives (`GRANT EXECUTE TO app_runtime`):** `issue_revision(uuid,
timestamptz)`, `record_item_decision(uuid, text, text, uuid)`.

## Triggers (85)

Every table carries the standard trigger set — `BEFORE UPDATE
shared.touch_row_metadata` on mutable tables, `org.guard_immutable_columns(...)`
immutable-column guards, and the domain-specific guards above (cycle, lifecycle,
freeze, provenance, coherence, approval, status). Append-only ledgers
(`inv.stock_movements`, `quo.approval_decisions`, `quo.quotation_status_history`)
carry a `BEFORE INSERT shared.stamp_status_history` server-stamp; the movement ledger
additionally carries `tg_stock_movements_provenance`; `quo.quotation_items` carries
the `DEFERRABLE INITIALLY DEFERRED` constraint trigger `tg_quotation_items_totals`.
Two constraint-layer guards close raw-write paths: `tg_part_returns_ceiling`
(`BEFORE INSERT` on `inv.part_returns`) and `tg_quotation_revisions_freeze`
(`BEFORE UPDATE` on `quo.quotation_revisions`).

## Policies (101)

Every business table is `ENABLE` + `FORCE ROW LEVEL SECURITY`. Policy shapes:
tenant-scoped catalogs (`sel`/`ins`/`upd` on `tenant_id = iam.current_tenant_id()`),
branch-scoped tables (add the `allowed_company_ids()`/`allowed_branch_ids()` clause),
the dual-scope UoM catalog (`scope='platform' OR tenant_id=current` for SELECT,
tenant-only write), the three restricted cost tables (add `AND
iam.has_permission('inv.cost.view')`), and the append-only ledgers (SELECT+INSERT
policies only — no UPDATE/DELETE). See
[phase-1-10-security-matrix.md](phase-1-10-security-matrix.md).

## Indexes (160)

Every foreign key is covered by a non-partial index whose leading columns (as a set)
equal the FK columns; partial/gist/`NULLS NOT DISTINCT` uniques never count as FK
cover, so a plain covering index accompanies each. Notable specialised indexes: the
two gist `EXCLUDE` no-overlap indexes on published `service_versions` and
`price_list_versions`; the `NULLS NOT DISTINCT` anti-ambiguity uniques on
`price_rules`, `price_list_assignments`, and `pricing_approval_policies`; the
`item_master` trigram GIN index; the single-use `uq_stock_movements_source`; the
partial active-reservation index; the lifetime idempotency unique; and the
single-issued-revision partial unique. See
[phase-1-10-index-evidence.md](phase-1-10-index-evidence.md).

## Migrations (8, forward-only)

| Migration                   | Summary                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `…090000_svcquoinv_schemas` | Reserve `svc`/`quo`/`inv` module schemas; USAGE grants                                                                               |
| `…091000_svc_catalog`       | `svc` catalog: categories, services, versions (+succession), labor, availability                                                     |
| `…092000_svc_pricing`       | `svc` pricing: price lists/versions/rules/assignments, discounts, policies (+`resolve_price`)                                        |
| `…093000_inv_reference`     | `inv` reference: UoM (dual-scope), item categories, item master (+restricted cost), locations                                        |
| `…094000_inv_ledger`        | `inv` ledger: movements (immutable), balances (+coherence guard), reservations (+primitives)                                         |
| `…095000_inv_operations`    | `inv` operations: opening, adjustments (+restricted), issues/returns, damage, CSP, external-purchase (+restricted), provenance guard |
| `…096000_quo_quotations`    | `quo`: quotations, revisions, items, decisions, evidence, status history (+`issue_revision`, `record_item_decision`)                 |
| `…097000_wo_forward_fks`    | Resolve the three P1-09 forward refs (service/item/quotation-revision) additively                                                    |
