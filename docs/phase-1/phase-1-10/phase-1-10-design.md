# Phase 1-10 — Service Catalog, Pricing, Quotation, and Inventory Database — Design & Architecture Gate

**Phase ID:** P1-10 · **Base:** `origin/develop` = `abd3362` (after Phase 1-9 closure) ·
**Branch:** `feature/p1-10-service-pricing-quotation-inventory-database` ·
**Review model:** Solo Developer Review Policy under the Standing Technical
Authorization Policy — owner-authorized technical, QA, security, and adversarial
self-review by Eng. Ezzaldeen Al-Bitar; **not** an independent third-party review.

This document is the **binding design gate**. No migration may be written until this
gate records zero unresolved Critical or High findings (see
[phase-1-10-review-response.md](phase-1-10-review-response.md)).

> **Gate status: PASSED (2026-07-20).** A nine-lens adversarial panel returned 2 Critical,
> 14 High, 20 Medium, 2 Low. All Critical/High are resolved by binding amendment, all
> Mediums fixed or accepted with rationale, both Lows fixed — recorded in
> [phase-1-10-review-response.md](phase-1-10-review-response.md), which **supersedes** the
> affected sections below (notably: movement provenance-strict guards + `GENERATED signed_qty`
>
> - single-use constraints replacing the existence-only §10 check; `svc.publish_service_version`
>   succession; `svc.price_list_assignments` single-book resolution + `NULLS NOT DISTINCT`;
>   single-issued-revision invariant; composite decision→item FK + append-only decisions;
>   `in_transit_qty`/`transfer` dropped; status-only reservation activeness + explicit expiry;
>   currency-coherence guards; INSERT/DELETE freeze guards; `FOR UPDATE` on every aggregate/
>   balance writer; dedicated `inv.cost.view`). It fixes the schema
>   decision, money precision, service-version model, pricing precedence, quotation
>   revision model, inventory ledger invariant, reservation locking, forward-FK plan,
>   RLS/financial-privacy model, and index plan.

## 0. Canonical inputs and scope

Phase 1-10 delivers the PostgreSQL foundation for the **commercial and stock layer**
that sits on top of the Phase 1-9 work order: the service catalog and its pricing,
customer quotations and their approvals, and the inventory ledger. It is a
**database-only** phase — no backend (P1-20), no inventory backend (P1-21), no UI
(P1-30), no billing/invoice (P1-11), no procurement (PRC), and no real or fabricated
business data.

Requirement inputs (defined in the canonical Master Project Documentation and Phase-1
Development Plan, which live outside the repository per
`docs/governance/canonical-documents.md`; the Phase 1-10 index is in
`03-phase-1-database-plan.md` §"P1-10"):

- **Service:** FR-SVC-001..004, BR-SVC-001; Figure 4.20; API/EVT/ERR-SVC-001.
- **Quotation:** FR-QUO-001..004, BR-QUO-001/002; Figure 4.21; API/EVT/ERR-QUO-001.
- **Inventory:** FR-INV-001..004, BR-INV-001/002; Figure 4.22; API/EVT/ERR-INV-001.
- **Cross-cutting tests:** TC-SVC/QUO/INV-001, TC-INTG-003/004, TC-DB-001, TC-RLS-001,
  TC-CON-001.
- **Open decisions kept open (configuration, not invented):** P1-OD-007 (jurisdiction/
  currency/tax/invoice/retention), P1-OD-020/021 (partial approval, pricing/discount/
  tax limits), P1-OD-022 (inventory stock rules), P1-OD-041 (release grouping),
  P1-OD-042 (invoice-number policy — P1-11). Dependencies DEP-05 (commercial rules,
  G3), DEP-06 (item/stock/supplier rules, G3).
- **Explicitly Future — not schema'd here:** FR-SVC-005 (dynamic pricing), FR-QUO-005
  (insurer exchange), FR-INV-005 (reorder prediction).

## 1. Physical schema decision (§9.1)

**Decision: three new module schemas — `svc`, `quo`, `inv`.**

- `svc` — **Service Catalog and Pricing** (Figure 4.20 groups them): service
  categories/definitions/versions/labor-times/branch-availability, plus price
  lists/versions/rules, discount rules, and pricing-approval policies.
- `quo` — **Quotations and Approvals** (Figure 4.21): quotation masters, numbered
  immutable revisions, items, item-level approval decisions, evidence, status ledger.
- `inv` — **Inventory and Stock** (Figure 4.22): units of measure, item categories,
  item master, stock locations, immutable movements, derived balances, reservations,
  issues/returns, damaged stock, customer-supplied parts, external-purchase foundation,
  opening inventory, adjustments.

**Canonical basis:** ADR-001 "one schema per module; a schema is a module boundary"
(`docs/database/database-architecture.md` §2), the same rule that split `apt`/`rec`
(P1-8) and `wo`/`tech`/`dia`/`qms` (P1-9). Pricing is **not** a separate schema: Figure
4.20 binds it to the service catalog, and a standalone `prc` schema would collide
semantically with the out-of-scope **procurement (PRC)** domain.

**Rejected alternative:** a single combined `commerce` schema holding service +
pricing + quotation + inventory. Rejected because it violates the module-boundary rule,
couples four lifecycles with distinct ownership (Commercial Owner vs Inventory Owner,
DEP-05 vs DEP-06), and blocks independent grant/RLS evolution. The three-schema split
mirrors every prior phase.

**Cross-schema dependencies (all one-directional, no cycles):**

- `quo` → `svc` (quotation item may reference a service), `quo` → `inv` (quotation item
  may reference an item), `quo` → `wo` (quotation belongs to a work order).
- `inv` → `wo`/`rec` (movement business reference — opaque typed ref + coherence guard,
  no hard cross-schema FK for polymorphic kinds).
- `svc` → `org` (price rule tax class → `org.tax_classes`), `svc` → `shared`
  (`currencies`), `svc`/`quo`/`inv` → `iam` (`approval_limits`, permissions, RLS
  helpers). Forward FKs from `wo` → `svc`/`inv`/`quo` are added by an **additive P1-10
  forward migration** (§19), never by editing a merged P1-9 migration.

**Grants / RLS implications:** every business table is `ENABLE` + `FORCE ROW LEVEL
SECURITY`, non-owner app roles (`app_runtime`/`app_readonly`/`app_worker`, all
`NOLOGIN NOBYPASSRLS`), explicit per-object grants, branch-scoped policies (§20). No
new database role is introduced (the repo provisions only the three archetypes).

**Boundary:** no P1-11 invoice/billing table, no P1-20/P1-21 backend, no P1-30 frontend,
no PRC procurement tables. `main` untouched.

## 2. Financial precision (§9.2)

- **All monetary amounts use `NUMERIC(18,4)`** (unit prices, line totals, quotation
  subtotal/tax/discount/grand totals, costs, stock/adjustment values, discount amounts).
  This matches the two canonical money columns (`iam.approval_limits.amount`,
  `crm.customer_credit_profiles.credit_limit`) and the money standard in
  `database-architecture.md` §9 ("Never `real`/`double precision`/any float").
- **Quantities use `NUMERIC(12,3)`** (matching `wo.required_parts`); tax **rates** are
  `NUMERIC(9,6)` fractions (matching `org.tax_rates`, reused).
- **Currency** is a `currency_code text` column FK → `shared.currencies(code)` (ISO 4217,
  already seeded by `ensureOrgFixtures`). No free-text currency, no uuid currency, no
  invented default — each company states its own `base_currency_code`.
- **Zero floating-point financial columns.** A CI precision scan
  (`inv`/`quo`/`svc` schemas) fails the build on any `real`/`double precision` column, or
  any money-named column not `numeric(18,4)`. Repeated-decimal totals must reconcile
  exactly (captured line totals sum to the captured grand total).

## 3. Service version model (§9.3)

- **Stable identity:** `svc.services(tenant_id, id)` with an immutable tenant-unique
  `service_code`. Service **identity never changes** across descriptive/pricing
  revisions (FR-SVC-001). Services are **tenant-scoped** (tenant_id only — a service is
  a tenant catalog entry, made available per branch separately).
- **Category hierarchy:** `svc.service_categories(tenant_id, id, parent_category_id)`,
  tenant-scoped, with a cycle-prevention guard (a category may not be its own ancestor)
  and soft-archive.
- **Effective-dated versions:** `svc.service_versions(service_id, version_no, effective_from,
effective_to)` with a monotonic `version_no` per service, `status` draft→published→
  archived, and a **gist `EXCLUDE`** preventing overlapping effective intervals among
  **published** versions of the same service (`daterange(effective_from, effective_to,
'[)')` `&&`, `WHERE status='published' AND deleted_at IS NULL`). A published version
  and its child rows are frozen (immutability guard). Current-version resolution =
  the published version whose interval contains `now()::date`.
- **Standard labor time:** `svc.standard_labor_times(service_version_id, standard_minutes
NUMERIC(10,2) CHECK > 0)` — positive, versioned with the service version.
- **Branch availability:** `svc.branch_service_availability(tenant_id, company_id,
branch_id, service_id)` with a composite FK to `org.branches` (branch∈company
  coherence) and to `svc.services(tenant_id, id)`; unique per (tenant, company, branch,
  service). An **archived** service cannot be newly made available.
- **P1-9 forward contract:** `wo.work_order_service_lines.service_ref` resolves to
  `svc.services(tenant_id, id)` (§19).

## 4. Pricing model and deterministic precedence (§9.4)

- `svc.price_lists(tenant_id, id, price_list_code, currency_code)` — tenant-scoped named
  price book in one currency.
- `svc.price_list_versions(price_list_id, version_no, status, published_at, effective_from,
effective_to)` — monotonic version; **immutable once `status='published'`** (the
  version row and all its price rules freeze; a change is a new version). BR-SVC-001.
- `svc.price_rules(price_list_version_id, service_id, company_id?, branch_id?,
customer_class?, amount NUMERIC(18,4), currency_code, tax_class_id?, priority INT)` —
  a rule targets a **service** and optionally narrows by company/branch/customer-class.
- **Deterministic precedence (FR-SVC-003):** the resolver
  `svc.resolve_price(service_id, company_id, branch_id, customer_class, as_of date)`
  selects, among the rules of the **effective published** price-list version(s) that
  match the context, the single rule with the greatest **specificity score** (branch >
  company > customer-class > tenant-wide), breaking ties by explicit `priority DESC`,
  then by `id` — a **total order**, never row-order dependent. **At most one rule
  resolves.** Ambiguity is structurally prevented: a partial-unique index forbids two
  rules in the same version with an identical `(service_id, company_id, branch_id,
customer_class, priority)` signature, so the ordering is always strict. `resolve_price`
  is `SECURITY INVOKER`, `search_path=''`, `GRANT EXECUTE TO app_runtime, app_readonly`.
- **Issued-quote immutability (FR-SVC-004):** a later price-rule/version change never
  alters an issued quotation revision, because the revision **captures** unit price, tax,
  and discount on each item (§7). Recalculating an issued revision reproduces its
  captured amounts by construction.

## 5. Tax model (§9.5)

- **Reuse `org.tax_classes` and `org.tax_rates`** — do **not** create a new tax table.
  `org.tax_classes(tenant_id, company_id, id)` is the class; `org.tax_rates` holds the
  effective-dated `NUMERIC(9,6)` fraction with a no-overlap `EXCLUDE`. `price_rules` and
  `quotation_items` carry a nullable `tax_class_id` FK → `org.tax_classes(tenant_id,
company_id, id)` (composite; requires the referencing row to carry `company_id`).
- Tenant-wide price rules (no company) leave `tax_class_id` NULL; tax binds at quotation
  capture, where the company is known. **No hard-coded jurisdiction or rate** — rates are
  configuration (P1-OD-007 open). Quotation items **capture** the resolved
  `tax_class_id` + `tax_rate` so historical interpretation is preserved.

## 6. Discounts and approval limits (§9.6)

- `svc.discount_rules(tenant_id, id, discount_code, discount_type CHECK IN
('percentage','amount'), value NUMERIC(18,4), currency_code?, company_id?, branch_id?,
customer_class?, service_id?, effective_from, effective_to, status)` — percentage
  bounded `0..100`, amount `>= 0` and requires a currency.
- **Approval authority is reused, not duplicated.** The monetary **ceiling** ("who may
  approve up to what amount") stays in `iam.approval_limits` via new `limit_type` values
  (`quotation_approval`, `discount_approval`) — no new limit table.
- `svc.pricing_approval_policies(tenant_id, company_id?, id, policy_type CHECK IN
('discount','quotation_total','price_override'), threshold_kind CHECK IN
('percentage','amount'), threshold_value NUMERIC(18,4), currency_code?,
required_permission_code text, maker_approver_distinct boolean DEFAULT true,
effective_from, effective_to, status)` — stores **when** approval is required and
  **which permission** authorizes it. Over-limit **detection** is derivable
  (rule value vs policy threshold); the **workflow** is P1-20. Maker/approver
  segregation is expressed by `maker_approver_distinct` and enforced at decision time
  by the P1-20 backend (P1-10 stores the structure and the invariant flag).

## 7. Quotation model (§9.7)

- `quo.quotations(tenant_id, company_id, branch_id, id, work_order_id, quotation_number,
currency_code, payer_partner_id?, status, current_revision_id?)` — **branch-scoped**,
  composite FK to `wo.work_orders(tenant_id, company_id, branch_id, id)`. `quotation_number`
  is a plain text display number allocated by `shared.next_display_number('quotation',
company_id, branch_id)` (sequence provisioned at onboarding, not seeded).
- `quo.quotation_revisions(quotation_id, revision_number, status CHECK IN
('draft','issued','superseded','rejected','expired'), issued_at?, expires_at?,
currency_code, captured_subtotal, captured_tax_total, captured_discount_total,
captured_grand_total)` — **monotonic** `revision_number` unique per quotation. A revision
  and its items are **frozen once `status='issued'`** (immutability guard on the row and
  its items; only status may advance to superseded/rejected/expired). `quo.issue_revision`
  (`SECURITY INVOKER`) allocates the next revision number under a parent lock and marks
  the prior issued revision `superseded`.
- `quo.quotation_items(quotation_revision_id, line_number, item_kind CHECK IN
('service','part'), service_id?, item_ref?, source_service_line_ref?, source_required_part_ref?,
price_rule_ref?, captured_unit_price, captured_quantity, captured_discount,
captured_tax_class_id?, captured_tax_rate, captured_line_total, currency_code)` —
  captured amounts reproduce the revision totals (a coherence check ties
  `sum(captured_line_total)` and captured tax/discount to the revision's captured
  totals). Immutable once the parent revision is issued.
- `quo.approval_decisions(quotation_revision_id, quotation_item_id, decision CHECK IN
('approved','rejected'), decided_by, decision_channel, decided_at, evidence_ref?)` —
  **item-granular** (FR-QUO-002), references the **exact revision and item** (BR-QUO-001).
  Decisions are immutable. A decision may be recorded only against the **issued current**
  revision (guard), so a superseded revision's decisions are frozen.
- `quo.approval_evidence(approval_decision_id, evidence_kind, evidence_ref, captured_at,
seq)` — append-only (SELECT+INSERT only).
- `quo.quotation_status_history(...)` — append-only ledger via `shared.stamp_status_history`
  - emit/coherence triggers.
- **Approver authority (FR-QUO-003)** — the decision records the deciding party/context;
  the _authorization check_ (approver authorized for the vehicle/payer) is a P1-20
  backend concern. P1-10 stores `decided_by` + channel + evidence and guards
  revision/item coherence.

## 8. Partial approval superset (§9.8, P1-OD-020 open)

Item-granular `approval_decisions` + a derivable revision rollup form a **structural
superset** that supports full approval, full rejection, per-item approval/rejection, and
partial approval — without inventing a final policy. **BR-QUO-002** (a revised amount
invalidates prior approval for the affected item) is **automatic**: approvals reference a
specific revision, so a new revision begins with no approvals; nothing carries forward.
No partial-approval _policy_ table is created (P1-OD-020 remains open, documented).

## 9. Inventory ledger model (§9.9) and the no-DEFINER enforcement

**Architectural constraint (verified, CI-enforced):** the repository **forbids
`SECURITY DEFINER`** entirely (per-schema `prosecdef=false` tests for crm/iam/veh/
wo/tech/dia/qms/shared) and creates **no per-feature roles**. Integrity is enforced by
triggers, constraints, and **coherence guards** — never by hiding a write path behind a
privileged role. P1-10 honours this: **every function is `SECURITY INVOKER` with
`SET search_path=''` and `REVOKE EXECUTE FROM PUBLIC`.**

Therefore **BR-INV-002** ("stock balance changes only through immutable movements") is
enforced by a **coherence guard**, not a privilege boundary:

- `inv.stock_movements` — **immutable append-only** ledger: `movement_type`, positive
  `quantity NUMERIC(12,3)`, a signed contribution derived from type, exactly one typed
  business reference (§10), `occurred_at`, actor, `correlation_id`, `seq BIGINT GENERATED
ALWAYS AS IDENTITY`. Grants: **SELECT + INSERT only** (no UPDATE/DELETE); an
  immutability guard rejects any UPDATE.
- `inv.stock_balances(tenant_id, company_id, branch_id, item_id, location_id,
on_hand_qty, reserved_qty, in_transit_qty, available_qty GENERATED ALWAYS AS
(on_hand_qty - reserved_qty) STORED)` — one row per (scope, item, location).
  `inv.guard_stock_balance_coherence()` (BEFORE INSERT/UPDATE) asserts `on_hand_qty =
Σ signed movement quantity` and `reserved_qty = Σ active reservation quantity` for that
  (item, location); any forged/incoherent write fails `23514`. `available_qty` never
  goes negative (CHECK). Balances are maintained only by the movement/reservation
  functions; a direct write that does not match the ledger truth is impossible.
- **BR-INV-001:** `available = on_hand − active reservations`; damaged/quarantined stock
  lives in a `quarantine`-type location and is therefore excluded from a sellable
  location's available quantity.

## 10. Movement reference contract (§9.10)

Every movement carries **exactly one** typed reference: `reference_kind text NOT NULL
CHECK IN ('work_order','reception_visit','opening_batch','adjustment','transfer',
'issue','return','damage')` and `reference_id uuid NOT NULL`. No ambiguous multi-nullable
columns. Because kinds span schemas (wo/rec/inv) polymorphically, there is no single hard
FK; instead per-kind coherence is checked (e.g. `work_order` → the work order exists in
the movement's scope). This mirrors the P1-9 opaque `*_ref` + guard pattern.

## 11. Reservation model (§9.11, FR-INV-002)

`inv.stock_reservations(tenant_id, company_id, branch_id, id, item_id, location_id,
work_order_id?, quantity, status CHECK IN ('active','released','consumed','expired'),
idempotency_key?, correlation_id?, expires_at?)`. Atomic primitive
`inv.reserve_stock(item, location, qty, work_order, idempotency_key)` (`SECURITY
INVOKER`):

1. Ensure the balance row exists (`INSERT ... ON CONFLICT DO NOTHING`).
2. **Lock** it: `SELECT ... FOR UPDATE` (row lock — the serialization point).
3. `available := on_hand_qty − reserved_qty`; if `qty > available` → `RAISE ... ERRCODE
'23514'` (insufficient/concurrent stock, ERR-INV-001).
4. Insert the reservation (`status='active'`); bump `reserved_qty` (coherence guard now
   sees `reserved_qty = Σ active reservations`).
5. **Idempotency:** partial-unique `(tenant_id, idempotency_key)` on active reservations —
   a replay returns the existing reservation, one net effect.

Two concurrent requests for the **last unit** serialize on the `FOR UPDATE` lock; the
loser recomputes `available = 0` and fails `23514` — **exactly one winner**, no oversell,
no negative availability. `release`/`consume` transition state and adjust `reserved_qty`
via `inv.release_reservation` / `inv.consume_reservation`. Locking is in the database, not
application-only.

## 12. Item and location model (§9.12)

- `inv.units_of_measure` — **dual-scope** (`platform`|`tenant`) catalog. Platform rows
  (`each`, `hour`, `litre`, `kilogram`, …) are **structural, tenant-neutral, mandatory**
  reference data (a movement/quantity is meaningless without a unit) → seeded (§ seeds)
  and added to `STRUCTURAL_REFERENCE`. Tenants may add their own units.
- `inv.item_categories` — tenant-scoped hierarchy with cycle guard.
- `inv.item_master(tenant_id, id, item_category_id, sku, name, uom_id, item_type,
is_stock_tracked, is_serialized, ...)` — **stable tenant-unique SKU**, `pg_trgm`
  normalized-name search index, active/archive. `wo.required_parts.item_ref` resolves
  here (§19). Customer-supplied parts are **excluded** from the valued item master
  (tracked separately, §15).
- `inv.item_cost_details` — **restricted 1:1** payload (`standard_cost NUMERIC(18,4)`,
  `currency_code`), gated by `iam.has_permission('iam.sensitive.view')` — cost/margin
  never leaks to operational roles.
- `inv.stock_locations(tenant_id, company_id, branch_id, id, location_code, location_type
CHECK IN ('warehouse','storage','quarantine','transit'), parent_location_id?)` —
  branch-scoped, warehouse→storage hierarchy coherence (a storage/quarantine location's
  parent is a warehouse in the same scope), unique per (scope, location_code).

## 13. Issues and returns (§9.13)

- `inv.part_issues(tenant_id, company_id, branch_id, id, work_order_id, required_part_ref?,
item_id, location_id, reservation_id?, quantity)` — issuing generates an `issue`
  movement (via `inv.issue_part`) and consumes the reservation. Requires an **open** work
  order.
- `inv.part_returns(id, part_issue_id, quantity, ...)` — a return generates a `return`
  movement; a guard enforces `Σ returns ≤ issued quantity` (return ceiling) and an open
  work order.

## 14. Damaged stock (§9.14)

`inv.damaged_stock(tenant_id, company_id, branch_id, id, item_id, from_location_id,
quarantine_location_id, quantity, disposition, reason, responsible_party?, evidence_ref?)`
— records a `damage` movement transferring quantity from the sellable location to a
`quarantine`-type location, so it is **excluded from available** at the sellable location.
Disposition/reason/evidence/responsible party captured.

## 15. Customer-supplied parts (§9.15)

`inv.customer_supplied_parts(tenant_id, company_id, branch_id, id, work_order_id,
reception_visit_ref?, item_ref?, description, quantity, custody_state, condition?,
evidence_ref?, customer_owned boolean DEFAULT true CHECK (customer_owned))` — remain
**customer-owned**, custody-tracked, **never enter valued stock**, and generate **no
stock movements and no balance change**. May link to a visit and work order.

## 16. External-purchase foundation (§16, §9.16)

`inv.external_purchase_parts(tenant_id, company_id, branch_id, id, work_order_id,
supplier_partner_id?, supplier_name?, item_ref?, description, quantity, status,
is_procurement boolean DEFAULT false CHECK (is_procurement = false), evidence_ref?)` — an
ad-hoc, work-order-linked purchase reference **only**. Cost is restricted:
`inv.external_purchase_part_details` (1:1, `unit_cost NUMERIC(18,4)`, `currency_code`,
gated by `iam.sensitive.view`). **No** PO, PR, goods receipt, supplier bidding, or
procurement workflow — the `is_procurement=false` CHECK makes that boundary structural.

## 17. Opening inventory (§9.17)

`inv.opening_inventory_batches(tenant_id, company_id, branch_id, id, batch_code,
as_of_date, counted_by, approved_by?, status CHECK IN ('draft','approved'), approved_at?)`

- `inv.opening_inventory_lines(batch_id, item_id, location_id, quantity)`. `inv.approve_opening_batch`
  (`SECURITY INVOKER`) generates immutable `opening` movements for each line and locks the
  batch (post-approval immutability guard). No direct balance inserts — balances derive
  from the generated movements. Opening lines are **quantity-only** (valuation is
  P1-11/accounting, out of scope).

## 18. Stock adjustments (§9.18, P1-OD-022 open)

`inv.stock_adjustments(tenant_id, company_id, branch_id, id, item_id, location_id,
adjustment_quantity (signed), reason, requires_approval boolean, status CHECK IN
('pending','approved','rejected'), requested_by, approved_by?, approved_at?)` +
restricted `inv.stock_adjustment_details` (`value_impact NUMERIC(18,4)`, `currency_code`,
gated). `inv.approve_adjustment` (`SECURITY INVOKER`) generates the `adjustment` movement
**only after** authorization; an over-threshold adjustment stays `pending`. A guard
enforces **maker ≠ approver** (`approved_by <> requested_by`). The threshold itself is
**configuration** (P1-OD-022 open) — not invented.

## 19. P1-09 forward FKs (§9.19)

The P1-9 placeholders are plain nullable `uuid` (verified live): `wo.work_order_service_lines.service_ref`,
`wo.required_parts.item_ref`, `wo.customer_approvals.quotation_revision_ref`. `wo.jobs`
carries **no** service reference (services attach at the service-line level) — a
reconciliation vs. the instruction's `work_job.service_id`, documented, no such column
exists. An **additive** forward migration (Wave 7) adds:

- `wo.work_order_service_lines.service_ref` → `svc.services(tenant_id, id)` — composite
  FK `(tenant_id, service_ref)`, `ON DELETE RESTRICT`, non-partial covering index.
- `wo.required_parts.item_ref` → `inv.item_master(tenant_id, id)` — `(tenant_id, item_ref)`,
  `ON DELETE RESTRICT`, covering index.
- `wo.customer_approvals.quotation_revision_ref` → `quo.quotation_revisions(tenant_id,
company_id, branch_id, id)` — full composite scope, `ON DELETE RESTRICT`, covering index.

All are `MATCH SIMPLE`: a NULL ref stays unenforced (opaque/unresolved allowed), so no
existing P1-9 row is orphaned and every P1-9 suite stays green. No merged migration is
edited.

## 20. RLS and financial privacy (§9.20)

- Every business table: `ENABLE` + `FORCE ROW LEVEL SECURITY`. Branch-scoped tables use
  the standard clause `tenant_id = iam.current_tenant_id() AND (allowed_company_ids() IS
NULL OR company_id = ANY(...)) AND (allowed_branch_ids() IS NULL OR branch_id =
ANY(...))`; tenant-scoped catalogs (services, price lists, item master) drop the
  company/branch lines; dual-scope catalogs (UoM) use `scope='platform' OR tenant_id =
current_tenant_id()` for SELECT and tenant-only INSERT/UPDATE.
- **No-context default deny** (unset GUC → helpers return NULL → policy false).
- **Financial privacy:** cost/margin fields (`item_cost_details.standard_cost`,
  `external_purchase_part_details.unit_cost`, `stock_adjustment_details.value_impact`)
  live in **restricted 1:1 gated tables** (`classification='restricted'` immutable,
  every policy `AND iam.has_permission('iam.sensitive.view')`). Row RLS is not column
  masking, so sensitive columns are physically separated. Operational roles see prices
  and quantities but never costs/margins without the sensitive-view permission.
- **Permissions:** add P1-10 codes to the seed (`svc.service.manage`, `svc.price.manage`,
  `svc.price.publish`, `quo.quotation.manage`, `quo.decision.record`, `inv.item.manage`,
  `inv.stock.read`, `inv.stock.operate`, `inv.adjustment.approve`, `inv.cost.view`) using
  the `domain.object.action` convention; existing `iam.sensitive.view`, `org.tax.manage`,
  `iam.approval.manage` are reused. Worker role gets no P1-10 write access.

## 21. Index plan (§9.21)

Non-partial FK-covering indexes for **every** FK (leading columns = FK columns as a set),
plus query indexes: service code (unique), service-version effective range (gist),
branch availability, price resolution (`price_list_version_id, service_id, company_id,
branch_id, customer_class, priority`), published price versions, quotation display number
(unique), quotation revision (`quotation_id, revision_number`), quotation items, approval
decisions (`revision_id, item_id`), SKU (unique), item name trigram, item/location
balance (unique), active reservations (partial), movements by (item, location,
occurred_at, seq), issues/returns, opening batches, adjustments, and the three forward
FKs. The repo's non-partial FK-cover guard and duplicate-index guard both apply
(schemas `svc`,`quo`,`inv` added to the test schema list). Partial/gist indexes never
count as FK coverage — a plain covering index accompanies each `EXCLUDE`/partial.

## 22. Object inventory (planned)

**~34 tables** — `svc` (10): service_categories, services, service_versions,
standard_labor_times, branch_service_availability, price_lists, price_list_versions,
price_rules, discount_rules, pricing_approval_policies. `quo` (6): quotations,
quotation_revisions, quotation_items, approval_decisions, approval_evidence,
quotation_status_history. `inv` (18): units_of_measure, item_categories, item_master,
item_cost_details, stock_locations, stock_movements, stock_balances, stock_reservations,
part_issues, part_returns, damaged_stock, customer_supplied_parts, external_purchase_parts,
external_purchase_part_details, opening_inventory_batches, opening_inventory_lines,
stock_adjustments, stock_adjustment_details. (Final count reconciled from the live
catalog at Wave 8; exact deltas may shift by ±small as invariants are implemented.)

**Functions (all `SECURITY INVOKER`, `search_path=''`, `REVOKE PUBLIC`):** `svc.resolve_price`;
`quo.issue_revision`, `quo.record_item_decision`; `inv.post_stock_movement`,
`inv.reserve_stock`, `inv.release_reservation`, `inv.consume_reservation`, `inv.issue_part`,
`inv.return_part`, `inv.record_damage`, `inv.approve_opening_batch`, `inv.approve_adjustment`;
plus per-table guard/emit/immutability/coherence trigger functions.

## 23. Migration plan (ordered, additive, forward-only, prefix `20260723xxxxxx`)

1. `…090000` schemas svc/quo/inv (+ USAGE grants) and P1-10 permission-seed additions.
2. `…091000` svc catalogs: service_categories, services, service_versions,
   standard_labor_times, branch_service_availability.
3. `…092000` svc pricing: price_lists, price_list_versions, price_rules (+ `resolve_price`),
   discount_rules, pricing_approval_policies.
4. `…093000` inv reference: units_of_measure (dual-scope), item_categories, item_master,
   item_cost_details (restricted), stock_locations.
5. `…094000` inv ledger core: stock_movements (immutable), stock_balances (+coherence
   guard), stock_reservations (+`reserve_stock`/`release`/`consume`), `post_stock_movement`.
6. `…095000` inv operations: part_issues, part_returns, damaged_stock,
   customer_supplied_parts, external_purchase_parts (+restricted details),
   opening_inventory_batches/lines (+`approve_opening_batch`), stock_adjustments
   (+restricted details, +`approve_adjustment`), issue/return/damage functions.
7. `…096000` quo: quotations, quotation_revisions, quotation_items, approval_decisions,
   approval_evidence, quotation_status_history (+`issue_revision`, `record_item_decision`).
8. `…097000` **forward FKs**: resolve `service_ref`/`item_ref`/`quotation_revision_ref`
   (additive; keeps P1-9 suites green).

(Exact file boundaries may be split further during implementation; each migration is one
logical change, applies cleanly from zero, and never edits a merged file.)

## 24. Open-decision handling

P1-OD-007/020/021/022/041/042 are kept as **configuration or documented open contracts** —
no currency, tax jurisdiction, tax rate, discount threshold, adjustment threshold,
partial-approval policy, or invoice-numbering policy is invented. Tax reuses the
configurable `org.tax_*`; thresholds are stored as configuration (`pricing_approval_policies`,
adjustment threshold) with no seeded values; partial approval is a structural superset;
invoice numbering is explicitly deferred to P1-11 (P1-OD-042).

## 25. Requirement traceability (design ↔ requirement)

| Requirement                                           | Design element                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| FR-SVC-001 stable service id                          | `svc.services` immutable `service_code`; versions carry change                 |
| FR-SVC-002 versioned pricing by effective interval    | `svc.price_list_versions` + effective-dated `price_rules`; published-immutable |
| FR-SVC-003 deterministic precedence                   | `svc.resolve_price` total order + anti-ambiguity unique index                  |
| FR-SVC-004 / BR-SVC-001 issued-quote immutability     | captured amounts on `quotation_items`; published version frozen                |
| FR-QUO-001 immutable numbered revisions               | `quotation_revisions` monotonic + issue-freeze                                 |
| FR-QUO-002 item-granular decisions                    | `approval_decisions(revision_id, item_id)`                                     |
| FR-QUO-003 approver authority                         | `decided_by`+channel+evidence (enforcement P1-20)                              |
| FR-QUO-004 block unapproved work                      | approval state derivable per item/revision (gate P1-20)                        |
| BR-QUO-001/002 exact revision, invalidation           | approvals per-revision; new revision resets                                    |
| FR-INV-001 quantities by location                     | `stock_balances` on_hand/reserved/available/in_transit                         |
| FR-INV-002 atomic reservation                         | `inv.reserve_stock` FOR UPDATE single-winner                                   |
| FR-INV-003 / BR-INV-002 immutable movement per change | `stock_movements` append-only + coherence guard                                |
| FR-INV-004 adjustment approval                        | `stock_adjustments` pending/approved + maker≠approver                          |
| BR-INV-001 available derivation                       | `available GENERATED (on_hand − reserved)`; quarantine excluded                |

## 26. Governance

Owner-authorized technical, QA, security, and adversarial **self-review** under the Solo
Developer Review Policy and the Standing Technical Authorization Policy — **not** an
independent third-party review. The user performs every merge. No P1-11/P1-20/P1-21/P1-30
implementation; no procurement; no fabricated business data.
