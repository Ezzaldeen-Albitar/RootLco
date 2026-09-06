# Owner requirements recorded 2026-09-06 — the nine areas, grounded

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product and Pilot Planning · **Owner:** Eng. Ezzaldeen Al-Bitar · **Recorded:** 2026-09-06 at protected `develop` `6f6236c3` (P1-30 corrective work in flight)

This is the companion to `owner-workflow-requirements.md`, the carry-forward register. That register keeps one row per requirement and a Status; this document carries the full grounding the Owner asked for on 2026-09-06 — for every stated requirement, the Owner's wording, the normalised behaviour, what already exists (with the file and line it was read from), the remaining gap, the owning module, the delivery placement, the dependencies and the observable acceptance criteria — and it says on every line whether it records an **Owner requirement** or a **proposed implementation policy**. Identifiers are dated (`OWR-2026-09-06-<area>-<n>`) because these are new requirements; where an existing register row already covers a line, the row name is given instead.

**Documented is not implemented.** Every Status below is the register's vocabulary (Delivered / Contracted / Blocked / Planned / Undecided), assigned from the evidence cited on the line, never from the presence of the line. Each area was read against the repository by one researcher, then a completeness critique per area checked coverage, evidence, placement and invented numbers; corrections are applied in place. Where a claim could not be verified the line says so and why. No price, quota, provider or numeric limit appears here that the Owner did not state.

**Read the evidence as of its measurement.** Every line was grounded at `6f6236c3`, before PR #322. Lines that say `inv.stock_locations`, `inv.item_master` or `inv.item_categories` have no writer, or that repeat the A0 eleven-table F-02 count, describe that head; the writers landed in #322 and the count was re-measured in `docs/phase-1/phase-1-30/f02-remeasurement.md`. The grounded text is kept verbatim rather than rewritten, and the carry-forward register carries the current Status.

| area | title                                                         | lines | Owner requirements | proposed policies |
| ---- | ------------------------------------------------------------- | ----- | ------------------ | ----------------- |
| A    | Intelligence and dashboards                                   | 21    | 13                 | 8                 |
| B    | Inventory                                                     | 24    | 17                 | 7                 |
| C    | Stocktaking                                                   | 15    | 10                 | 5                 |
| D    | Duplicate demand and approvals                                | 11    | 8                  | 3                 |
| E    | Changing costs and prices                                     | 16    | 10                 | 6                 |
| F    | Vehicle and service knowledge (oil specification)             | 12    | 8                  | 4                 |
| G    | RootLco owner administration (platform CRM and subscriptions) | 30    | 24                 | 6                 |
| H    | Reception workflow and camera/OCR                             | 26    | 21                 | 5                 |
| I    | AI integration and future ERP                                 | 22    | 15                 | 7                 |

---

## Area A — Intelligence and dashboards

**Where this area stands today.** What exists: the rpt schema from P1-11 (three tables: report configurations, immutable published versions with a parameter_schema filter allow-list, owner-only saved filters with a scope ceiling, all DB-tested) and P1-23's two catalogue reads (rpt.report-catalogue, rpt.report-read under rpt.report.read), which by recorded limitation P1-23-A-02 bind no data source and answer executable: false; the live database holds zero rows in all three tables, no view or materialized view exists anywhere, no operation writes a configuration (rpt.report.configure is used by nothing), the reports navigation entry is 'planned' with no page behind it, the dashboard overview is deliberately not a business dashboard, and the first-administrator bundle does not hold rpt.report.read. What is derivable today at source: revenue, cash received and receivables are distinct, provenance-bound facts (six sal.financial_events types, sal.invoice_open_receivable, receipts and allocations, all gated by sal.finance.view and branch-scoped, with the cross-currency trap already recorded), and inventory reads already take branch, location and instant-window filters; profit is not derivable because no cost of sale is attributed to any invoice line, item cost is a restricted standard cost read by no operation, and no labour rate exists anywhere. What is missing: the Owner's baseline metric list, a code-registered dataset/metric registry, report execution, a response envelope carrying computedAt/basis/scope/currency/coverage, drill declarations, alert conditions, the configure writer and the bundle fix. Where it lands: the bundle fix in the P1-30 tenant-bootstrap corrective lane; the execution contract, registry, configure writer and envelope in a P1-31 Backend prerequisite lane measured by a P1-31 A0 in the P1-30 manner, then the /reports UI in P1-31; profit and alerts wait on Owner decisions (costing basis; alert list with tenant-set conditions); broader analytics and prediction are recorded as two explicit follow-on slices after the Integration gate, and the Phase 1 registry ships measured facts only. Eleven Owner requirement lines (one reusing the existing 'Reports' row) and eight labelled proposed policies; nothing here is Delivered, and no price, quota, threshold or provider was invented.

### OWR-2026-09-06-A-1 — Owner requirement · **Blocked**

> Analyze the operational data of every delivered module

- **Normalised behaviour:** For each delivered module (CRM, vehicles, appointments, reception, work orders, diagnostics, technicians, quality, services, pricing, quotations, inventory, billing, payments) an authorised viewer can obtain server-computed figures over that module's records, and the figures reconcile to the module's own list/detail reads.
- **Existing evidence:** Reporting backend is a catalogue only: apps/api/src/app/api/v1/reports/route.ts:33-46 (rpt.report-catalogue, rpt.report.read, scope tenant) and apps/api/src/app/api/v1/reports/[reportCode]/route.ts:32-45 (rpt.report-read); apps/api/src/modules/reporting/application/report-catalogue-service.ts:11-24 and :57-62 state no data-source binding exists and every definition answers `executable: false`; apps/api/src/modules/reporting/data/report-catalogue-repository.ts:14-19 same. Schema: supabase/migrations/20260724096000_rpt_reporting.sql:4-5 ('No report datasets, KPI formulas, or export backend'), tables at :17, :70, :132. Live DB: rpt.report_configurations / _versions / saved_filters hold 0/0/0 rows and no view or materialized view exists in any schema (catalog query 2026-09-06). Recorded limitation P1-23-A-02: docs/phase-1/phase-1-23/gate-record.md:266 and contract-archaeology.md:223-240. Frontend: no `reports` directory under apps/web/src/app/[locale]/(dashboard)/; apps/web/src/config/navigation.ts:440-448 carries `reports` as status 'planned'; apps/web/src/app/[locale]/(dashboard)/page.tsx:9-14 is deliberately not a business dashboard. Tests prove the catalogue only: tests/backend/p1-23-reporting.test.ts:135-238 (':170 never claims executability'); tests/db/rpt-reporting.test.ts:45-98 (owner-only filters, published immutability, scope ceiling).
- **Remaining gap:** Everything that turns a definition into a figure: a dataset registry binding a report_code to a server-side query, an execution operation, the metric read models per module, the /reports screen. Also no operation writes rpt.report_configurations (rpt.report.configure is asked for by no operation: docs/product/workshop/end-to-end-workshop-workflow.md:1108-1113), so even the existing catalogue is empty for every tenant.
- **Owning module:** apps/api/src/modules/reporting (rpt schema) reading the domain read models of billing, payments, inventory, work-order, diagnostics, technician, quality, reception, crm, vehicle, quotation, pricing, service-catalog; apps/web/src/features/reporting (does not exist).
- **Delivery placement:** P1-31 (Vehicle Delivery, Warranty and Reporting Frontend) for the UI, with a P1-31 Backend prerequisite lane for the execution contract and dataset registry, following the P1-30 pattern (canonical-plan.md §1.4 remediation/p1-30-backend-* under a p1-30-backend profile). Reason: the register places Reports under P1-31 (docs/product/owner-workflow-requirements.md:289) and backend capability returns to a Backend lane under change control (canonical-plan.md §2). No docs/phase-1/phase-1-31 directory exists yet; the profile name is by analogy and UNVERIFIED.
- **Dependencies:** OWR-2026-09-06-A-10 (the Owner's baseline metric list); OWR-2026-09-06-A-2 (scope); P1-30 W6/W7 list reads that are drill targets (register rows 'Invoice' INT-083 no invoice list, 'Quotation' INT-060); rpt.report.read entering the administrator bundle (F-01 residual, docs/phase-1/phase-1-30/a0-read-surface-matrix.md:326-337); a writer for rpt.report_configurations.
- **Acceptance criteria:** On a fresh organisation with one issued invoice, one receipt, one part issue and one completed work order, GET /reports lists at least one published definition with executable true, an execution read returns figures whose values equal what the invoice detail, receipt list, movement list and work-order detail show, and the /reports page renders them without client arithmetic (gate sentence P1-30 RENDERS SERVER ARITHMETIC ONLY extended to the reporting pages).
- **Unverified:** Name of the P1-31 backend ownership profile; whether the Owner's Phase 1 plan DOCX (outside Git) lists reporting tasks for P1-31 beyond the register row.

### OWR-2026-09-06-A-2 — Owner requirement · **Contracted**

> within the viewer's authorized scope

- **Normalised behaviour:** Every report figure is computed only over rows the requesting principal may read: narrowed to the server-resolved company/branch scope, and amount, cost and sensitive figures are withheld (null, not zero) unless the principal holds sal.finance.view, inv.cost.view or iam.sensitive.view respectively.
- **Existing evidence:** Scope is server-resolved and immutable per request: apps/api/src/server/context/request-context.ts:6-21; set as app.company_ids / app.branch_ids in apps/api/src/server/db/transaction.ts:118-119; read by iam.allowed_company_ids / iam.allowed_branch_ids (supabase/migrations/0002_base_schemas.sql:128-159). Amount tables are whole-row gated by sal.finance.view plus branch narrowing: sal.invoice_amounts policy 20260724091000_sal_invoices.sql:212-216; sal.receipts (20260724092000_sal_payments.sql:75) and sal.payment_allocations (:183, policies :215-222); sal.financial_events comment :50. Cost gated by inv.cost.view: 20260723093000_inv_reference.sql:267-300. Rework cost gated by iam.sensitive.view: 20260722105000_qms_rework_closure_gate.sql:253-279. Report scope model exists: rpt.report_configurations.scope_level branch/company/tenant and guard_saved_filter_scope (20260724096000_rpt_reporting.sql:160-178, BR-RPT-001), proven by tests/db/rpt-reporting.test.ts:98. Null-not-zero precedent in the delivered billing UI: apps/web/src/features/billing/billing-contract.ts:94 and components/InvoiceScreen.tsx:63.
- **Remaining gap:** No report execution exists to apply any of this to; the rule that an aggregate over rows the caller cannot see is null rather than a partial sum is not written anywhere; the reports nav entry is scope 'company' (navigation.ts:447) while the two rpt operations are scope 'tenant' and the amount tables are branch-scoped — the scope of a report read must be decided with the execution contract.
- **Owning module:** reporting module + iam scope functions; every domain read model it aggregates.
- **Delivery placement:** P1-31 Backend prerequisite lane (same slice as A-1). Reason: it is a property of the execution contract, not a screen.
- **Dependencies:** OWR-2026-09-06-A-1; the RLS-versus-authorizeScope distinction recorded at apps/api/src/app/api/v1/stock-movements/route.ts:40-45 (RLS app.branch_ids is the permission-blind union of grants, so companyId/branchId must be required and authorised on every scoped report read).
- **Acceptance criteria:** Three principals on one tenant: branch-scoped without sal.finance.view sees counts for their branch and null money; branch-scoped with sal.finance.view sees their branch's money and nothing from another branch; a tenant-B principal sees nothing of tenant A (ERR-RES-001 or empty). Proven on a real response, not a mocked adapter (P1-28 damage-map lesson).
- **Unverified:** None.

### OWR-2026-09-06-A-3 — Owner requirement · **Undecided**

> Provide defined metrics

- **Normalised behaviour:** Each figure a report shows has a named, versioned server-side definition (what it counts, over which records, in which unit or currency) that the UI can display beside the figure, and the definition is the same for every tenant.
- **Existing evidence:** None as metrics. The schema deliberately carries no KPI formula (20260724096000_rpt_reporting.sql:4-5; docs/phase-1/phase-1-11/phase-1-11-p1-23-reporting-backend-contract.md:3-5 and :31-35 name 'report datasets, KPI definitions' as P1-23-owned but not built). Definitions that do exist and could become metrics: open receivable (sal.invoice_open_receivable, 20260724093000_sal_financial_events.sql:129-147; docs/product/workshop/pricing-payment-and-delivery.md:263-271), receipt unallocated (:151), movement-derived stock balance (20260723094000_inv_ledger.sql:103-130), the six financial event types (20260724093000_sal_financial_events.sql:48-52).
- **Remaining gap:** The Owner has not named the baseline metric list; docs/product/workshop/frontend-implementation-program.md:203-208 records that a reporting package needs a Product Owner scope statement naming what a workshop must report on, and none exists. No metric registry, no definition text, no versioning of definitions.
- **Owning module:** reporting module (a code-registered metric/dataset registry, mirroring the shape of EXPORT_RESOURCES in apps/api/src/modules/shared-services/domain/export-policy.ts:99-113).
- **Delivery placement:** Owner decision first (the list), then P1-31 Backend prerequisite lane for the registry and P1-31 UI for the display. Reason: the register's Undecided rule — a business-rule decision precedes scoping.
- **Dependencies:** Owner baseline list (OWR-2026-09-06-A-10); OWR-2026-09-06-A-14 (proposed registry policy).
- **Acceptance criteria:** For every figure on the reports page a human can open its definition text and the definition names the operation or table the figure is computed from; a test asserts every registered metric has a non-empty definition and a unit or currency.
- **Unverified:** None.

### OWR-2026-09-06-A-4 — Owner requirement · **Blocked**

> period/branch/warehouse filters

- **Normalised behaviour:** A report can be narrowed by a time window (two ISO instants), by company/branch within the viewer's scope, and — for inventory figures — by stock location, and the applied filter is echoed in the response.
- **Existing evidence:** Operational reads already take these filters: inv.stock-movement-list apps/api/src/app/api/v1/stock-movements/route.ts:44-56 (companyId, branchId required; locationId; occurredFrom/occurredTo as ISO instants, with the timezone rationale at :51-53); inv.stock-availability-read stock-availability/route.ts:46-48 and :61-62 (branch scope, locationId resolved and checked at :25-27); inv.inventory-reconciliation-read inventory-reconciliations/route.ts:40-54; sal.receipt-list payments/route.ts:95 and :129-130 (both halves required, branch scope). 'Warehouse' is inv.stock_locations, branch-scoped (20260723093000_inv_reference.sql:312). Filter persistence exists at the schema: rpt.saved_filters (filter_definition jsonb, scope_level, owner-only RLS; 20260724096000_rpt_reporting.sql:132-200) and the per-report filter allow-list parameter_schema (:70-80), projected by the read (report-catalogue-service.ts:51-55).
- **Remaining gap:** No report execution consumes any filter; no operation reads or writes rpt.saved_filters (grep of apps/api/src outside modules/reporting: none); the receipt list's period filter is UNVERIFIED; a company-wide (multi-branch) aggregate has no read anywhere — every money read is single-branch.
- **Owning module:** reporting module (execution + saved filters); inventory and billing read models for the filter semantics.
- **Delivery placement:** P1-31 Backend prerequisite lane (execution filters, saved-filter operations) and P1-31 UI. Reason: the schema half is delivered (P1-11), the operation half is absent.
- **Dependencies:** OWR-2026-09-06-A-1; OWR-2026-09-06-A-2 (a branch filter outside the principal's scope must refuse, not silently narrow — precedent stock-availability/route.ts:19-21).
- **Acceptance criteria:** The same metric requested with occurredFrom/occurredTo, then with a branchId, then with a locationId, returns strictly nested figures that equal the corresponding filtered list read; a saved filter created by user A is invisible to user B (tests/db/rpt-reporting.test.ts:45 already proves this at the table).
- **Unverified:** Whether sal.receipt-list accepts a received-at window.

### OWR-2026-09-06-A-5 — Owner requirement · **Planned**

> data freshness

- **Normalised behaviour:** Every report response states when its figures were computed and on what basis (live query or snapshot), so a viewer can tell how stale a figure is.
- **Existing evidence:** No read states freshness. Today every relevant read is computed live on request: sal.invoice-outstanding-read (apps/api/src/app/api/v1/invoices/[invoiceId]/outstanding/route.ts:5-10 'nothing stores a balance'), inv.inventory-reconciliation-read re-derives from the ledger on each call (inventory-reconciliations/route.ts:4-7), svc.price-resolve returns the `asOf` it resolved at (apps/api/src/app/api/v1/prices/route.ts:25 and :126-135). No snapshot, cache or materialized view exists (catalog query: zero views/matviews). Grep for computedAt/generatedAt/freshness in apps/api/src: none.
- **Remaining gap:** A `computedAt` (server clock) and `basis` field on every report response; a rule that a snapshot, if ever introduced, states its own instant.
- **Owning module:** reporting module response contract.
- **Delivery placement:** P1-31 Backend prerequisite lane, inside the execution contract. Reason: cheap while the baseline is live-computed; expensive to retrofit after a snapshot exists.
- **Dependencies:** OWR-2026-09-06-A-1; OWR-2026-09-06-A-15 (proposed response envelope policy).
- **Acceptance criteria:** Every report response carries computedAt as an ISO instant not earlier than the request start and the UI renders it beside the figures in Arabic and English; a test asserts the field is present on every registered metric.
- **Unverified:** None.

### OWR-2026-09-06-A-6 — Owner requirement · **Blocked**

> source-record drill-through

- **Normalised behaviour:** From any report figure the viewer can reach the records it was computed from, via an existing list or detail read narrowed to the same filter, and never via a link to a read that does not exist.
- **Existing evidence:** Source links exist in the data: sal.financial_events.source_type/source_id provenance-guarded (20260724093000_sal_financial_events.sql:22-52, :54 onward); sal.invoice_lines.source_service_line_id/source_part_issue_id/source_quotation_item_id (20260724091000_sal_invoices.sql:246-248); inv.stock_movements reference kinds opening_line/part_issue/part_return/damage/adjustment (apps/api/src/modules/inventory/domain/inventory.ts:38-44) and workOrderId filter (stock-movements/route.ts:48). Drill targets delivered by P1-27..P1-30: /work-orders, /invoices (detail only), /payments (receipt list), /inventory, /quotations (per work order).
- **Remaining gap:** No figure exists to drill from. Missing drill targets: no invoice list (register row 'Invoice', INT-083), no tenant-wide quotation list (405), no cross-domain timeline (register 'Cross-phase — the three histories', INT-104/INT-043). The reports nav href /reports has no page.
- **Owning module:** reporting module (each metric declares its drill operation + filter); web features that own the target screens.
- **Delivery placement:** P1-31 UI, after the P1-31 Backend prerequisite lane; drill targets that need a new list read (invoice list) belong to the P1-30 corrective lane per the register. Reason: a link to a non-existent read is the P1-27 dominant defect class (assumed read model).
- **Dependencies:** OWR-2026-09-06-A-1, A-4; P1-30 register rows 'Invoice' (INT-083) and 'Quotation' (INT-060); OWR-2026-09-06-A-16 (proposed drill policy).
- **Acceptance criteria:** For each shipped metric a test follows its declared drill operation with the echoed filter and the returned item count equals the metric's count; a human clicking a figure lands on a list already narrowed to the same branch and period.
- **Unverified:** None.

### OWR-2026-09-06-A-7 — Owner requirement · **Undecided**

> useful alerts

- **Normalised behaviour:** The platform surfaces, to viewers within scope, conditions the Owner names as needing attention (each defined as a metric plus a tenant-set condition), with a link to the records that triggered it.
- **Existing evidence:** No alert mechanism. Notifications exist as infrastructure only: purposes transactional/marketing/system (apps/api/src/modules/shared-services/domain/notification-policy.ts:43); the notifications nav entry is 'planned' (navigation.ts:431-439); no business module enqueues a notification (grep of apps/api/src/modules outside shared-services: none; register P1-29 row 'Notify the assigned employee' Blocked INT-100). CRM customer alerts (register P1-27 row 12) are per-customer flags, not operational alerts.
- **Remaining gap:** The alert list and the conditions are business rules the Owner has not stated (no thresholds, no ageing windows, no stock minimums may be invented). No threshold storage, no evaluation, no delivery path.
- **Owning module:** reporting module (alert = metric + condition), shared-services notifications for delivery, rpt configuration tables for the tenant-set conditions.
- **Delivery placement:** Owner decision first (which alerts, and that conditions are tenant-configured); computed-on-read alerts in P1-31; pushed delivery after INT-100's module-raised notification path lands (P1-29 remediation lane). Reason: Undecided rule; and a pushed alert needs a trigger path that does not exist.
- **Dependencies:** Owner alert list; OWR-2026-09-06-A-3; INT-100; OWR-2026-09-06-A-17 (proposed alert policy).
- **Acceptance criteria:** An alert defined for a tenant fires when and only when its condition is met on real records, shows the triggering record count with a drill link, and is invisible to a principal outside the branch; no alert ships with a hard-coded number.
- **Unverified:** None.

### OWR-2026-09-06-A-8 — Owner requirement · **Planned**

> Separate measured facts, estimates, and recommendations.

- **Normalised behaviour:** Every figure or statement a report shows is labelled as a measured fact (computed from recorded events), an estimate (derived under stated assumptions), or a recommendation, and the three are never mixed in one number.
- **Existing evidence:** The vocabulary exists only in diagnostics: dia.measurements (20260722103000_dia_findings_measurements_evidence.sql:151), dia.findings (:92), dia.recommendations (:307) are distinct tables. The platform stores no estimates: quotation draft totals are database zeros until issue (P1-30 W3 record), expected/approved/final cost is partly blocked (register P1-30 row, INT-070), and the frontend program forbids invented counts or service levels (docs/product/README.md §0.1).
- **Remaining gap:** No reporting basis label; no estimate producer exists anywhere, so the Phase 1 baseline can only ship measured facts; recommendations belong to the analytics follow-on (A-11).
- **Owning module:** reporting module response contract.
- **Delivery placement:** P1-31 Backend prerequisite lane for the `basis` label (baseline emits only 'measured'); estimates and recommendations in the named analytics follow-on slice. Reason: labelling is cheap now and prevents a later estimate being read as a fact.
- **Dependencies:** OWR-2026-09-06-A-11; OWR-2026-09-06-A-15.
- **Acceptance criteria:** Every metric in the registry declares basis; the P1-31 build's registry contains no basis other than 'measured'; the UI renders the label beside every figure.
- **Unverified:** None.

### OWR-2026-09-06-A-9a — Owner requirement · **Contracted**

> Revenue, cash received, receivables, and profit must retain their different meanings

- **Normalised behaviour:** Revenue (issued invoice gross, less approved credit notes), cash received (recorded receipts not reversed), and receivables (open receivable per invoice) are computed from their own source events, each shown with its currency, and never substituted for one another or summed across currencies.
- **Existing evidence:** The three source facts are distinct and provenance-bound: event types invoice_issued / receipt_recorded / payment_allocated / credit_note_issued / receipt_reversed / warranty_split_recorded (20260724093000_sal_financial_events.sql:48-52; docs/phase-1/phase-1-11/phase-1-11-financial-event-catalogue.md:13-22). Receivable per invoice: sal.invoice_open_receivable (:129-147) = gross − non-reversed allocations − approved credits; exposed by sal.invoice-outstanding-read with currency always beside the amount (outstanding/route.ts:22-25). Payment state is derived, never stored (docs/product/workshop/pricing-payment-and-delivery.md:540-549). Cross-currency trap recorded: sal.partner_outstanding_balance is deliberately NOT exposed because it sums USD and JOD (outstanding/route.ts:27-34). No general ledger, by design (docs/phase-1/phase-1-11/phase-1-11-no-general-ledger-boundary.md:9-13). Warranty share of a line is a separate payer amount (sal.invoice_line_amounts.customer_pay_amount/warranty_pay_amount, 20260724091000_sal_invoices.sql:331-336; always zero today, PPD-04).
- **Remaining gap:** No aggregate read of any of the three over a period or branch; the credit-note treatment of 'revenue' and whether warranty_pay_amount counts as revenue are definitions the Owner must confirm; all three must be per-currency series.
- **Owning module:** billing + payments read models (sal schema), consumed by the reporting module.
- **Delivery placement:** P1-31 Backend prerequisite lane (period/branch aggregates over sal.financial_events per currency) and P1-31 UI. Reason: the source facts are Delivered and gated; only the aggregate contract is missing.
- **Dependencies:** OWR-2026-09-06-A-3 (the Owner's definition of revenue with respect to credit notes and warranty share); sal.finance.view; existing register rows 'Payment state — paid / partially paid / unpaid only where supported' and 'Accounting handoff' (P1-30).
- **Acceptance criteria:** On a branch with one issued invoice and one partial receipt, revenue equals the invoice gross, cash received equals the receipt amount, receivable equals gross minus the allocation, each with the invoice currency; a second invoice in another currency produces a second series, never a summed figure.
- **Unverified:** None.

### OWR-2026-09-06-A-9b — Owner requirement · **Undecided**

> and profit

- **Normalised behaviour:** Profit is shown only when a cost of sale can be attributed to the revenue it is compared with, under a costing basis the Owner has approved; otherwise the report states that profit is not derivable rather than showing a number.
- **Existing evidence:** No cost-of-sale attribution exists. sal.invoice_lines carry source_part_issue_id (20260724091000_sal_invoices.sql:247) but inv.part_issues carry no cost column (20260723095000_inv_operations.sql:260-289). Item cost exists only as a standard cost in a restricted table used by no read operation: inv.item_cost_details.standard_cost (20260723093000_inv_reference.sql:267-286; inventory-read-service.ts:39 'Carries no cost'; docs/product/workshop/pricing-payment-and-delivery.md:902 and :1106 'inv.cost.view used by no operation'). External purchase unit cost: inv.external_purchase_part_details.unit_cost (:551), restricted. Labour cost: tech.labor_sessions carries no rate or cost column (grep of 20260722099000_tech_labor_sessions.sql and 20260722094000_tech_profiles_skills_certs.sql for numeric/rate/cost: none). Rework cost is an internal quality KPI gated by iam.sensitive.view and explicitly not a billing artifact (20260722105000_qms_rework_closure_gate.sql:253-279).
- **Remaining gap:** A costing basis (standard vs purchase cost for parts; whether and how labour is costed) is an Owner commercial decision; the schema link from an invoice line to the cost of what it sold; a read that projects cost under inv.cost.view.
- **Owning module:** inventory (inv cost tables), technician (labour), billing (line-to-cost link), reporting.
- **Delivery placement:** Owner decision, then a Backend lane owned by the inventory/billing schema phases under change control; not P1-31 UI scope until the contract exists. Reason: Undecided rule; a profit figure without an approved cost basis would be an invented number.
- **Dependencies:** Owner costing decision; register P1-30 row 'Expected / approved / final cost' (INT-070); OWR-2026-09-06-A-10 (honest cost exposure); OWR-2026-09-06-A-19 (proposed profit policy).
- **Acceptance criteria:** Until the decision, the reports page shows profit as 'not derivable — cost basis not configured' in both languages and never a zero; after it, profit for one invoice equals its revenue minus the attributed cost with both inputs visible to a viewer holding sal.finance.view and inv.cost.view.
- **Unverified:** None.

### OWR-2026-09-06-A-10 — Owner requirement · **Planned**

> expose incomplete cost data honestly

- **Normalised behaviour:** Any cost-bearing figure states how much of its input has a recorded cost (records with cost / records in the set), and when coverage is incomplete the figure is shown as partial or withheld — never computed as if a missing cost were zero.
- **Existing evidence:** Null-not-zero precedent for money the caller may not see: apps/web/src/features/billing/billing-contract.ts:94 and components/InvoiceScreen.tsx:63 ('never zero, never blank'). Cost is physically separated and gated (inv.item_cost_details, inv.external_purchase_part_details, inv.stock_adjustment_details: 20260723095000_inv_operations.sql:237, :569). Items can exist with no cost row (1:1 detail is optional by construction: uq_item_cost_details_item partial index :293).
- **Remaining gap:** No coverage rule, no read that projects cost at all, and the distinction between 'cost withheld by permission' and 'cost never recorded' is not represented anywhere.
- **Owning module:** inventory read model + reporting response contract.
- **Delivery placement:** P1-31 Backend prerequisite lane (the coverage pair on every cost-bearing metric), alongside A-9b once its decision lands. Reason: it is the honesty contract the profit line depends on.
- **Dependencies:** OWR-2026-09-06-A-9b; inv.cost.view; OWR-2026-09-06-A-15.
- **Acceptance criteria:** With two part issues of which one item has a cost row, the cost metric reports coverage 1 of 2 and no total; a principal without inv.cost.view sees 'not available to you', which is rendered distinctly from 'not recorded'.
- **Unverified:** None.

### Reports — Owner requirement · **Blocked**

> Extend the reporting backend and P1-31 reporting UI for the approved operational baseline

- **Normalised behaviour:** The rpt backend gains report execution for an Owner-approved baseline set of operational reports, and P1-31 ships a /reports screen that renders them in Arabic/English, RTL/LTR, with loading/empty/error/permission states, on a production build accepted by the Owner.
- **Existing evidence:** Existing register row 'Reports' under P1-31 (docs/product/owner-workflow-requirements.md:289) — status there is 'Blocked until #206 … now fixed and reachable', which describes only the two catalogue operations answering 200. What P1-23 built and recorded as a limitation: report-catalogue-service.ts:11-24, gate-record.md:266 (P1-23-A-02). What P1-11 handed to the reporting backend: phase-1-11-p1-23-reporting-backend-contract.md:12-19 (config, versions, export gate, saved filters, financial source facts, outstanding derivations) and :31-35 (datasets, KPI definitions, export renderer — not built). Export authorisation exists but produces no file and covers only documents, outbound_messages, branches (export-policy.ts:1-11, :113, :141, :174; exports/authorizations/route.ts:48-59). Frontend owner of reporting was 'Not established' at the journey mapping (end-to-end-workshop-workflow.md:1226); the register has since named P1-31.
- **Remaining gap:** The approved baseline itself (Owner statement, frontend-implementation-program.md:203-208); execution and dataset binding; a writer for rpt.report_configurations (rpt.report.configure has no operation); the administrator bundle does not hold rpt.report.read (a0-read-surface-matrix.md:326-337), so on a fresh organisation nobody can open /reports; the P1-31 canonical plan does not exist in the repository.
- **Owning module:** apps/api/src/modules/reporting; rpt schema; apps/web/src/features/reporting + (dashboard)/reports (to be created); navigation.ts reports entry.
- **Delivery placement:** P1-31: A0 measurement of the reporting read surface (as P1-30 A0 did), a Backend prerequisite lane for execution/definitions/configure writer, then the reporting UI W-item; the bundle fix belongs to the P1-30 tenant-bootstrap corrective lane (§6.3 window). Reason: register ownership row; P1-30's measured-before-claimed method.
- **Dependencies:** Owner baseline statement (A-3); OWR-2026-09-06-A-1..A-6; F-01 bundle residual for rpt.report.read; OWR-2026-09-06-A-18 (proposed configure/bootstrap policy).
- **Acceptance criteria:** On a fresh organisation the first administrator can open /reports, sees the baseline definitions, runs each on real records and the figures match the module screens; PC-1 proved on a real response (authorised sees, unauthorised refused, cross-tenant invisible); Owner verdict recorded on a production build.
- **Unverified:** The P1-31 task list in the Owner's Phase 1 plan DOCX (outside Git).

### OWR-2026-09-06-A-11 — Owner requirement · **Planned**

> assign broader analytics and prediction to explicit delivery slices

- **Normalised behaviour:** Cross-period comparison, estimates, trends and any predictive figure are excluded from the Phase 1 reporting baseline and are recorded as named follow-on delivery slices with their own entry criteria, rather than being implied by the P1-31 scope.
- **Existing evidence:** None in code. The phase boundary table lists P1-27..P1-31 then the Integration gate (owner-workflow-requirements.md:31-37); the no-fake-data policy (memory: business tables start empty) and docs/product/README.md §0.1 (no invented counts) mean no analytics or prediction can be demonstrated before a live pilot produces data. The out-of-scope register (P1-OOS-*) lives in the Phase 1 plan DOCX and is referenced only via ADR-010 / qa-readiness.md:85; whether it names analytics is UNVERIFIED.
- **Remaining gap:** Two follow-on slices to be named in the register: 'Analytics slice' (comparisons, estimates, trends — basis 'estimated') and 'Prediction slice' (forecasts — requires measured pilot data and an Owner decision on what may be predicted). Neither exists as a row today.
- **Owning module:** Register and programme planning; later the reporting module.
- **Delivery placement:** Explicit follow-on after the Integration gate, i.e. beyond Phase 1 — recorded now as two Planned rows so they cannot drift into P1-31. Reason: the Owner's own instruction, plus the data prerequisite.
- **Dependencies:** A live pilot tenant producing real operational data; OWR-2026-09-06-A-8 (basis label) so analytics figures are labelled 'estimated'; Owner decision on which predictions are wanted.
- **Acceptance criteria:** The register carries two named follow-on rows with entry criteria; the P1-31 metric registry contains no metric whose basis is other than 'measured' and no cross-period comparison; a gate test can assert that.
- **Unverified:** Contents of the P1-OOS register regarding analytics or BI.

### OWR-2026-09-06-A-12 — Proposed implementation policy · **Planned**

> (policy proposed for) Analyze the operational data of every delivered module

- **Normalised behaviour:** A report definition binds a report_code to a code-registered dataset (a frozen registry in the reporting module, mirroring EXPORT_RESOURCES: table/operation, allowed filters, required permissions, scope); tenant configuration may select, name, scope and version a registered dataset but can never supply a query, a table name or a column.
- **Existing evidence:** Pattern already proven for exports: apps/api/src/modules/shared-services/domain/export-policy.ts:13-23 (a resource is registered or cannot be exported; fields are an allow-list; every column asserted against information_schema by tests/db/p1-15-export-authorization.test.ts). The rpt schema's own rationale for having no data-source column: report-catalogue-repository.ts:14-19.
- **Remaining gap:** The registry, its schema assertion test, and the mapping from rpt.report_configurations.report_code to a registry id.
- **Owning module:** apps/api/src/modules/reporting/domain (new) + rpt.report_configurations.
- **Delivery placement:** P1-31 Backend prerequisite lane. Reason: keeps a pilot tenant's report set out of code (ADR-008 configuration-driven) while keeping SQL out of tenant data.
- **Dependencies:** Reports (row); OWR-2026-09-06-A-3.
- **Acceptance criteria:** A tenant configuration naming an unregistered dataset is refused at publish; a test asserts every registered dataset's columns exist in protected schema; no route accepts a query string that reaches SQL.
- **Unverified:** None.

### OWR-2026-09-06-A-13 — Proposed implementation policy · **Planned**

> (policy proposed for) within the viewer's authorized scope

- **Normalised behaviour:** Extend the P1-30 closure sentence to reporting: no reporting screen computes, sums, averages or converts a figure; every metric is one server query under RLS with companyId/branchId required and authorised (authorizeScope, not RLS alone); a metric the caller may not see is null, never zero, and a cross-branch figure exists only when the caller's scope covers every branch it sums.
- **Existing evidence:** docs/phase-1/phase-1-30/canonical-plan.md:76-85 ('P1-30 RENDERS SERVER ARITHMETIC ONLY', the mechanical gate A0 names); stock-movements/route.ts:40-45 (why companyId/branchId are required); billing-contract.ts:94 (null totals).
- **Remaining gap:** A reporting variant of the server-arithmetic gate over apps/web/src/features/reporting, and the null-vs-zero rule in the response contract.
- **Owning module:** reporting module; scripts (the arithmetic gate); apps/web reporting feature.
- **Delivery placement:** P1-31 A0 (gate) and Backend prerequisite lane (contract). Reason: same defect class P1-30 closed by gate rather than discipline.
- **Dependencies:** OWR-2026-09-06-A-2; the existing P1-30 server-arithmetic gate script (name UNVERIFIED here).
- **Acceptance criteria:** The gate fails on any arithmetic operator applied to a money or quantity value in the reporting feature; a principal lacking sal.finance.view receives null money fields on every metric and the page renders 'not available to you'.
- **Unverified:** The file name of the P1-30 server-arithmetic gate.

### OWR-2026-09-06-A-14 — Proposed implementation policy · **Undecided**

> (policy proposed for) Provide defined metrics

- **Normalised behaviour:** The Phase 1 baseline registry is proposed as the measured facts already derivable from delivered contracts, for the Owner to approve or cut: counts of work orders and jobs by state; appointments by status; receptions accepted/refused; diagnostic reports completed; QC records passed/failed and rework links; invoiced gross, credits, cash received and open receivable per currency per branch per period (sal.finance.view); receipts by payment method; stock on-hand/reserved/available per location and movements by kind (inv.stock.read); reservations open; labour session hours per technician.
- **Existing evidence:** Each candidate maps to a delivered read: wo.* and wo.job_* tables (20260722095000_wo_work_orders.sql:37, 20260722097000_wo_jobs.sql:31), apt.appointment-list, rec.* reads, dia.diagnostic-list, qms.qc-record-list / qms.rework-list, sal.financial_events per event_type (20260724093000_sal_financial_events.sql:48-52), sal.receipts.payment_method_id (20260724092000_sal_payments.sql:84), inv.stock_balances (20260723094000_inv_ledger.sql:103-130), inv.stock_movements, inv.stock-reservation-list, tech.labor_sessions.
- **Remaining gap:** Owner approval of the list; no prices, quotas or thresholds are proposed because the Owner gave none.
- **Owning module:** reporting registry.
- **Delivery placement:** Owner decision now; implementation in the P1-31 Backend prerequisite lane. Reason: gives the Undecided line A-3 a concrete proposal to accept or amend without inventing definitions.
- **Dependencies:** OWR-2026-09-06-A-3; OWR-2026-09-06-A-12.
- **Acceptance criteria:** The Owner marks each candidate approved or cut in the register; every approved metric has a registry entry with definition text and a drill operation.
- **Unverified:** None.

### OWR-2026-09-06-A-15 — Proposed implementation policy · **Planned**

> (policy proposed for) data freshness / separate measured facts, estimates, and recommendations / expose incomplete cost data honestly

- **Normalised behaviour:** Every metric response carries: computedAt (server instant), basis ('measured' only in Phase 1), scope actually applied (companyId, branchId, locationId), period bounds as ISO instants, a currency code beside every amount (never a currency-less or cross-currency sum), and for cost-bearing metrics a coverage pair (records with cost / records in set) with the total withheld while coverage is incomplete.
- **Existing evidence:** Currency-beside-amount rule: outstanding/route.ts:22-34; instants-not-dates rule: stock-movements/route.ts:51-53; asOf echo precedent: prices/route.ts:126-135; decimal-string money invariant (register P1-30 row 'Decimal-string money, ISO currency codes' — Delivered, gate-enforced).
- **Remaining gap:** The envelope itself and a contract test over every registered metric.
- **Owning module:** reporting module response contract; web reporting feature rendering.
- **Delivery placement:** P1-31 Backend prerequisite lane. Reason: one envelope satisfies A-5, A-8 and A-10 together.
- **Dependencies:** OWR-2026-09-06-A-5, A-8, A-10.
- **Acceptance criteria:** A contract test asserts the six fields on every metric; a metric over two currencies returns two series; a cost metric with partial coverage returns coverage and null total.
- **Unverified:** None.

### OWR-2026-09-06-A-16 — Proposed implementation policy · **Planned**

> (policy proposed for) source-record drill-through

- **Normalised behaviour:** Every registry metric declares the operation id and filter mapping that reproduces its record set on an existing list read; a metric whose drill target does not exist yet (invoice list, tenant-wide quotation list) ships with its count and no link, and the missing read is recorded as a P1-30 corrective dependency rather than invented in the Frontend.
- **Existing evidence:** Register P1-30 rows 'Invoice' (INT-083 no invoice list) and 'Quotation' (INT-060); P1-30 W3 fact that the quotation list is per work order (apps/api/src/app/api/v1/work-orders/[workOrderId]/quotations/route.ts:9-12); the P1-27 rule that a Frontend never invents a read.
- **Remaining gap:** The declaration field in the registry and a test that follows each declared drill.
- **Owning module:** reporting registry; web reporting feature links.
- **Delivery placement:** P1-31 Backend prerequisite lane + UI. Reason: prevents dead links, the register's documented-is-not-implemented failure at screen level.
- **Dependencies:** OWR-2026-09-06-A-6; P1-30 corrective lane for the invoice list.
- **Acceptance criteria:** A test follows every declared drill and asserts count equality; a metric without a drill renders no link and the register names the blocking read.
- **Unverified:** None.

### OWR-2026-09-06-A-17 — Proposed implementation policy · **Undecided**

> (policy proposed for) useful alerts

- **Normalised behaviour:** An alert is a registry metric plus a condition stored as tenant configuration in the rpt schema (Owner-approved condition shapes, tenant-set values; nothing hard-coded); it is evaluated on read in Phase 1 and shown on the reports page with a drill link; pushed delivery reuses shared notifications with purpose 'system' only after a module-raised notification path exists.
- **Existing evidence:** notification-policy.ts:43 (purposes); rpt.report_configuration_versions.parameter_schema as a versioned tenant-config carrier (20260724096000_rpt_reporting.sql:70-80); INT-100 (no module raises a notification).
- **Remaining gap:** Condition storage, evaluation, the Owner's alert list.
- **Owning module:** reporting module; rpt configuration tables (a condition column or version schema — needs its own migration under change control); shared-services notifications for delivery.
- **Delivery placement:** Owner decision, then P1-31 for on-read alerts; pushed alerts after INT-100 lands. Reason: separates what can ship without a trigger path from what cannot.
- **Dependencies:** OWR-2026-09-06-A-7; INT-100; a migration for condition storage (rpt tables are ROLLBACK-SAFE while unused, 20260724096000_rpt_reporting.sql:7-8).
- **Acceptance criteria:** No literal number appears in alert code; changing a tenant's condition changes which records trigger; an alert never fires for a branch outside the viewer's scope.
- **Unverified:** None.

### OWR-2026-09-06-A-18 — Proposed implementation policy · **Blocked**

> (policy proposed for) Extend the reporting backend and P1-31 reporting UI

- **Normalised behaviour:** Before any report UI: (1) add rpt.report.read to the administrator bundle written at provisioning, with a backfill decision for existing organisations; (2) add the rpt.report.configure operations (create, version, publish, archive) so a catalogue row can exist; (3) decide whether the approved baseline definitions are published for every new organisation at provisioning as platform configuration — never as business data — so a fresh organisation's /reports is not empty.
- **Existing evidence:** F-01 residual: a0-read-surface-matrix.md:326-337 ('rpt.report.read … undocumented and unrecorded', the 48-code bundle derived by walking one phase's routes); rpt.report.configure is asked for by no operation (end-to-end-workshop-workflow.md:1108-1113); live rpt tables hold zero rows; ADR-008 configuration-driven onboarding; memory: a platform vocabulary is a declared seed, never a migration.
- **Remaining gap:** All three items; item (3) is an Owner decision (which reports every organisation starts with).
- **Owning module:** iam bootstrap (platform module withPlatformTarget, tenant provisioning); reporting module writers; rpt schema.
- **Delivery placement:** (1) P1-30 tenant-bootstrap corrective lane (§6.3 window, one migration for the bundle + backfill); (2) and (3) P1-31 Backend prerequisite lane. Reason: reachability on a fresh organisation is the acceptance environment every phase closes on.
- **Dependencies:** Reports (row); Owner decision on default definitions; F-02 (eleven master-data tables with no writer) as the same defect class.
- **Acceptance criteria:** On a fresh organisation the first administrator holds rpt.report.read, can publish a configuration, and GET /reports is non-empty; an existing organisation gains the code by the backfill; no seeded row contains business data.
- **Unverified:** None.

### OWR-2026-09-06-A-19 — Proposed implementation policy · **Undecided**

> (policy proposed for) and profit

- **Normalised behaviour:** Profit is not computed until the Owner chooses a costing basis; when chosen, cost of sale is attributed at issue time by linking each invoice line to the cost record of what it sold (part issue → item cost or external purchase unit cost; labour → a rate the Owner defines), frozen with the invoice, and readable only under sal.finance.view + inv.cost.view; standard cost is labelled 'estimated' if the Owner selects it over actual purchase cost.
- **Existing evidence:** Line-to-source links exist (sal.invoice_lines.source_part_issue_id, 20260724091000_sal_invoices.sql:247); cost tables exist and are gated (20260723093000_inv_reference.sql:267-286; 20260723095000_inv_operations.sql:545-570); invoice amounts freeze at issue (20260724091000_sal_invoices.sql:190-207); no labour rate exists.
- **Remaining gap:** The decision; a cost-attribution table or columns (schema change under change control, roll-forward-only once financial); the labour rate model.
- **Owning module:** billing (sal) + inventory (inv) schema owners; reporting for the read.
- **Delivery placement:** Owner decision; then a Backend lane after P1-30's corrective slice; reporting of profit only after that lands — outside the P1-31 baseline. Reason: an unfrozen or re-derived cost would move a historical profit figure, contradicting the frozen-invoice invariant.
- **Dependencies:** OWR-2026-09-06-A-9b; A-10; register P1-30 row 'Expected / approved / final cost'.
- **Acceptance criteria:** Profit for an issued invoice does not change when the item's standard cost is later edited; a viewer lacking inv.cost.view sees revenue and 'cost not available to you', never a profit number.
- **Unverified:** None.

---

## Area B — Inventory

**Where this area stands today.** What exists: the inv schema is a complete, provenance-guarded stock ledger — append-only movements with a GENERATED signed quantity, coherence-guarded balances (on-hand/reserved/available), atomic reservations, issues addressed to an open work order, returns addressed to their issue with a three-times-enforced ceiling, damage moved into a quarantine location that cannot be reserved or issued, units of measure with exact 3-decimal quantities, and restricted cost tables under inv.cost.view; seventeen inv.* operations publish the ten reads and writes that the W4 (/inventory, PR #317) and W5 (/inventory/parts, /inventory/movements, PR #318) screens consume on protected develop 6f6236c3. What is missing: no writer for items, categories, units or stock locations (F-02/S-05 — live catalog holds 0 items and 0 locations across 9 tenants), no receipt, transfer or in-transit concept (the transfer kind and transit type were dropped in P1-10), no route out of quarantine (the adjustment surface has no route), no supplier return, no cost on any movement and no cost read, and no definition of a cross-company accounting boundary — the boundary is enforced only by the impossibility of crossing a branch. One live defect is located exactly: returnedQty is published as '0' before any return and '1.000' after because the COALESCE fallback in inventory-repository.ts:757-760 and :1261-1264 is an integer, not numeric(12,3). Where it lands: the writers, the returnedQty scale fix and the adjustment routes are P1-30 correctives on the remediation/p1-30-backend-* lane pending the Owner's F-02 decision; receipts, transfers, in-transit, supplier returns and cost lineage are P1-21-owned Backend slices that need Owner decisions (PROC-18 procurement, valuation method, transfer model) and are outside P1-30 field 5; the cross-company boundary is Undecided and can only be proved at the Integration gate after transfers and the accounting handoff exist. The register's P1-30 rows 'Part issue', 'Part consumption' and 'Part return' should move to Delivered (with INV-14 noted) and 'Internal inventory parts' stays Blocked on the location writer; no W4/W5 record file exists under docs/phase-1/phase-1-30/, so the evidence cited is the merged tests and PRs.

### Internal inventory parts — Owner requirement · **Blocked**

> Support multiple warehouses and locations

- **Normalised behaviour:** A tenant can define, per branch, more than one warehouse with storage and quarantine locations nested under it, and every stock operation names one of those locations.
- **Existing evidence:** Schema: inv.stock_locations, branch-scoped, types warehouse|storage|quarantine, parent must be a warehouse in the same scope (supabase/migrations/20260723093000_inv_reference.sql:312-338; hierarchy guard :88-113). Every inv operation table FKs to it (part_issues :260, damaged_stock :382, stock_movements 20260723094000_inv_ledger.sql:42). Read: inv.stock-location-list GET /stock-locations, inv.stock.read, branch target (apps/api/src/app/api/v1/stock-locations/route.ts:57-64; A0 seam S-16, docs/phase-1/phase-1-30/a0-read-surface-matrix.md:289). Screen: LocationPicker/useLocations in apps/web/src/features/inventory/components/shared.tsx, used by /inventory (W4, PR #317) and /inventory/parts (W5, PR #318). Tests: tests/backend/p1-30-w4-inventory.test.ts (fixtures create locations directly via tests/backend/p1-21-helpers.ts, not through a route).
- **Remaining gap:** No writer exists for inv.stock_locations in apps/api, seeds or migrations (F-02 / S-05, a0-read-surface-matrix.md:104-106; PROC-09 docs/product/workshop/parts-and-procurement-flow.md:691); live catalog: 0 rows across 9 tenants. No permission code covers location management. A second, structure-only location model exists (org.warehouses :157 and org.storage_locations :210 in 20260717104000_org_operational_structure.sql) that inv.stock_locations never references (its FKs are to org.branches only) — two unreconciled location models. INT-066 ('no location list') is closed by S-16; the row stays blocked on the writer.
- **Owning module:** apps/api/src/modules/inventory (P1-21 lane); schema inv.stock_locations; org.warehouses reconciliation is org/P1-03
- **Delivery placement:** P1-30 corrective on remediation/p1-30-backend-* (a writer over an existing table is the class-C S-05 seam; the branch remediation/p1-30-backend-commercial-setup is the natural carrier) — gated by the Owner's F-02 decision recorded in docs/phase-1/phase-1-30/tenant-bootstrap-corrective-slice.md §4. The administration screen is not in the P1-30 field-5 scope and needs an Owner scope addition or an Integration-gate setup screen.
- **Dependencies:** Owner decision F-02 (which master-data writers ship and in which lane); decision whether org.warehouses/org.storage_locations are retired or become the source inv.stock_locations mirrors; a permission code for location management (RES-05: mint only with a catalogue change).
- **Acceptance criteria:** On a fresh organisation an administrator creates a warehouse, a storage location under it and a quarantine location; GET /stock-locations?companyId&branchId lists all three in code order; a storage location with no parent, or a parent that is not a warehouse, is refused with a 422; the W4 location picker shows the new rows without a fixture.
- **Unverified:** Whether the Owner's DOCX register (outside git) allocates location administration to P1-30 — not checkable from the repository.

### OWR-2026-09-06-B-1 — Owner requirement · **Delivered**

> units and fractional quantities where appropriate

- **Normalised behaviour:** Every item carries a unit of measure, quantities are exact decimals to three places end to end, and a fractional quantity is accepted only where the item's unit permits it.
- **Existing evidence:** inv.units_of_measure dual-scope catalog with dimension count|mass|volume|length|area|time (20260723093000_inv_reference.sql:116-139); 12 platform units seeded (supabase/seeds/07_inv_units_of_measure.sql; live count 12); inv.item_master.uom_id with the cross-tenant guard (:71-86, :210-266). Every quantity column is numeric(12,3) (inv_ledger.sql:51,188; inv_operations.sql:115,164,270,317,390). Exact-decimal Quantity domain type, scaled BigInt, QUANTITY_MIN '0.001' (apps/api/src/modules/inventory/domain/inventory.ts:172-285); route regex ^\d{1,9}(\.\d{1,3})?$ (apps/api/src/app/api/v1/stock-returns/route.ts:33-38). ItemView.unitOfMeasure.code rendered by W4; Qty renders the server string verbatim (apps/web/src/features/inventory/components/shared.tsx:134-139). Tests: tests/backend/p1-21-inventory-stock.test.ts:144-160 ('3.500'), :195 ('0.001'); tests/db/p1-10-precision.test.ts:43-64.
- **Remaining gap:** 'Where appropriate' is not enforced: an item in 'each' or 'pair' accepts 0.001 exactly as a litre does — no per-unit or per-item fractional flag exists (units_of_measure columns: scope, tenant_id, code, name, dimension, status). No unit-of-measure list route and no tenant-unit writer (inv.item.manage is seeded and used by no route, PROC-08). No unit conversion. A fresh organisation has zero items, so the path is exercisable only through fixtures (F-02).
- **Owning module:** apps/api/src/modules/inventory; schema inv.units_of_measure, inv.item_master
- **Delivery placement:** Exact 3-decimal quantities and unit display are on protected develop (W4 #317, W5 #318). The per-unit fractional rule is a schema change owned by the P1-21 lane, proposed as part of OWR-2026-09-06-B-15 (item/unit/location writers) on the P1-30 backend corrective lane.
- **Dependencies:** F-02 (items must be creatable); Owner decision listing which units allow fractions; INV-15 writers.
- **Acceptance criteria:** An issue of '0.250' of a litre-measured item posts a movement whose quantity reads '0.250' on the ledger and the balance; once the rule exists, an issue of '0.5' of an item whose unit disallows fractions is refused with a 422 naming the unit; no screen rounds or reformats a quantity (DOM tests assert cells equal the server strings, apps/web/tests/inventory-parts.dom.test.tsx:240-254).
- **Unverified:** No W4/W5 record file exists under docs/phase-1/phase-1-30/ (only a0-read-surface-matrix.md, canonical-plan.md, tenant-bootstrap-corrective-slice.md); the evidence named here is the merged tests and PRs #317/#318, not a phase record.

### OWR-2026-09-06-B-2 — Owner requirement · **Delivered**

> on-hand/reserved/available … stock

- **Normalised behaviour:** For each item at each location the system holds on-hand, reserved and available (= on-hand − reserved) quantities that always agree with the movement ledger and the active reservations, and a reader with inv.stock.read can see them per branch.
- **Existing evidence:** inv.stock_balances with available_qty GENERATED, three CHECKs forbidding negatives, and inv.guard_stock_balance_coherence rejecting any balance that disagrees with Σ signed movements or Σ active reservations (20260723094000_inv_ledger.sql:103-178). inv.stock-availability-read GET /stock-availability, inv.stock.read, companyId+branchId mandatory, itemId/locationId/includeQuarantine filters (apps/api/src/app/api/v1/stock-availability/route.ts:56-63); AvailabilityView {onHand, reserved, available} as strings (apps/api/src/modules/inventory/application/inventory-read-service.ts:62-73); quarantine excluded unless includeQuarantine=true (apps/api/src/modules/inventory/data/inventory-repository.ts:467-468). inv.inventory-reconciliation-read re-derives balances from the ledger (apps/api/src/app/api/v1/inventory-reconciliations/route.ts:48-56, inv.audit.read). Screen: /inventory stock panel (W4). Tests: p1-21-inventory-stock.test.ts:144-160; tests/backend/p1-30-w4-inventory.test.ts (16 cases).
- **Remaining gap:** One row per (item, location) cell only — no per-item, per-branch or per-tenant aggregate is published, and the client may not sum (canonical-plan §3, server-arithmetic gate). A cell appears only after its first movement. A fresh organisation shows nothing (F-02).
- **Owning module:** apps/api/src/modules/inventory; schema inv.stock_balances, inv.stock_movements, inv.stock_reservations
- **Delivery placement:** On protected develop (W4 #317). A server-side aggregate (item total across locations/branches) would be a P1-21-lane read published as a P1-30 corrective if the Owner wants a total on screen.
- **Dependencies:** F-02 for acceptance on a fresh organisation; INV-3 if in-transit becomes a fourth figure.
- **Acceptance criteria:** After an approved opening of 10 and a reservation of 3 the cell reads onHand '10.000', reserved '3.000', available '7.000'; a damage of 2 shows available '5.000' and the quarantine cell '2.000' only with includeQuarantine=true; GET /inventory-reconciliations reports no disagreement; a caller without inv.stock.read gets 403 and a caller scoped to another branch sees no rows.

### OWR-2026-09-06-B-3 — Owner requirement · **Undecided**

> in-transit stock

- **Normalised behaviour:** Between dispatch from one location and receipt at another, the quantity is visible as in-transit and is counted as available at neither end.
- **Existing evidence:** None. The 'transit' location type and the 'transfer' movement kind were dropped in P1-10 (apps/api/src/modules/inventory/index.ts:30-33; ck_stock_locations_type admits warehouse|storage|quarantine, inv_reference.sql:338; ck_stock_movements_type admits opening|issue|return|damage|adjustment, inv_ledger.sql:69; docs/phase-1/phase-1-21/execution-checkpoint.md:115). No column, view or read carries an in-transit figure.
- **Remaining gap:** The whole concept is absent: no transit state, no dispatch/receive pair, no figure on the availability read.
- **Owning module:** apps/api/src/modules/inventory; schema inv (new location type or transfer source table)
- **Delivery placement:** Named follow-on Backend slice on the P1-21 lane together with transfers (INV-6 / policy INV-16); not in the P1-30 field-5 scope (item search, stock balance, reservations, issues, returns, stock movements) and not in P1-31. The Integration gate proves it only after the slice lands.
- **Dependencies:** Owner decision on the transfer model (one-step vs two-step); INV-6 transfers; INV-13 accounting boundary when the ends are in different companies; the location writer (F-02).
- **Acceptance criteria:** After dispatch and before receipt the availability read shows the quantity as in-transit for the pair, not as available at source or destination; the ledger holds the out leg; receipt posts the in leg and clears the in-transit figure; a reconciliation stays clean throughout.

### OWR-2026-09-06-B-4 — Owner requirement · **Blocked**

> receipts

- **Normalised behaviour:** Stock can arrive into a location after day one through a recorded receipt that posts one 'in' movement citing the receipt as its source.
- **Existing evidence:** Inbound movement kinds today are only opening (approved batch: inv.opening-batch-create/line-create/approve, apps/api/src/app/api/v1/opening-inventory-batches/route.ts:51-64 and .../[batchId]/approval/route.ts:37-46 under inv.adjustment.approve, maker≠approver by constraint inv_operations.sql:26-38), return, and adjustment-in (inv_ledger.sql:69). inv.external_purchase_parts is a reference only — status recorded|linked|cancelled, no received state, no movement, is_procurement=false (inv_operations.sql:493-530; PROC-03; index.ts:34-36 'no goods receipt'). The register's own row 'External part receipt' is Blocked (INT-073/074) for the external-purchase special case.
- **Remaining gap:** No goods-receipt source kind, table, function or route; the only documented way for a purchased part to become stock is an opening batch or an approved adjustment, and the adjustment has no route (PROC-10, parts-and-procurement-flow.md:692, :494-497). No supplier master to receive against (register row 'External supplier' Blocked, INT-075 / PROC-05). Receipt cost has nowhere to land except the write-only external-purchase detail (INV-19).
- **Owning module:** apps/api/src/modules/inventory; schema inv (new source table + reference_kind + provenance branch)
- **Delivery placement:** Owner decision first (PROC-18: is procurement in Phase 1 scope at all). If not, a minimal 'stock receipt' source or the adjustment surface (policy INV-18) on the P1-21 lane as a P1-30 corrective makes 'stock arrived' expressible; a full goods receipt with supplier, order and invoice references belongs to a named procurement follow-on.
- **Dependencies:** PROC-18 / PROC-10 decisions; 'External supplier' row (supplier identity); INV-19 cost snapshot; F-02 writers.
- **Acceptance criteria:** On a fresh organisation, without an opening batch, a receipt of '10.000' against a supplier reference raises the cell's on-hand by 10 with exactly one 'in' movement whose reference cites the receipt; a raw INSERT of an 'in' movement without a receipt is rejected by the provenance guard; the receipt is readable afterwards.

### OWR-2026-09-06-B-5 — Owner requirement · **Delivered**

> reservations

- **Normalised behaviour:** A quantity can be held against a work order so that it lowers available stock without moving anything; the last unit has a single winner, a retried request does not reserve twice, and a hold can be released, consumed by an issue, or expire.
- **Existing evidence:** inv.stock_reservations with terminal-state guard (inv_ledger.sql:180-243); inv.reserve_stock single-winner on the balance-row FOR UPDATE lock, lifetime idempotency, opportunistic expiry (:317-353); release/consume/expire_reservations (:355-400); loss-time release junior-first (inv_operations.sql:648-674). Routes: inv.stock-reservation-create POST (201 fresh / 200 replay with replayed flag, apps/api/src/app/api/v1/stock-reservations/route.ts:159-167), inv.stock-reservation-release (.../[reservationId]/release/route.ts:45-57, not declared idempotent, reports replayed), inv.stock-reservation-list (S-14, :85-94). Quarantine cannot be reserved from (apps/api/src/modules/inventory/application/inventory-stock-service.ts:170, :808-821). Screen: /inventory reservations panel with reserve/release (W4). Tests: p1-21-inventory-stock.test.ts:201-222 (replay), :314-345 (release replay), :1027-1029 (H5 quarantine); tests/backend/p1-30-w4-inventory.test.ts.
- **Remaining gap:** Expiry has no route and no scheduler — an expired hold is retired only when the next reservation on that cell runs (lazy). No reservation detail read. Loss-time release frees whole reservations newest-first, never part of one (migration-bound, documented in inventory-stock-service.ts ~:632-645). A reservation is not tied to the required-part line it satisfies (no FK, PROC-14 analog).
- **Owning module:** apps/api/src/modules/inventory; schema inv.stock_reservations, inv.stock_balances
- **Delivery placement:** On protected develop (W4 #317). Scheduled expiry would be a P1-21-lane addition (worker or route) if the Owner wants time-based release to be visible before the next reserve.
- **Dependencies:** F-02 for a fresh-organisation acceptance; wo.work_orders open state for a work-order-bound hold.
- **Acceptance criteria:** Two concurrent reservations of the last unit yield one 201 and one refusal; the same body idempotencyKey resent returns the original id with status 200 and replayed=true; releasing twice changes nothing and reports replayed=true; a reserve from a quarantine location is refused (409 ERR-TRN-001); available on the cell falls by the held quantity and returns on release.

### Part issue — Owner requirement · **Delivered**

> issues

- **Normalised behaviour:** Stock leaves a location for one open work order in the same branch, posting one 'out' movement, consuming the cited reservation, and the issues of a work order can be read back with what has since been returned.
- **Existing evidence:** inv.issue_part locks the work order, inserts inv.part_issues, posts the out movement, consumes the reservation (inv_operations.sql:676-695; table :260-309). inv.stock-issue-create POST /stock-issues, inv.stock.operate, idempotent (apps/api/src/app/api/v1/stock-issues/route.ts:59-69); work order must be open and in the stock's branch (docs/product/workshop/parts-and-procurement-flow.md:354-368); archived or untracked items refused (inventory-stock-service.ts:831-845). Read: inv.work-order-part-issue-list GET /work-orders/{id}/part-issues, per-parent (A2 seam S-15; .../part-issues/route.ts:28-56). Screen: /inventory/parts?workOrderId= with 'Issue this part' from required parts and the issue form (W5 #318, apps/web/src/features/inventory/components/PartsScreen.tsx). Tests: tests/backend/p1-30-w5-parts-movements.test.ts:267-319 (consumes the reservation, over-issue 409 ERR-TRN-001, same header key writes no second movement); p1-21-inventory-stock.test.ts:548-563. Companion register row 'Part consumption' (reservation → consumed) is proved by the same cases.
- **Remaining gap:** inv.part_issues.required_part_ref has no FK (PROC-14) — the link to the demand line is advisory. No correction path for an issue recorded in error (PROC-19: no adjustment route, returns need the part physically back). No vehicle attribution and no issue read except per work order (PROC-15, PROC-12). The register row still says Contracted; W5 moved it.
- **Owning module:** apps/api/src/modules/inventory; schema inv.part_issues, inv.stock_movements; wo.work_orders (P1-19) for the open-state lock
- **Delivery placement:** On protected develop (W5 #318). PROC-14 FK and PROC-19 correction are P1-21-lane correctives; the register rows 'Part issue' and 'Part consumption' should move to Delivered on the next register edit.
- **Dependencies:** F-02 (items and locations); an open work order (P1-29 journey); INV-18 adjustment surface for corrections.
- **Acceptance criteria:** An issue of '2.500' against an active reservation posts one 'out' movement, the reservation reads consumed, the cell's on-hand falls by 2.500; an issue larger than its reservation is 409 ERR-TRN-001; resending under the same Idempotency-Key returns the stored 201 and the movement count is unchanged; GET /work-orders/{id}/part-issues lists the issue with quantity '2.500' and returnedQty; a reader without inv.stock.operate gets 403.

### OWR-2026-09-06-B-6 — Owner requirement · **Undecided**

> transfers

- **Normalised behaviour:** A quantity moves from one location to another (within or across branches) as one transfer that posts a paired out/in movement citing the transfer, keeping both balances coherent.
- **Existing evidence:** None. The inventory module states it does not transfer stock and that inventing a two-movement transfer would mint a fact the ledger cannot express (apps/api/src/modules/inventory/index.ts:30-33); no transfer permission code (supabase/seeds/04_iam_permission_catalog.sql:44-59); the only two-leg movement is damage, and it refuses to cross a branch (inventory-stock-service.ts:616-622). The ledger's single-use index already admits one row per direction per source (uq_stock_movements_source, inv_ledger.sql:80), which is the shape a transfer would use.
- **Remaining gap:** No source table, movement kind, provenance branch, function, route, permission or screen.
- **Owning module:** apps/api/src/modules/inventory; schema inv (new inv.stock_transfers + reference_kind 'transfer' + provenance branch)
- **Delivery placement:** Named follow-on Backend slice on the P1-21 lane after an Owner decision on the model (policy INV-16); outside P1-30 field-5 and P1-31 scope; Integration gate proves it once landed.
- **Dependencies:** Owner decision (same-branch only vs cross-branch vs cross-company; one-step vs two-step); INV-3 in-transit if two-step; INV-13 for cross-company legs; INV-19 if cost travels with the stock; F-02 location writer.
- **Acceptance criteria:** A transfer of '5.000' from A to B leaves A on-hand −5 and B +5, two ledger rows (out at A, in at B) citing one transfer id, a clean reconciliation; a transfer from a quarantine location, across tenants, or exceeding available is refused; the same Idempotency-Key does not transfer twice.

### Part return — Owner requirement · **Delivered**

> returns

- **Normalised behaviour:** Part of a previous issue comes back to the location it was issued from as one 'in' movement addressed by that issue, and the issue's returned-so-far is readable.
- **Existing evidence:** inv.part_returns (inv_operations.sql:311-357) and inv.return_part (:697-717; item and location read from the issue). inv.stock-return-create POST /stock-returns {partIssueId, quantity, reason?}, inv.stock.operate, idempotent (apps/api/src/app/api/v1/stock-returns/route.ts:40-58). ReturnView {id, partIssueId, quantity, totalReturned, issuedQuantity} (inventory-stock-service.ts:552-558). INT-067 ('remaining returnable not computable') is answered by S-15 publishing quantity and returnedQty as two exact operands with no remaining (part-issues/route.ts:28-32; inventory-read-service.ts:200-220). Screen: per-row return form on /inventory/parts (PartsScreen.tsx:925-945). Tests: p1-30-w5-parts-movements.test.ts:358-417; p1-21-inventory-stock.test.ts:600-618.
- **Remaining gap:** returnedQty scale inconsistency ('0' before any return, '1.000' after) — see INV-9 / policy INV-14. A return always lands sellable at the issue's original location with no condition (policy INV-17). No return list or detail read (PROC-12). The return echo carries no replayed flag. The register row still says 'Partly blocked'; S-15 and W5 moved it.
- **Owning module:** apps/api/src/modules/inventory; schema inv.part_returns, inv.part_issues
- **Delivery placement:** On protected develop (A2 S-15, W5 #318). The scale fix is a P1-30 corrective on the backend lane (INV-14); the register row should move to Delivered with INV-14 noted.
- **Dependencies:** Part issue; F-02 for a fresh-organisation acceptance.
- **Acceptance criteria:** Returning '1.000' of an issue of '2.500' posts one 'in' movement, the cell's on-hand rises by 1.000, the echo states totalReturned '1.000' and issuedQuantity '2.500', and the per-work-order list shows returnedQty '1.000'; a caller with only inv.stock.read gets 403.

### OWR-2026-09-06-B-7 — Owner requirement · **Delivered**

> an immutable movement history

- **Normalised behaviour:** Every stock change is one append-only ledger row with a signed quantity, a sequence, and a business source it can prove; rows are never edited or deleted, and the ledger can be read per branch with filters.
- **Existing evidence:** inv.stock_movements granted SELECT+INSERT only to app_runtime, SELECT to app_readonly (inv_ledger.sql:97; live catalog confirms; RLS policies are sel_/ins_ only; tests/db/p1-10-security.test.ts:76-85). signed_qty GENERATED from direction (:52), seq IDENTITY, one movement per (source, direction) (uq_stock_movements_source :80). inv.guard_stock_movement_provenance makes every row prove an approved, quantity-matched source (inv_operations.sql:592-646); inv.guard_stock_balance_coherence keeps balances equal to the ledger (inv_ledger.sql:133-150). Read: inv.stock-movement-list GET /stock-movements, inv.stock.read, seq desc, audited on read as inv.movement_history.read (apps/api/src/app/api/v1/stock-movements/route.ts:61-69). Reconciliation read; events stock.movement.posted (inventory-stock-service.ts:547-550). Screen: /inventory/movements, read only on an explicit action (W5 MovementsScreen.tsx). Tests: p1-30-w5-parts-movements.test.ts (ledger holds issue and return rows in seq order, audit row per read).
- **Remaining gap:** occurred_at is the recording instant (post_stock_movement writes now(), inv_ledger.sql:283-302), not the physical time — an open Owner decision (parts-and-procurement-flow.md §4.3). Movement rows carry no locationCode and there is no referenceId filter (A0 FE-013 gaps); the workOrderId filter matches only part_issue/part_return kinds (PROC-13). The postgres superuser still holds UPDATE/DELETE — expected, outside the application roles.
- **Owning module:** apps/api/src/modules/inventory; schema inv.stock_movements
- **Delivery placement:** On protected develop (P1-10 schema, P1-21 read, W5 screen). The FE-013 gaps (locationCode on the row, referenceId filter, wider work-order attribution) are P1-21-lane read enrichments deliverable as P1-30 correctives.
- **Dependencies:** None for the ledger itself; INV-6/INV-4 add new reference kinds and provenance branches when they land.
- **Acceptance criteria:** An UPDATE or DELETE on inv.stock_movements as app_runtime fails with a privilege error; a raw INSERT of an 'in' movement without a matching approved source is rejected (check_violation); after an issue and a return the list shows both rows newest seq first with signedQuantity '-2.500' and '1.000'; reading the list writes one audit row.

### OWR-2026-09-06-B-8 — Owner requirement · **Delivered**

> Link returns to original issues

- **Normalised behaviour:** A return can only be recorded against one specific prior issue, and its item, location and work order are those of that issue.
- **Existing evidence:** inv.part_returns.part_issue_id NOT NULL with composite FK fk_part_returns_issue to inv.part_issues (inv_operations.sql:311-328); the request body names only partIssueId, quantity and reason (stock-returns/route.ts:40-44) so a different work order, item or location cannot be expressed; inv.return_part reads item and location from the locked issue (:697-717); the provenance guard binds the return movement to the issue's item/location (:614-620). Rendered per issue row on /inventory/parts.
- **Remaining gap:** None for the link itself. Returns are readable only as the aggregate returnedQty on the issue; no return list/detail (PROC-12).
- **Owning module:** apps/api/src/modules/inventory; schema inv.part_returns
- **Delivery placement:** On protected develop (P1-10/P1-21; W5 screen). A return list per issue would be a P1-21-lane read.
- **Dependencies:** Part issue.
- **Acceptance criteria:** A return citing a part issue from another branch or tenant is refused (ERR-RES-001 / not found); the return's movement lands on the issue's location and item; the per-work-order list attributes returnedQty to that issue only.

### OWR-2026-09-06-B-9 — Owner requirement · **Delivered**

> track quantities already returned

- **Normalised behaviour:** For every issue the total quantity already returned is computed by the server from the return records and published as an exact decimal at the same scale as the issued quantity.
- **Existing evidence:** Correlated SUM over inv.part_returns computed in SQL in readPartIssue (apps/api/src/modules/inventory/data/inventory-repository.ts:1257-1265) and listPartIssuesForWorkOrder (:757-760); PartIssueListView.returnedQty (inventory-read-service.ts:200-220); ReturnView.totalReturned and the audit detail totalReturned previous/new (inventory-stock-service.ts:537-544); PartsScreen renders returnedQty verbatim (:782, :935). Tests: p1-30-w5-parts-movements.test.ts:339-345, :407; apps/web/tests/inventory-parts.dom.test.tsx:240-254.
- **Remaining gap:** Scale defect, located: both queries use COALESCE((SELECT sum(pr.quantity) ...), 0)::text — the fallback literal 0 is an integer, so before any return the field is '0' while after one it is '1.000' (the numeric(12,3) sum). Verified live on the catalog: no returns → '0'; one return → '1.000'; casting the fallback (COALESCE(...)::numeric(12,3)::text) → '0.000'. The W5 backend test pins the current '0' (:339-343) and the screen renders whatever is published. No remaining figure is published — deliberate (server-arithmetic rule).
- **Owning module:** apps/api/src/modules/inventory (data/inventory-repository.ts); schema unchanged
- **Delivery placement:** On protected develop; the scale fix is policy INV-14, a P1-30 corrective on remediation/p1-30-backend-* (the Frontend lane may not touch apps/api).
- **Dependencies:** Part return; INV-14.
- **Acceptance criteria:** Before any return the list reads returnedQty '0.000' (after INV-14) and after returns of 1.000 and 0.500 it reads '1.500'; the field is always a string matching ^\d+\.\d{3}$; no key named remaining/outstanding exists on the row.

### OWR-2026-09-06-B-10 — Owner requirement · **Delivered**

> prevent excess/replayed returns

- **Normalised behaviour:** The sum of returns against an issue can never exceed the issued quantity, even under concurrency or a raw insert, and a retried return request records nothing a second time.
- **Existing evidence:** Ceiling enforced three times: application pre-check ERR-TRN-001 (inventory-stock-service.ts:524-530), inv.return_part under a row lock on the issue (inv_operations.sql:697-708), and inv.guard_part_return_ceiling BEFORE INSERT trigger on inv.part_returns (:357-380) — the trigger is the trust root even for a raw insert. Replay: inv.stock-return-create is idempotent: true (stock-returns/route.ts:58), the transport attaches the Idempotency-Key, and a same-key resend returns the stored 201 with no second movement (p1-30-w5-parts-movements.test.ts:388-403). Over-return refused 409 ERR-TRN-001, exact remainder accepted (p1-21-inventory-stock.test.ts:606-618; w5 :410-417).
- **Remaining gap:** The return echo has no replayed flag (no body key, unlike reservations). A return recorded in error cannot be reversed (PROC-19 analog; the only path would be an approved adjustment, which has no route — INV-18).
- **Owning module:** apps/api/src/modules/inventory; schema inv.part_returns (trigger)
- **Delivery placement:** On protected develop (P1-10 trigger, P1-21 route, W5 screen).
- **Dependencies:** Part return; INV-18 for corrections.
- **Acceptance criteria:** With 1.500 of 2.500 returned, a return of '1.001' is 409 ERR-TRN-001 and '1.000' is 201; a direct INSERT into inv.part_returns exceeding the issue fails with check_violation; the same Idempotency-Key resent yields the same return id and an unchanged movement count; two concurrent returns for the last unit produce exactly one movement.

### OWR-2026-09-06-B-11 — Owner requirement · **Blocked**

> route usable, damaged, and quarantined stock appropriately

- **Normalised behaviour:** Usable stock is sellable at its location; damaged stock is moved into a quarantine location where it cannot be reserved, issued or counted as available; quarantined stock leaves only through an approved disposition (scrap, supplier return, or return to sellable).
- **Existing evidence:** inv.damaged_stock (inv_operations.sql:382-437) and inv.record_damage posting the paired out/in movement and freeing conflicting reservations (:719-738, :648-674); inv.damaged-stock-create POST /damaged-stock, inv.stock.operate, idempotent (apps/api/src/app/api/v1/damaged-stock/route.ts:68-78); destination must be a genuine quarantine location and in the same branch (inventory-stock-service.ts:616-626); reserve/issue from quarantine refused (:808-821); availability excludes quarantine by default (inventory-repository.ts:467-468); disposition quarantined|scrapped|returned_to_supplier (:412). Tests: p1-21-inventory-stock.test.ts:674-701 (units in quarantine, availability not inflated), :705-713 (non-quarantine destination refused), :1027-1029.
- **Remaining gap:** No route OUT of quarantine: inv.stock_adjustments and inv.approve_adjustment exist (:156-212, :756-766) but have no route (PROC-10) — the documented disposal path does not exist. 'scrapped' and 'returned_to_supplier' are labels set once with no movement, no supplier and no operation (PROC-17). No damaged-stock read or screen — the damage write has no P1-30 screen (its adapter mirror is still PENDING per the W4 record) and is not in field 5. A returned part has no condition: it always lands sellable at the issue's location, so a damaged return needs a second, separate damage record (policy INV-17). 'Usable' is expressed only as 'not in quarantine'.
- **Owning module:** apps/api/src/modules/inventory; schema inv.damaged_stock, inv.stock_adjustments, inv.stock_adjustment_details
- **Delivery placement:** Backend: publish the adjustment/disposition routes over the existing tables on the P1-21 lane as a P1-30 corrective (policy INV-18) — the contract the screen needs does not exist, which is why this is Blocked. Screen: a damage/disposition screen needs an Owner scope addition to P1-30 (not in field 5) or lands in the Integration gate's setup set.
- **Dependencies:** Owner decision on who approves disposal (inv.adjustment.approve, maker≠approver by constraint); INV-17 return condition; INV-20 supplier return; INV-19 if scrap must carry a value impact (stock_adjustment_details is inv.cost.view-gated).
- **Acceptance criteria:** Marking '2.000' damaged moves available −2 and quarantine +2 with two ledger rows citing one damage id; a reserve or issue from the quarantine location is 409 ERR-TRN-001; an 'out' adjustment from quarantine requested by A and approved by B posts one ledger row and an approval-class audit row, and A approving their own request is refused; the damage record and its disposition are readable afterwards.

### Expected / approved / final cost — Owner requirement · **Blocked**

> Preserve cost lineage

- **Normalised behaviour:** Every unit that enters stock carries the cost and currency it entered with, every issue records which entry cost it consumed, and a reader holding inv.cost.view can trace an issued part's cost back to its receipt.
- **Existing evidence:** Cost holders: inv.item_cost_details.standard_cost — one current value per item, RLS gated on iam.has_permission('inv.cost.view') (inv_reference.sql:267-310); inv.external_purchase_part_details.unit_cost + currency, written by inv.external-purchase-part-create and never echoed (inv_operations.sql:545-560; parts-and-procurement-flow.md:498-502); inv.stock_adjustment_details.value_impact (:214-256). tests/db/p1-10-security.test.ts asserts the cost gate on all three. The module states it returns no cost (index.ts:26-29).
- **Remaining gap:** inv.stock_movements has no cost column (inv_ledger.sql:42-77) and opening lines are 'quantity only; valuation is out of scope' (:132 comment) — there is no per-entry cost layer, no valuation method (no FIFO/average anywhere), and no way to say which cost an issue consumed. No route reads any cost table (PROC-11; INT-070 in the register). 'Lineage' is therefore unrepresentable today, not merely unread.
- **Owning module:** apps/api/src/modules/inventory; schema inv (new restricted movement-cost detail), inv.cost.view (iam)
- **Delivery placement:** Owner decision on valuation method and on who holds inv.cost.view first; the schema is a P1-21-lane slice (policy INV-19); the cost read under inv.cost.view (PROC-11, publish-only over existing tables) can be a P1-30 corrective and its rendering is P1-30 W-scope ('inv.cost.view gates cost fields', canonical-plan §4 W4) or P1-31 reporting.
- **Dependencies:** INV-4 receipts (cost enters with a receipt); INV-6 transfers (cost travels); register row 'Accounting handoff' (Planned); Owner decision on valuation and visibility; never sum across currencies (parts-and-procurement-flow.md §4.4).
- **Acceptance criteria:** With inv.cost.view a part-issue row shows unit cost, currency and the receipt it came from; without the code the fields are absent (not zero) and the RLS policy returns no cost row; two receipts of the same item at different costs followed by an issue attribute the issue per the chosen method and the reconciliation still balances quantities.

### OWR-2026-09-06-B-12 — Owner requirement · **Blocked**

> the distinction between a stock return, a supplier return, and a financial credit

- **Normalised behaviour:** A stock return (part back into a location, no money), a supplier return (stock out to a supplier, no customer money) and a financial credit (an invoice's open amount reduced, no stock) are three separate records that cannot be recorded as one another and are only ever linked by explicit reference.
- **Existing evidence:** Stock return: inv.part_returns + 'in' movement (inv_operations.sql:311-357). Supplier return: only the label damaged_stock.disposition='returned_to_supplier' (:412) — no supplier column on inv.damaged_stock (live columns: item, from/quarantine location, quantity, disposition, reason, responsible_party_ref, evidence_ref), no movement, no operation (PROC-17). Financial credit: sal.credit_notes {invoice_id, currency_code, amount, reason, approval_state, requested_by, approved_by} (supabase/migrations/20260724092000_sal_payments.sql:272), sal.credit-note-create (apps/api/src/app/api/v1/invoices/[invoiceId]/credit-notes/route.ts:75), sal.financial_events explicitly NOT a general ledger (20260724090000_salwtyrpt_schemas.sql:33-37); no inv reference on either. crm.partner_roles admits 'supplier' as structure only (20260719093000_crm_partner_roles.sql:13,66).
- **Remaining gap:** The supplier return is not an operation, names no supplier and moves no stock; nothing records that a credit note relates to a returned part (no reference column either way); no guard prevents a future screen from treating a stock return as a credit. The distinction holds today by the absence of any link, not by design.
- **Owning module:** inventory (supplier return), billing/payments (credit note reference), crm (supplier partner role)
- **Delivery placement:** Supplier return: P1-21-lane Backend slice after the 'External supplier' decision (INT-075 / PROC-05) — policy INV-20. Credit-note reference to a part return: P1-22-lane column + P1-30 W6 rendering. Not deliverable inside P1-30 Frontend scope as it stands.
- **Dependencies:** Register row 'External supplier' (Blocked, no supplier master); INV-11 quarantine disposition; sal credit-note contract (W6).
- **Acceptance criteria:** A stock return changes on-hand and no invoice amount; a supplier return posts an 'out' movement from quarantine citing a supplier partner and no receipt or credit; a credit note reduces the invoice's outstanding read and changes no balance; each screen labels the three distinctly and none can be submitted through another's form.

### OWR-2026-09-06-B-13 — Owner requirement · **Undecided**

> A cross-company movement must follow its approved accounting boundary.

- **Normalised behaviour:** A stock movement whose source and destination belong to different legal companies of the tenant is allowed only when the approval the Owner's accounting rule requires is recorded, and it emits the accounting event that rule names.
- **Existing evidence:** Multi-company structure exists: org.legal_companies (20260717104000_org_operational_structure.sql; org.company-list/update routes under apps/api/src/app/api/v1/org/companies); every inv row carries company_id+branch_id with composite FKs to org.branches and RLS on iam.allowed_company_ids()/allowed_branch_ids() (inv_ledger.sql:84-96 and every inv table). Today no movement can cross a branch at all (damage refuses it, inventory-stock-service.ts:616-622; no transfer primitive, index.ts:30-33). No general ledger, journal or inter-company posting exists by design (salwtyrpt_schemas.sql:33-37; org.cost_centers comment 'no general-ledger implementation exists'); register row 'Accounting handoff' is Planned.
- **Remaining gap:** The boundary is enforced by impossibility, not by an approved rule: no approval object, no financial event kind for a cross-company move, and no repository document defines 'approved accounting boundary'. The whole capability depends on transfers (INV-6) existing first.
- **Owning module:** inventory (transfer legs), billing/payments (financial event), iam (approval permission); schema inv + sal.financial_events
- **Delivery placement:** Owner business-rule decision first (inter-company invoice vs transfer at cost vs approval role). Then the P1-21 transfer slice (INV-6) carries the company-boundary check and the accounting handoff lane adds the event; the Integration gate proves the end-to-end rule. Not P1-30 or P1-31 scope as written.
- **Dependencies:** INV-6 transfers; INV-3 in-transit if two-step; INV-19 cost (a cross-company move at cost needs a cost); 'Accounting handoff' row; Owner definition of the boundary.
- **Acceptance criteria:** A transfer between two companies of one tenant without the required approval is refused with a named code; with it, exactly one financial event naming both companies is written and both branches' balances move; a same-company transfer writes no such event; a transfer across tenants is invisible/refused.
- **Unverified:** Whether the Owner's DOCX register or any accounting policy outside git already defines the boundary — not checkable from the repository.

### OWR-2026-09-06-B-14 — Proposed implementation policy · **Planned**

> (policy for) track quantities already returned

- **Normalised behaviour:** returnedQty is always published at numeric(12,3) scale: the coalesced fallback is cast so an issue with no returns reads '0.000', matching the issued quantity's scale.
- **Existing evidence:** Defect located at apps/api/src/modules/inventory/data/inventory-repository.ts:757-760 (list) and :1261-1264 (detail): COALESCE((SELECT sum(pr.quantity) ...), 0)::text. Live proof: no returns → '0'; one return → '1.000'; COALESCE(...)::numeric(12,3)::text → '0.000'. Pinned as a finding by tests/backend/p1-30-w5-parts-movements.test.ts:339-343 and rendered verbatim (inventory-parts.dom.test.tsx:240-254; PartsScreen.tsx:782).
- **Remaining gap:** Two SQL fragments and one test assertion; web DOM fixtures that hard-code '0' (if any) follow.
- **Owning module:** apps/api/src/modules/inventory (data layer); tests/backend
- **Delivery placement:** P1-30 corrective on remediation/p1-30-backend-* (apps/api is Backend-only; a P1-30 Frontend branch may not change it). Blast radius: one field on two reads, in the harmless direction (scale only, value unchanged).
- **Dependencies:** None.
- **Acceptance criteria:** GET /work-orders/{id}/part-issues for an issue with no returns publishes returnedQty '0.000'; the W5 backend case is updated to assert '0.000' and the DOM test still finds the exact server string; Quantity.fromDatabase accepts both forms so the service path is unchanged.

### OWR-2026-09-06-B-15 — Proposed implementation policy · **Undecided**

> (policy for) multiple warehouses and locations; units and fractional quantities where appropriate

- **Normalised behaviour:** Ship the missing master-data writers over the existing tables — item category, item (with unit and cost detail under inv.cost.view), tenant unit of measure with an allows_fractional flag, and stock location — under inv.item.manage and a new location code, so a fresh organisation can catalogue parts and places through the product.
- **Existing evidence:** Tables and guards exist (inv_reference.sql:116-370); inv.item.manage is seeded and used by no route (04_iam_permission_catalog.sql:44; PROC-08); A0 names the seam S-05 class C (a0-read-surface-matrix.md:239); the tenant-bootstrap record says a bootstrap cannot invent a writer (tenant-bootstrap-corrective-slice.md §4). Fixtures prove the tables accept the rows (tests/backend/p1-21-helpers.ts).
- **Remaining gap:** Routes, repository INSERT/UPDATE, the allows_fractional column (one migration) enforced by the QuantityString check per item unit, a location permission code, and an administration screen that P1-30 field 5 does not list.
- **Owning module:** apps/api/src/modules/inventory; schema inv.units_of_measure (+1 column), inv.item_master, inv.item_categories, inv.stock_locations; iam catalogue (+1 code)
- **Delivery placement:** remediation/p1-30-backend-commercial-setup (the current branch, differing from develop only by a test-isolation change) is the natural carrier once the Owner decides F-02; the screen is an Owner scope addition to P1-30 or an Integration-gate setup screen.
- **Dependencies:** Owner decision F-02; RES-05 (minting a permission code is a catalogue change with parity gates); TB-R1 style backfill question for the nine existing tenants does not arise (writers, not bootstrap).
- **Acceptance criteria:** On a fresh organisation an administrator creates a category, a unit 'each' with fractions disallowed, an item in that unit, and a warehouse; GET /items and GET /stock-locations list them; an opening line of '1.5' of that item is refused naming the unit while '1.500' of a litre item is accepted; item cost is writable only with inv.cost.view.

### OWR-2026-09-06-B-16 — Proposed implementation policy · **Undecided**

> (policy for) transfers; in-transit stock

- **Normalised behaviour:** Model a transfer as its own source record with a 'transfer' movement kind and one out leg plus one in leg under a single reference id; deliver same-branch first, then cross-branch; add a 'transit' location type and a dispatch/receive pair only if the Owner wants in-transit visibility; cross-company legs require INV-13's approval.
- **Existing evidence:** The ledger already supports exactly two rows per source (uq_stock_movements_source on reference_kind, reference_id, direction — inv_ledger.sql:80) and the damage function is the working precedent for a paired movement (inv_operations.sql:719-738); provenance guard branches are per reference_kind (:592-646).
- **Remaining gap:** Everything: table, kind, guard branch, function, route, permission, screen, tests; the Owner's choice between one-step and two-step.
- **Owning module:** apps/api/src/modules/inventory; schema inv
- **Delivery placement:** Named follow-on Backend slice on the P1-21 lane after the Owner decision; not P1-30/P1-31.
- **Dependencies:** Owner decision on the model; INV-13 for cross-company; F-02 locations.
- **Acceptance criteria:** See INV-6 and INV-3; additionally a partial transfer cannot exist (both legs post in one transaction or neither) and the reconciliation read stays clean.

### OWR-2026-09-06-B-17 — Proposed implementation policy · **Undecided**

> (policy for) route usable, damaged, and quarantined stock appropriately — returns

- **Normalised behaviour:** A return carries a condition: usable returns land at the issue's original location (today's behaviour); a damaged return names a quarantine location and, in one command, posts the return-in and the damage pair atomically, so a damaged part is never sellable for an instant.
- **Existing evidence:** inv.return_part always posts to the issue's location (inv_operations.sql:713-715); inv.record_damage posts the quarantine pair (:719-738); both are SECURITY INVOKER functions the service can chain in one transaction; the return route body is .strict() with no condition field (stock-returns/route.ts:40-44).
- **Remaining gap:** A condition field, a quarantineLocationId on damaged returns, service orchestration, and a test that the intermediate sellable state is never observable.
- **Owning module:** apps/api/src/modules/inventory; route stock-returns; screen /inventory/parts
- **Delivery placement:** P1-21-lane corrective (publish-time change, no migration if reason/condition reuse existing columns — UNVERIFIED without a design pass); screen change in P1-30 W5 area under the same phase if the Owner confirms.
- **Dependencies:** Owner confirmation of the rule; INV-11.
- **Acceptance criteria:** A return with condition damaged and a quarantine location ends with on-hand at the issue location unchanged, quarantine +qty, three ledger rows (return in, damage out, damage in) under one correlation; a return with condition usable behaves as today.

### OWR-2026-09-06-B-18 — Proposed implementation policy · **Planned**

> (policy for) route usable, damaged, and quarantined stock appropriately — disposition; receipts

- **Normalised behaviour:** Publish the stock-adjustment surface over the existing tables — create under inv.stock.operate, approve under inv.adjustment.approve with maker≠approver — as the route out of quarantine (scrap, return to sellable), the correction path for an issue or return made in error, and the interim way stock arrives before a receipt exists.
- **Existing evidence:** inv.stock_adjustments, inv.stock_adjustment_details (value impact, inv.cost.view-gated) and inv.approve_adjustment exist with maker≠approver constraint and terminal states (inv_operations.sql:40-55, :156-256, :756-766); the provenance guard already accepts 'adjustment' (:633-640); the service comment names it as the disposal path (inventory-stock-service.ts:804-806); no route exists (PROC-10, PROC-19).
- **Remaining gap:** Two routes, repository calls, audit actions (approval class), tests, and a screen not in P1-30 field 5.
- **Owning module:** apps/api/src/modules/inventory; schema unchanged
- **Delivery placement:** P1-30 corrective on the backend lane (publish-only); the screen by Owner scope decision (P1-30 addition or Integration-gate setup).
- **Dependencies:** Owner decision on who holds inv.adjustment.approve; INV-19 if value impact must be recorded.
- **Acceptance criteria:** An 'out' adjustment from quarantine requested by A is refused approval by A and approved by B, posting one ledger row and freeing no sellable reservation; an 'in' adjustment raises on-hand only after approval; a pending adjustment posts nothing.

### OWR-2026-09-06-B-19 — Proposed implementation policy · **Undecided**

> (policy for) Preserve cost lineage

- **Normalised behaviour:** Every inbound movement (receipt, opening, adjustment-in, transfer-in) carries a restricted unit cost and currency on a movement-cost detail gated by inv.cost.view; issues consume entries per an Owner-chosen valuation method and record the entry consumed; amounts are decimal strings and are never summed across currencies.
- **Existing evidence:** The restricted 1:1 detail pattern already exists three times (item_cost_details, external_purchase_part_details, stock_adjustment_details) with the same RLS shape; money is numeric(18,4) + ISO currency everywhere (tests/db/p1-10-precision.test.ts:43-64); the platform forbids client arithmetic (canonical-plan §3).
- **Remaining gap:** Schema (movement-cost detail, consumption link), the valuation method, the cost read (PROC-11), and the screen split under inv.cost.view.
- **Owning module:** apps/api/src/modules/inventory; schema inv; iam inv.cost.view
- **Delivery placement:** P1-21-lane Backend slice after the Owner's valuation decision; read and rendering in P1-30 (cost fields under inv.cost.view) or P1-31 reporting.
- **Dependencies:** Owner decision on valuation method and cost visibility; INV-4 receipts; INV-6 transfers.
- **Acceptance criteria:** See 'Expected / approved / final cost'; additionally a receipt in one currency and another in a second are never added, and a reader without inv.cost.view sees no cost key at all.

### OWR-2026-09-06-B-20 — Proposed implementation policy · **Undecided**

> (policy for) the distinction between a stock return, a supplier return, and a financial credit

- **Normalised behaviour:** A supplier return is its own operation: it moves quarantined stock out with a supplier partner reference and no customer money; a stock return never creates a credit note automatically — a credit note may cite a part return by reference only and is approved separately.
- **Existing evidence:** damaged_stock.disposition admits 'returned_to_supplier' with no supplier and no movement (inv_operations.sql:412; PROC-17); crm.partner_roles has 'supplier' as structure only (20260719093000_crm_partner_roles.sql:13,66) and no CRM route writes it (PROC-05); sal.credit_notes has its own approval flow and no inv reference (20260724092000_sal_payments.sql:272).
- **Remaining gap:** Supplier partner writer (crm), supplier reference column and operation (inv), optional part_return reference on credit notes (sal), and the explicit no-auto-credit rule in the billing contract.
- **Owning module:** inventory, crm (supplier role), billing/payments (credit-note reference)
- **Delivery placement:** P1-21 lane (operation) after the 'External supplier' decision; P1-16/crm for the supplier role; P1-22 lane for the credit-note reference; rendering in P1-30 W6 if the reference lands.
- **Dependencies:** Register row 'External supplier' (Blocked, INT-075); INV-11; INV-18.
- **Acceptance criteria:** A supplier return posts one 'out' movement from a quarantine location citing a supplier partner; a stock return leaves every invoice's outstanding read unchanged; a credit note citing a part return still requires its own approval and changes no balance.

---

## Area C — Stocktaking

**Where this area stands today.** Nothing in the repository is a stocktake: no table, function, operation, screen, test or document names a full count, a cycle count, a recount or a count cutoff (global grep over docs/, apps/*/src, supabase/, tests/ on 2026-09-06 returns only unrelated uses of the word "count"; the live catalogue holds 18 inv tables and 23 inv functions, none count-shaped; docs/product/owner-workflow-requirements.md has no stocktaking row in its P1-30 table). What does exist is the substrate a count would post through: an immutable, provenance-guarded movement ledger with a strict `seq` order (supabase/migrations/20260723094000_inv_ledger.sql:42-98), a coherence guard that makes any balance not equal to the ledger sum unrepresentable (:133-153, proven by tests/db/inv-ledger.test.ts:71 and tests/db/p1-21-inventory-integrity.test.ts:191,226), an `inv.stock_adjustments` table with maker≠approver, pending/approved/rejected states and a database-side `inv.approve_adjustment` that posts the movement only on approval (20260723095000_inv_operations.sql:156-212, 756-769; proven by tests/db/inv-operations.test.ts:65-91) — but no API route creates, approves, rejects or reads an adjustment (PROC-10, docs/product/workshop/parts-and-procurement-flow.md:692; the 17 `inv.` operations under apps/api/src/app/api/v1 include none), and the opening-inventory batch is the only counting-shaped record, restricted by design to day-one stock (route docblock apps/api/src/app/api/v1/opening-inventory-batches/route.ts:4-17). Of the ten Owner lines, one ("prevent a blind overwrite of live balances") is already a delivered, tested, platform-wide invariant; the other nine are Blocked for P1-30 (the phase that owns the inventory Frontend) because the count contract does not exist, and every one of them also sits behind F-02 (no in-product writer for `inv.item_master` or `inv.stock_locations`, docs/phase-1/phase-1-30/tenant-bootstrap-corrective-slice.md:124-146) — a fresh tenant has nothing to count. Delivery needs a schema addition and new operations, which P1-30's own plan forbids on the Frontend lane (docs/phase-1/phase-1-30/canonical-plan.md §1.4, §2); the honest placement is a named Backend prerequisite on the `remediation/p1-30-backend-*` lane followed by a P1-30 Frontend wave, but A0 did not name it and W4/W5 are closed, so adopting it into P1-30 versus deferring it to a follow-on after the Integration gate is an Owner scope decision recorded as line C-15.

### OWR-2026-09-06-C-1 — Owner requirement · **Blocked**

> Provide full and cycle counts

- **Normalised behaviour:** An authorised user can open a stock count record whose type is either full (every balance cell in the count scope) or cycle (a declared subset), and the count progresses through recorded states to a terminal closed/approved state without ever writing a balance directly.
- **Existing evidence:** None for a count. Nearest artefact is the opening-inventory batch: `inv.opening_inventory_batches` / `inv.opening_inventory_lines` (supabase/migrations/20260723095000_inv_operations.sql:57-151; states draft/approved :82; maker≠approver :84), `inv.opening-batch-create` (apps/api/src/app/api/v1/opening-inventory-batches/route.ts:50-66, `inv.stock.operate`), `inv.opening-batch-line-create` (.../[batchId]/lines/route.ts:48), `inv.opening-batch-approve` (.../[batchId]/approval/route.ts:36-50, `inv.adjustment.approve`). It is restricted by design to stock appearing from nothing: every line posts an `opening`/`in` movement (migration :740-754) and the provenance guard admits no other direction for that kind (:596-604), so it cannot express a count against existing stock. Live catalogue 2026-09-06: no table in any schema matches count|stocktak|cycle (only `iam.user_accounts`, `svc.discount_rules` by coincidence of name). Global grep for stocktak|cycle count|physical count|recount over docs/, apps/*/src, supabase/, tests/: no hit. Register: docs/product/owner-workflow-requirements.md P1-30 table has no counting row. P1-10 frontend contract promises a P1-30 view of "stock adjustments (pending/approved/rejected) with the maker/approver attribution" (docs/phase-1/phase-1-10/p1-30-frontend-contract.md:22-24) but never a count.
- **Remaining gap:** Everything: a count header table (type, scope, status, counter, cutoff position, approver), a count-line table (cell, expected quantity at cutoff, counted quantity, recount history, variance), operations to open/enter/recount/close/approve/reject/read, a screen, and tests. Also blocked upstream by F-02: `inv.item_master` and `inv.stock_locations` have no in-product writer (docs/phase-1/phase-1-30/tenant-bootstrap-corrective-slice.md:124-146), so a fresh tenant has no cells to count.
- **Owning module:** api module `inventory` (apps/api/src/modules/inventory/**, new intake-style service); schema `inv` (new tables — names to be decided by the Backend lane, e.g. a count header and a count line table — alongside existing `inv.stock_balances`, `inv.stock_movements`, `inv.stock_locations`, `inv.item_master`); permission catalogue supabase/seeds/04_iam_permission_catalog.sql:44-59.
- **Delivery placement:** P1-30 owns the inventory Frontend (register phase table), so the screen is P1-30's; the Backend (migration + operations) cannot travel on a P1-30 Frontend branch (docs/phase-1/phase-1-30/canonical-plan.md §1.4 lines 52-58, §2 lines 60-70) and must be a named Backend prerequisite on `remediation/p1-30-backend-*` under the `p1-30-backend` profile, merged before the screen. NOT the P1-30 corrective slice (bootstrap-only: payment method, sequences, administrator bundle). NOT P1-31 (delivery/warranty/reporting). The Integration gate only proves it. Because A0 did not name a count seam (a0-read-surface-matrix.md S-07..S-16) and W4/W5 are closed, adopting it into P1-30 versus a named follow-on is the Owner decision in C-15.
- **Dependencies:** F-02 (item and location writers; PROC-08/PROC-09); C-2 (scope), C-3 (counter), C-4 (cutoff), C-7 (adjustment routes, PROC-10); two distinct authorised users in the tenant for maker≠approver; Owner decision C-15 (placement); Owner decision on what "cycle" selects (by location, by item category, by explicit item list — not stated).
- **Acceptance criteria:** On a tenant with at least one balance cell: a user holding `inv.stock.operate` opens a count of type full and a count of type cycle; both are readable back with their type and state; an attempt to set `countType` to any other value is refused with a validation error; the count creates no `inv.stock_movements` row and changes no `inv.stock_balances` row until approval (C-7); PC-1 holds (authorised sees, unauthorised refused, cross-tenant invisible).
- **Unverified:** Whether the administrator bundle now holds `inv.stock.operate` / `inv.adjustment.approve` after A0 F-01's repair was not re-checked in this pass (a0-read-surface-matrix.md:245-262 lists both among the 24 codes S-01 proposed).

### OWR-2026-09-06-C-2 — Owner requirement · **Blocked**

> with scope

- **Normalised behaviour:** Every count declares, before any quantity is entered, the exact set of balance cells it covers — the branch, one or more stock locations, and optionally an item subset — and only cells inside that scope can receive a counted quantity or produce a variance.
- **Existing evidence:** Scope primitives exist: every inventory operation is branch-scoped with `companyId`+`branchId` required as the authorisation target (apps/api/src/app/api/v1/stock-movements/route.ts:37-46; inventory-reconciliations/route.ts:33-45); `inv.stock_locations` carries `location_type` in ('warehouse','storage','quarantine') with a warehouse→storage/quarantine hierarchy (supabase/migrations/20260723093000_inv_reference.sql:319-341) and is now listable by `inv.stock-location-list` (apps/api/src/app/api/v1/stock-locations/route.ts:57, A2 seam S-16, a0-read-surface-matrix.md:289); `/stock-availability` excludes quarantine unless `includeQuarantine=true` (stock-availability/route.ts:7-9, 49). No count exists to attach a scope to.
- **Remaining gap:** A scope record on the count (branch + location set + optional item set), enforcement that count lines and variances stay inside it, and a decision whether quarantine cells are counted by default (they are excluded from availability by default today).
- **Owning module:** api module `inventory`; schema `inv` (count header scope columns or a count-scope child table referencing `inv.stock_locations` (tenant_id, company_id, branch_id, id) and optionally `inv.item_master` (tenant_id, id)).
- **Delivery placement:** Same as C-1: Backend prerequisite on the `remediation/p1-30-backend-*` lane, then the P1-30 inventory screen; subject to Owner decision C-15.
- **Dependencies:** C-1; F-02 / PROC-09 (locations must be creatable in-product); Owner decision on whether quarantine locations are inside a full count by default.
- **Acceptance criteria:** A count opened for location L1 refuses a counted quantity for a cell in location L2 of the same branch with a validation error naming the scope; a full count over a branch enumerates exactly the balance cells `GET /stock-availability` returns for that branch (with `includeQuarantine` matching the count's declared rule); a count naming a location of another company/branch pair is refused before any row is written (same H6 pattern as inventory-repository.ts:1786-1800).

### OWR-2026-09-06-C-3 — Owner requirement · **Blocked**

> responsible counter

- **Normalised behaviour:** Each count, and each counted quantity, records the responsible counter as the authenticated person who entered it; the counter cannot be named in the request, and the person who approves the resulting variance must be a different person.
- **Existing evidence:** The exact pattern exists for opening batches and is the strongest reusable evidence in this area: `counted_by` is taken from the caller and the body schema is `.strict()` so a supplied `countedBy` is refused (apps/api/src/app/api/v1/opening-inventory-batches/route.ts:28-47; apps/api/src/modules/inventory/application/inventory-intake-service.ts:166-177); the database forbids approver = counter (`ck_opening_inventory_batches_maker`, supabase/migrations/20260723095000_inv_operations.sql:84; trigger `guard_opening_batch_approval` :26-38); the same rule is on adjustments as `requested_by` ≠ `approved_by` (:190, :40-52). Every movement carries `actor_id` and `created_by` from `iam.current_user_id()` (20260723094000_inv_ledger.sql:55-60, :291-293). Employee identity to render a NAME rather than a UUID: the register records that no technician/employee identity exists (P1-29 rows `INT-045`/`INT-047`) — UNVERIFIED in this pass whether P1-29's W-items closed it.
- **Remaining gap:** A count table carrying `counted_by` per header and per line/recount, bound to the principal exactly as the opening batch does; a name-resolution read so the screen shows a person, not a UUID (register shared-UX rule).
- **Owning module:** api module `inventory` (intake service pattern); schema `inv`; name resolution via whatever employee/user identity read P1-29 delivered (UNVERIFIED).
- **Delivery placement:** Same as C-1 (Backend prerequisite, then P1-30 screen; Owner decision C-15).
- **Dependencies:** C-1; a second authorised person in the tenant (maker≠approver is unapprovable with one user, same as the opening batch); an employee/user display-name read.
- **Acceptance criteria:** A count open request that includes `countedBy` is refused with a strict-body validation error; the stored counter equals the authenticated principal; a line entered by user A and recounted by user B records both actors; approval by the same principal who entered every counted line is refused (database CHECK/trigger), approval by a different principal succeeds; the screen renders the counter's name.
- **Unverified:** Whether an employee/user name read exists on develop for rendering the counter (P1-29 INT-045/INT-047 closure) was not re-verified.

### OWR-2026-09-06-C-4 — Owner requirement · **Blocked**

> a defined count cutoff or movement reconciliation method

- **Normalised behaviour:** Every count fixes, per cell, the ledger position it was counted against (the cutoff), and the variance is computed against the ledger sum at that position; movements posted after the cutoff are reconciled explicitly (netted or listed) rather than silently absorbed into the variance.
- **Existing evidence:** The ledger supplies an exact cutoff anchor: `inv.stock_movements.seq` is `GENERATED ALWAYS AS IDENTITY` and the movement list is ordered by it because `occurred_at` is not a strict order (apps/api/src/app/api/v1/stock-movements/route.ts:8-12; inventory-repository.ts:1575); the list accepts `occurredFrom`/`occurredTo` as full ISO instants (route :52-55; repository :1688-1692) and a `seq` keyset cursor. `occurred_at` is stamped `now()` at posting (20260723094000_inv_ledger.sql:290-292) and no operation can backdate it — it is recording time, not physical time (docs/product/workshop/parts-and-procurement-flow.md:229-238). `inv.stock_balances.record_version` exists (20260723094000_inv_ledger.sql:112) but no read publishes it (grep of inventory-repository.ts: no balance recordVersion). Every balance writer takes `FOR UPDATE` on the cell (`inv.lock_stock_balance` :257-280). No location freeze/lock and no count exist.
- **Remaining gap:** A per-cell cutoff position stored on the count line (recommended: the highest `seq` for that cell at the moment the line is opened, or a count-wide snapshot instant taken from the database clock as `reconcile` does at inventory-read-service.ts:653-656); a server-computed expected quantity = Σ `signed_qty` where `seq` ≤ cutoff; a post-cutoff movement listing per cell so the reconciliation is visible; a policy for lines whose cell moved after cutoff (C-9).
- **Owning module:** api module `inventory`; schema `inv` (count line columns for cutoff `seq`/instant and expected quantity; read over `inv.stock_movements`).
- **Delivery placement:** Same as C-1 (Backend prerequisite, then P1-30 screen; Owner decision C-15).
- **Dependencies:** C-1; proposed policy C-12 (which of the two Owner-allowed methods to adopt); PROC-13 does not bind (attribution to a work order is not needed for a cutoff).
- **Acceptance criteria:** For a cell with movements at seq 5 and 9, a count line opened between them stores cutoff seq 5 and expected = Σ signed_qty through seq 5; posting the seq-9 movement does not change the stored expected value; the count read returns, per line, the cutoff position and the list (or net) of movements after it; the variance equals counted − expected-at-cutoff, never counted − live on-hand.

### OWR-2026-09-06-C-5 — Owner requirement · **Blocked**

> recounts

- **Normalised behaviour:** A count line can be counted again one or more times before approval; every recount is appended with its own actor and time, the earlier entries are never overwritten, and the value used for the variance is the latest recount.
- **Existing evidence:** None. The platform's append-only conventions are the reusable precedent: the movement ledger is SELECT+INSERT only (20260723094000_inv_ledger.sql:97; tests/db/inv-ledger.test.ts:114; tests/db/p1-21-inventory-integrity.test.ts:344), and immutability triggers (`org.guard_immutable_columns`) freeze identity columns on every inv table (e.g. 20260723095000_inv_operations.sql:200-201). Opening-batch lines have no recount concept.
- **Remaining gap:** A recount entry table (or append-only entries per line) with actor, time, counted quantity; a rule that the latest entry drives the variance; a decision on whether a recount is mandatory when a variance is non-zero (not stated by the Owner).
- **Owning module:** api module `inventory`; schema `inv` (count entries, append-only: SELECT+INSERT grant only, no UPDATE path).
- **Delivery placement:** Same as C-1 (Backend prerequisite, then P1-30 screen; Owner decision C-15).
- **Dependencies:** C-1, C-3; Owner decision whether a non-zero variance requires a second count before it can be approved.
- **Acceptance criteria:** Entering quantity 10 then 12 on the same line yields two entries readable in order with two actors/times; the variance uses 12; an UPDATE or DELETE on an entry as `app_runtime` is refused (grant/RLS), like the ledger test at tests/db/inv-ledger.test.ts:114; after approval no further entry is accepted (terminal state).

### OWR-2026-09-06-C-6 — Owner requirement · **Blocked**

> discrepancies

- **Normalised behaviour:** For every counted line the server records and returns the expected quantity at cutoff, the counted quantity, and the signed variance as decimal strings; a screen renders these and computes nothing.
- **Existing evidence:** The arithmetic and rendering rules exist: quantities are `numeric(12,3)` carried as decimal strings end to end (docs/product/workshop/parts-and-procurement-flow.md §4.4; tests/db/p1-21-inventory-integrity.test.ts:101); P1-30's closure condition forbids client arithmetic (`P1-30 RENDERS SERVER ARITHMETIC ONLY`, docs/phase-1/phase-1-30/canonical-plan.md §3). `GET /inventory-reconciliations` already computes a server-side stored-vs-ledger comparison per cell and returns `coherent`, `storedOnHand`, `ledgerOnHand` (inventory-repository.ts:1780-1849; read-service :586-661) — but it compares the cache to the ledger, not a physical count to the ledger, is gated by `inv.audit.read` (high) which A0 says no P1-30 screen should reach for (a0-read-surface-matrix.md:361-362), and reports rather than repairs.
- **Remaining gap:** Count-line columns for expected/counted/variance computed in SQL at entry and frozen at approval; a read under `inv.stock.read` (not `inv.audit.read`) that returns them; a variance summary per count (counts only, no totals — keyset rule, parts doc §4.6).
- **Owning module:** api module `inventory` (read service); schema `inv`.
- **Delivery placement:** Same as C-1 (Backend prerequisite, then P1-30 screen; Owner decision C-15).
- **Dependencies:** C-4 (expected-at-cutoff), C-5 (latest recount); the money/quantity string gate (`MONEY_IDENTIFIER` trap: do not name a state field total/remaining/balance/cost in the web feature).
- **Acceptance criteria:** Expected 7.000, counted 5.500 returns variance "-1.500" as a string from the read; the web feature has no arithmetic over these fields (the server-arithmetic gate passes non-vacuously over the count page); a line with zero variance is distinguishable from an uncounted line.

### OWR-2026-09-06-C-7 — Owner requirement · **Blocked**

> authorized adjustments

- **Normalised behaviour:** A count variance changes stock only through an adjustment that a second, authorised person approves; the approval posts one `adjustment` movement per line bound to the approved direction and quantity, and a rejected variance posts nothing.
- **Existing evidence:** The database half is built and proven, the API half does not exist. `inv.stock_adjustments` (supabase/migrations/20260723095000_inv_operations.sql:156-212): direction in/out, quantity > 0, reason required, `requires_approval` default true, status pending/approved/rejected (:188), `approved_by <> requested_by` (:190) enforced again by `guard_adjustment_approval` with approved/rejected terminal (:40-52); `inv.approve_adjustment` flips pending→approved with `approved_by = iam.current_user_id()`, frees junior reservations first on an `out` (:756-769, :648-671), and posts the movement; the provenance guard refuses any `adjustment` movement whose source is not approved or whose direction/quantity differ (:626-632). Proven: tests/db/inv-operations.test.ts:65-91 (no movement while pending; on_hand 10→7 after approval; requester OTHER_ACTOR ≠ approver USER_A). Value impact lives in `inv.stock_adjustment_details`, gated by `inv.cost.view` at the row level (:214-255). Permission `inv.adjustment.approve` is seeded (04_iam_permission_catalog.sql:47) and used only by opening-batch approval. No route: the 17 `inv.` operations (grep `id: 'inv.` under apps/api/src/app/api/v1) contain no adjustment create/approve/reject/read; apps/api/src references `stock_adjustments` only in a docblock (inventory-stock-service.ts:805-818). Recorded as PROC-10 and PROC-19 (docs/product/workshop/parts-and-procurement-flow.md:692, 701; docs/product/README.md:251, 260). Web: an `adjustment` movement would render (`inventory.movementType.adjustment` apps/web/src/i18n/messages/en.json:3002, MovementsScreen.tsx:351) but none can exist. Live DB: 0 rows in `inv.stock_adjustments`.
- **Remaining gap:** Operations: create adjustment (from a count line, requester = principal, `.strict()` refusing `requestedBy`), approve (`inv.adjustment.approve`, calls `inv.approve_adjustment`), reject (no DB function exists — a status write to `rejected` under the existing trigger), read/list. A provenance link from the adjustment to the count line (new nullable FK column, or the count line references the adjustment id) so the audit chain count→variance→adjustment→movement is queryable. Decision on `requires_approval`: the table comment says "over-threshold stays pending" but no threshold exists anywhere; recommendation is every count variance requires approval.
- **Owning module:** api module `inventory` (stock or intake service); schema `inv.stock_adjustments`, `inv.stock_adjustment_details`, `inv.stock_movements`; permission `inv.adjustment.approve`, `inv.cost.view`.
- **Delivery placement:** Backend prerequisite on `remediation/p1-30-backend-*` (PROC-10 names P1-21 as the owning Backend phase; that phase is closed, so the P1-30 backend lane carries it under change control), then P1-30 screen; Owner decision C-15. Note this line has value independent of stocktaking: it is also the only documented route out of quarantine and the only correction path for an issue recorded in error (PROC-19), so it can be sequenced first.
- **Dependencies:** C-3 (maker≠approver), C-6 (variance); a second authorised person; Owner decision on who approves and whether any auto-approval threshold exists (recommend none); PROC-11 / `inv.cost.view` if the value impact of a variance is to be recorded (no cost read or writer exists, so `value_impact` cannot be computed today).
- **Acceptance criteria:** POST creates a pending adjustment and `GET /stock-movements` shows no movement for it; approval by the requester is refused (23514 surfaced as the platform's conflict/validation failure); approval by another holder of `inv.adjustment.approve` returns 200, one `adjustment` movement with matching direction/quantity appears, `on_hand` changes by exactly the signed quantity, and a second approval replays or refuses per the idempotency contract; rejection posts nothing and is terminal; the details row is invisible without `inv.cost.view` (tests/db/p1-10-security.test.ts:100 lists the table among gated ones).

### OWR-2026-09-06-C-8 — Owner requirement · **Blocked**

> and an audit trail

- **Normalised behaviour:** Opening, entering, recounting, closing, approving and rejecting a count each write an `iam.audit_records` entry in the same transaction, naming actor, count, line and the before/after quantities as classified details, and the resulting movement is attributable back to the count.
- **Existing evidence:** The audit subsystem exists and is append-only for the runtime: `iam.audit_records` created 20260718095000_iam_audit_subsystem.sql:50, SELECT (20260718098000:44) and INSERT (20260725090000:260) granted to `app_runtime`. Every inventory operation appends in-transaction via `appendAudit` with a declared `auditAction`: `inv.opening_batch.created` (inventory-intake-service.ts:183-196, incl. `countedBy`), `inv.opening_batch.approved` (:340-341), `inv.stock.reserved` (inventory-stock-service.ts:231-232), `inv.stock.reservation_released` (:322-323, :700-701), `inv.part.issued` (:444-445), `inv.part.returned` (:552-553), `inv.stock.damaged` (:741-742); reads of the ledger and the reconciliation are themselves audited (`inv.movement_history.read` stock-movements/route.ts:69; `inv.reconciliation.performed` inventory-read-service.ts:638-650 recording `cellsChecked`/`incoherentCells`, never rows). The movement ledger itself is the immutable business trail (parts doc §14, lines 620-651). No count actions exist.
- **Remaining gap:** Count-specific audit actions (`inv.stock_count.opened` / `.entered` / `.recounted` / `.closed` / `.approved` / `.rejected` — names to be declared by the Backend lane) with the platform's classified `details`; a queryable chain count line → adjustment → movement (C-7's link column).
- **Owning module:** api module `inventory` (appendAudit calls per operation, `auditClass` per `defineOperation`); `iam.audit_records`.
- **Delivery placement:** Same as C-1 (Backend prerequisite; the audit rows are written by the same operations).
- **Dependencies:** C-1..C-7; the operation-coverage and access gates that assert every operation declares an `auditAction`.
- **Acceptance criteria:** After a full count lifecycle, `iam.audit_records` holds one row per state change with the count id as entity, the principal as actor and the quantities as details; the approval row carries `auditClass` approval as the opening-batch approval does (approval/route.ts:44); an audit read of the count (if privileged) is itself audited; no audit row exists for a refused action.

### OWR-2026-09-06-C-9 — Owner requirement · **Blocked**

> Test movements that occur while counting

- **Normalised behaviour:** An automated test opens a count, posts real issue/return/damage movements on a counted cell from a second session while the count is open, then approves the variance, and proves that the stored balance still equals the ledger sum and that the variance was taken against the cutoff, not the moved balance.
- **Existing evidence:** Adjacent proofs exist, none about counting: two sessions racing for the last unit leave exactly one winner (tests/db/p1-21-inventory-integrity.test.ts:118); stored balances stay coherent with the ledger after every posting (:226); a raw negative balance write is refused bypassing every function (:191); a forged/incoherent balance write is rejected (tests/db/inv-ledger.test.ts:71); loss-time reservation release keeps available ≥ 0 (tests/db/inv-operations.test.ts:93+). The isolation mechanics the test would rely on are in place: every balance writer locks the cell `FOR UPDATE` (20260723094000_inv_ledger.sql:257-280), and `set_config(..., true)` is transaction-local so two sessions can be driven from one suite (memory: BR-06). Backend suites delete tenants by prefix on the shared DB (memory rule) — the test must use its own prefix.
- **Remaining gap:** The count itself (C-1, C-4, C-7) and then the test: a DB-tier test in tests/db and a backend-tier test over the routes, both asserting variance = counted − expected-at-cutoff and on_hand = Σ signed_qty after approval, and asserting that a post-cutoff movement is surfaced in the count read (C-4) rather than lost.
- **Owning module:** tests/db (new inventory count test) and tests/backend (route-level); api module `inventory`.
- **Delivery placement:** Same Backend prerequisite branch as C-1/C-4/C-7 — the test lands with the contract, not after it (P1-30 W8 QA evidence then cites it).
- **Dependencies:** C-1, C-4, C-7; the local-machine per-case timeout budgets (memory: BR-05) since a two-session test is slow.
- **Acceptance criteria:** A named test exists and is green in the hosted DB job: cell on_hand 10; count line opened (cutoff seq N, expected 10); second session issues 3 (seq N+1); counter enters 9; approval posts an adjustment of −1 (9 − 10), not −(9 − 7) = +2; after approval `on_hand` = 6 = Σ signed_qty; the count read lists the seq N+1 movement as post-cutoff. A second variant proves the reverse (return after cutoff).

### OWR-2026-09-06-C-10 — Owner requirement · **Delivered**

> and prevent a blind overwrite of live balances

- **Normalised behaviour:** No operation, count included, can set `inv.stock_balances.on_hand_qty` to a counted figure; a balance can change only by a provenance-guarded movement, and any balance write that does not equal the ledger sum is refused by the database.
- **Existing evidence:** Delivered as a platform-wide invariant. `inv.guard_stock_balance_coherence` refuses any balance INSERT/UPDATE where on_hand ≠ Σ signed_qty or reserved ≠ Σ active reservations (supabase/migrations/20260723094000_inv_ledger.sql:133-153, trigger :153); `inv.guard_stock_movement_provenance` refuses any movement without a valid, approved, quantity-matched source (20260723095000_inv_operations.sql:592-641); the ledger is SELECT+INSERT only (20260723094000:97) and each source is single-use (:80). There is deliberately no "set stock level" endpoint (opening-inventory-batches/route.ts:13-17). Proven: tests/db/inv-ledger.test.ts:71 (forged balance rejected), :114 (no UPDATE/DELETE on the ledger); tests/db/p1-21-inventory-integrity.test.ts:191 (raw negative balance refused bypassing every function), :226 (coherent after every posting), :298 (legal triple with no source refused), :316 (single-use source), :344 (append-only); tests/db/inv-operations.test.ts:115 (forged movement with no source). `GET /inventory-reconciliations` re-derives and reports, never repairs (inventory-reconciliations/route.ts:1-18; read-service :578-585).
- **Remaining gap:** None for the invariant. The count-specific corollary — that the variance is derived from the cutoff position rather than from the live balance at approval time — is owed under C-4/C-9, and `inv.stock_balances.record_version` (20260723094000:112) is not published by any read, so a screen has no optimistic-concurrency token for a cell (acceptable while every write is a movement).
- **Owning module:** schema `inv` (`inv.stock_balances`, `inv.stock_movements`, the two guards); api module `inventory` (no balance-setting operation exists by design).
- **Delivery placement:** Already on protected develop (P1-10 schema, P1-21 backend); re-verified by the DB tier on every run. Any count implementation inherits it; the register should record it as Delivered — platform-wide invariant, like the decimal-string money row.
- **Dependencies:** None. C-4 and C-9 depend on it, not the reverse.
- **Acceptance criteria:** As `app_runtime` with a tenant context, `UPDATE inv.stock_balances SET on_hand_qty = <counted>` on a cell with movements fails with 23514; a direct INSERT into `inv.stock_movements` citing a pending or non-existent adjustment fails; after any approved count the reconciliation read reports `incoherentCells` 0 for the branch page examined.

### OWR-2026-09-06-C-11 — Proposed implementation policy · **Undecided**

> (policy for) authorized adjustments … prevent a blind overwrite of live balances

- **Normalised behaviour:** Count variances post through the existing `inv.stock_adjustments` → `inv.approve_adjustment` → `adjustment` movement path, one adjustment per non-zero line, with a provenance link from the adjustment to the count line; no new movement type or reference kind is introduced.
- **Existing evidence:** The path exists and is tested (see C-7); the domain's legal triples already admit `adjustment` in both directions (apps/api/src/modules/inventory/domain/inventory.ts:126-140; supabase/migrations/20260723094000_inv_ledger.sql:71-75); adding a movement type would require widening `ck_stock_movements_type`, `ck_stock_movements_reference_kind`, the provenance guard, the domain transcription and tests/db/p1-21-inventory-integrity.test.ts:74 ("transcribes every CHECK constraint exactly") — a much larger blast radius for no business gain.
- **Remaining gap:** The link column (count line → adjustment, or adjustment.count_line_id nullable) and the batch semantics: approving a count approves N adjustments atomically in one transaction (like `inv.approve_opening_batch` loops lines, :740-754), so a partially approved count is unrepresentable.
- **Owning module:** api module `inventory`; schema `inv.stock_adjustments` (+ one nullable FK column) and the new count tables.
- **Delivery placement:** With C-7 on the Backend prerequisite branch.
- **Dependencies:** C-7; Owner acceptance of this policy (it means a count variance is indistinguishable in the ledger from a manual adjustment except through the link column — the movement's `notes` should carry the count code).
- **Acceptance criteria:** Approving a count with three non-zero lines produces exactly three `adjustment` movements and three approved adjustments, all in one transaction; if the third refuses (e.g. an `out` larger than on-hand), zero movements exist; a manual adjustment created outside a count has a null count link.

### OWR-2026-09-06-C-12 — Proposed implementation policy · **Undecided**

> a defined count cutoff or movement reconciliation method

- **Normalised behaviour:** Adopt the movement-reconciliation method with a per-cell ledger-position cutoff: when a count line is opened the server stores that cell's current maximum `inv.stock_movements.seq` and the ledger sum through it as the expected quantity; operations on the cell are NOT frozen; movements after the cutoff are listed on the line and the counter may re-anchor (new cutoff, recomputed expected) before approval.
- **Existing evidence:** Why not an operational freeze: no lock/freeze primitive exists on `inv.stock_locations` (status is only active/inactive, 20260723093000_inv_reference.sql:339) and every stock operation would need a new refusal path; a freeze during a live workshop day contradicts the reservation/issue flow the Owner's step 17 describes (end-to-end-workshop-workflow.md:657-670). Why `seq` and not an instant: `occurred_at` is not a strict order and is recording time (stock-movements/route.ts:8-12; parts doc :229-238), while `seq` is a strict identity (20260723094000_inv_ledger.sql:58). The reconciliation read already demonstrates database-clock snapshots (inventory-read-service.ts:653-656).
- **Remaining gap:** Implementation per C-4; an Owner nod that a count does not block issuing parts.
- **Owning module:** api module `inventory`; schema `inv` (count line: `cutoff_seq`, `expected_qty`).
- **Delivery placement:** With C-4 on the Backend prerequisite branch.
- **Dependencies:** C-4; Owner acceptance (the Owner allowed either method; this chooses the one that does not stop the workshop).
- **Acceptance criteria:** The C-9 test passes; a line whose cell has post-cutoff movements is flagged in the count read; re-anchoring a line records a new cutoff and a new expected value as an appended entry, never an overwrite.

### OWR-2026-09-06-C-13 — Proposed implementation policy · **Undecided**

> discrepancies

- **Normalised behaviour:** Expected, counted and variance are computed in SQL on the server at entry time and frozen at approval; the P1-30 screen renders the three strings and computes nothing (the phase's closure condition), and no count read returns a money value unless the caller holds `inv.cost.view`.
- **Existing evidence:** `P1-30 RENDERS SERVER ARITHMETIC ONLY` (docs/phase-1/phase-1-30/canonical-plan.md §3); `inv.stock_adjustment_details.value_impact` is row-gated by `inv.cost.view` (20260723095000_inv_operations.sql:247-252; p1-30-frontend-contract.md:30-34); no cost read or writer exists (PROC-11, parts doc :578, :696), so a valued variance cannot be produced today.
- **Remaining gap:** Implementation per C-6; a decision that value impact is out of the first delivery (recommended, because cost has no writer).
- **Owning module:** api module `inventory` (read service); web feature apps/web/src/features/inventory (a count screen alongside PartsScreen/MovementsScreen).
- **Delivery placement:** Backend read on the prerequisite branch; screen in the P1-30 Frontend wave that C-15 authorises.
- **Dependencies:** C-6; PROC-11 if value is wanted.
- **Acceptance criteria:** The server-arithmetic gate passes non-vacuously over the count page; a caller without `inv.cost.view` receives no `valueImpact` field (absent, not null-as-zero); quantities are strings to three decimals.

### OWR-2026-09-06-C-14 — Proposed implementation policy · **Undecided**

> responsible counter … authorized adjustments … audit trail

- **Normalised behaviour:** Reuse the existing catalogue without minting codes: open/enter/recount/close a count under `inv.stock.operate`; read a count under `inv.stock.read`; approve or reject the variance under `inv.adjustment.approve` (high); value impact under `inv.cost.view`; the count read is NOT gated by `inv.audit.read`.
- **Existing evidence:** Catalogue rows supabase/seeds/04_iam_permission_catalog.sql:45-48, 56-59; the split is exactly the opening-batch split (create/lines `inv.stock.operate`, approval `inv.adjustment.approve`: opening-inventory-batches/route.ts:57, approval/route.ts:42); A0's rule that no seam mints a code and that `inv.audit.read` is not for screens (a0-read-surface-matrix.md:361-366); the description of `inv.adjustment.approve` already reads "Approve stock adjustments/opening batches".
- **Remaining gap:** An Owner check that a storekeeper who counts should hold `inv.stock.operate` (which also issues and reserves) — if the Owner wants a counter who cannot issue, a new code is a separate declared act on the Backend lane and a bundle/backfill decision (navigation-permission-reachability lesson).
- **Owning module:** permission catalogue seed; route `permissions` declarations; navigation.ts gate for a `/inventory/counts` page (currently `/inventory` is gated on `inv.item.read`, apps/web/src/config/navigation.ts:369-376).
- **Delivery placement:** With the operations on the Backend prerequisite branch; navigation entry with the P1-30 screen.
- **Dependencies:** Owner decision on a count-only authority; A0 F-01 bundle contents (UNVERIFIED).
- **Acceptance criteria:** The route-permission parity gate passes; a principal with only `inv.stock.read` can read but not open a count; only `inv.adjustment.approve` can approve; the access gate proves each over the count page non-vacuously.
- **Unverified:** Whether the first administrator's bundle holds `inv.stock.operate` and `inv.adjustment.approve` on develop 6f6236c3 was not re-checked.

### OWR-2026-09-06-C-15 — Proposed implementation policy · **Undecided**

> Provide full and cycle counts … (placement of the whole area)

- **Normalised behaviour:** Stocktaking is delivered as one Backend prerequisite branch on the `remediation/p1-30-backend-*` lane (migration + operations + DB/backend tests, sequenced C-7 adjustments first, then counts) followed by one P1-30 Frontend wave for the count screen — OR, if the Owner keeps P1-30's closed W4/W5 scope, as a named follow-on after the Integration gate; the Owner chooses, and the choice is recorded in the register and the P1-30 canonical plan.
- **Existing evidence:** P1-30's plan: Frontend branches never change apps/api and schema changes return through change control (canonical-plan.md §1.4 lines 52-58, §2 lines 60-70); Backend prerequisites are "A0 named" and A0 named none for counting (a0-read-surface-matrix.md S-07..S-16, lines 280-289); W4/W5 inventory waves are closed (memory: PRs #317/#318); the parts doc marks every PROC row "Not allocated" pending an Owner scope decision (parts-and-procurement-flow.md:675-689); the register's own rule that a requirement is built in the phase that owns it, never earlier or later for convenience (owner-workflow-requirements.md:38-40).
- **Remaining gap:** The decision itself, then the register rows for C-1..C-10 with the chosen phase in their Status column.
- **Owning module:** docs/product/owner-workflow-requirements.md (register), docs/phase-1/phase-1-30/canonical-plan.md (execution matrix), the p1-30-backend ownership profile.
- **Delivery placement:** Decision before any code; this line is the gate for all others in Area C.
- **Dependencies:** F-02 must close first either way (nothing to count on a fresh tenant); C-7 can land independently and earlier because it closes PROC-10/PROC-19.
- **Acceptance criteria:** The register carries Area C rows with a single owning phase each; the P1-30 plan's execution matrix either gains a BR/W row for stocktaking or the follow-on is named with its own record under docs/phase-1/; no code lands before that row exists.

---

## Area D — Duplicate demand and approvals

**Where this area stands today.** What exists is transport-level replay safety: every inventory write is `idempotent: true`, the foundation stores the key inside the command transaction and arbitrates concurrent first use by a unique index, and the stock-issue replay is proven not to move stock twice (D-2 Delivered); reservations additionally carry a body-level business key with lifetime uniqueness, a 200/`replayed` answer, and a form-held key in the web. What is missing is everything the Owner calls demand: `inv.part_issues` has no demand key, no job, no reason and no approval reference; no rule compares an issue to `wo.required_parts` or to an accepted quotation line; a required-part line cannot be cancelled; the only inventory approval code (`inv.adjustment.approve`) has no route and is outside the administrator bundle; and the web issue form mints a fresh key per press, so only the in-flight `busy` flag stands between a lost answer and a second issue. The concurrency primitives a rule needs — the work-order `FOR UPDATE` on every issue and the balance-cell lock, with a 10-session last-unit race proven — already exist, but there is no rule to enforce and no HTTP-level race on `/stock-issues`. Placement: the web key fix is a P1-30 W5 correction; the demand rule, job attribution, reason, and authorisation are one P1-30 corrective Backend slice on `remediation/p1-30-backend-*` (precedent: the tenant-bootstrap corrective slice) and cannot be scoped until the Owner decides the authoritative demand source and precedence (OD-D-a), the context unit (OD-D-b), and who approves an over-issue and whether a value ceiling applies (OD-D-c); if deferred past P1-30 W9 it must be recorded as an Integration-gate accepted risk or a named follow-on. No existing register row covers this area, so all lines are dated OWR-2026-09-06-D ids; the related rows are P1-30 'Part issue', 'Part consumption', 'Customer approval' and the PROC-10/-14/-19/-21 findings.

### OWR-2026-09-06-D-1 — Owner requirement · **Planned**

> Distinguish transport retries from a new business demand.

- **Normalised behaviour:** A re-presentation of the same issue/reservation command (same logical attempt, lost or timed-out answer) resolves to the original record, while a genuinely new request for the same part on the same context is recognised as new demand and treated under D-3, never silently as a retry and never silently as a fresh issue.
- **Existing evidence:** Transport half exists for BOTH inventory writes: `inv.stock-issue-create` and `inv.stock-reservation-create` declare `idempotent: true` (apps/api/src/app/api/v1/stock-issues/route.ts:69; stock-reservations/route.ts:172), so `route-handler.ts:368-373` requires an `Idempotency-Key` header and `apps/api/src/server/http/idempotency.ts:394-436` fingerprints tenant+principal+method+route template+params+body (scheme `rootlco.idempotency.v3.principal-and-target-bound`, :109); same key+same fingerprint replays the stored body (:511-518), same key+different fingerprint is `ERR-INT-001` (:515-516). Business-key half exists ONLY for reservations: body `idempotencyKey` (stock-reservations/route.ts:153) is stored in `inv.stock_reservations.idempotency_key` under `uq_stock_reservations_idempotency (tenant_id, idempotency_key) WHERE NOT NULL` (supabase/migrations/20260723094000_inv_ledger.sql:212, confirmed in the live catalog), resolved inside the balance lock by `inv.reserve_stock` (:329-333) and pre-detected by `InventoryStockService.reserve` so the answer is 200 + `replayed:true` (apps/api/src/modules/inventory/application/inventory-stock-service.ts:189-206; tests/backend/p1-21-inventory-stock.test.ts:201-232; tests/backend/p1-30-w4-inventory.test.ts:365). The web reservation form keeps ONE body key per opened form (apps/web/src/features/inventory/components/InventoryScreen.tsx:985-1024). The web ISSUE form does not: `createIssue` passes no key (apps/web/src/features/inventory/api.ts:265-285; PartsScreen.tsx:592-600) and the transport mints a fresh UUID per `send` (apps/web/src/lib/api/client.ts:350-353, 362-364), so pressing Issue again after a lost answer is a second logical attempt, guarded only by the in-flight `disabled={busy}` (PartsScreen.tsx:720).
- **Remaining gap:** (a) `inv.stock-issue-create` carries no business demand identity: `inv.part_issues` has no idempotency/demand key column and its only unique indexes are `pk_part_issues` and `uq_part_issues_scope_id` (live catalog), so the server cannot tell a retry from a repeat except by the transport header, and the web issue form never re-presents the same header key. (b) No DOM test covers a re-press after a lost answer (apps/web/tests/inventory-parts.dom.test.tsx:296-508 has no such case). (c) 'new business demand' cannot be recognised server-side until D-3 exists.
- **Owning module:** api `inventory` (`InventoryStockService.issue`, `inventory-repository.issuePart`), foundation `server/http/idempotency.ts`; schema `inv.part_issues`; web `features/inventory` (PartsScreen IssueForm, api.ts createIssue)
- **Delivery placement:** P1-30 corrective: the web half (one key per opened IssueForm, mirroring InventoryScreen.tsx:989) is a P1-30 W5 correction on the Frontend lane; the server half (a stored demand identity on the issue) travels with the D-3 slice on `remediation/p1-30-backend-*`, because inventory is P1-30-owned (docs/product/owner-workflow-requirements.md P1-30 table rows 'Part issue', 'Part consumption') and the canonical plan sends Backend prerequisites through that lane (docs/phase-1/phase-1-30/canonical-plan.md §1.4, §2).
- **Dependencies:** D-3 (repeat detection) for the 'new demand' half; register row 'Part issue' (P1-30, Contracted); client rule 'this client never retries a mutation' (client.ts:306-336) must stay true or the fresh-key default becomes double issuing.
- **Acceptance criteria:** 1. Same operator, same IssueForm, second press after a lost answer: exactly one `inv.part_issues` row, one `out` movement, one `inv.part.issued` audit row; the second answer is the stored echo. 2. Two different opened forms for the same item on the same work order: the second is classified by D-3 (refused, or accepted only with the D-5 authorisation), never silently replayed. 3. A DOM test asserts the IssueForm re-sends the SAME `Idempotency-Key` on re-press; a backend test asserts a same-key re-post of `/stock-issues` leaves `count(inv.part_issues)` at 1 (extends tests/backend/p1-21-inventory-stock.test.ts:548-576).
- **Unverified:** Whether tests/api-client.test.ts actually proves the 'never retries a mutation' rule (cited by client.ts:300, not read). No hosted environment exists to observe real timeout behaviour.

### OWR-2026-09-06-D-2 — Owner requirement · **Delivered**

> Replaying the same command must not issue stock twice.

- **Normalised behaviour:** Re-posting `inv.stock-issue-create` (or `inv.stock-reservation-create`) with the same Idempotency-Key and the same request commits no second issue row, no second movement, no second audit record and no second outbox event, including when the two presentations run concurrently.
- **Existing evidence:** Server: key row written INSIDE the command transaction so a key exists iff the command committed (idempotency.ts:24-27, 521-536; tests/backend/idempotency.test.ts:256-303); concurrent first use of one key arbitrated by `uq_idempotency_keys_scope`, loser raises `IdempotencyRaceError`, handler re-reads the winner on a fresh transaction (idempotency.ts:537-547, 568-588; route-handler.ts:429-436; tests/backend/idempotency.test.ts:207-255 'commits exactly one execution and stores exactly one row'). Stock-issue specifically: tests/backend/p1-21-inventory-stock.test.ts:548-576 replays the header key and asserts `on_hand` unchanged and `count(inv.part_issues)=1`. Reservation: one row/one audit/one event on replay (p1-21-inventory-stock.test.ts:225-231) and key+different quantity is 409 (:234-252). Principal binding stops one user replaying another's key (idempotency.test.ts:304-470). Web transport attaches the key on every `idempotent: true` operation (client.ts:306-353). Cross-cutting statement in docs/product/workshop/end-to-end-workshop-workflow.md:1063-1072 (§7.4).
- **Remaining gap:** None on the server for a SAME-key replay. The residual is D-1's: the web issue form never re-presents the same key, so the guarantee is reachable from a screen only for reservations today. No HTTP-level test fires two concurrent same-key `/stock-issues` posts (the foundation race test uses a synthetic operation, idempotency.test.ts:207-255).
- **Owning module:** foundation `server/http/idempotency.ts` + `route-handler.ts`; schema `shared.idempotency_keys` (supabase/migrations/20260717107000_org_provisioning.sql:52-74); api `inventory`
- **Delivery placement:** Delivered by P1-13 (foundation) and P1-21 (inventory writes), consumed by P1-30 W5; the screen-side reachability gap is placed with D-1 (P1-30 corrective).
- **Dependencies:** D-1 for screen reachability; register row 'Part issue' (P1-30, Contracted).
- **Acceptance criteria:** Existing: p1-21-inventory-stock.test.ts:548-576 and idempotency.test.ts:114-303 pass on protected develop (reproof 19/19 at 6f6236c3 per the P1-30 records). Additional: a two-connection race posting the same key to `/stock-issues` yields one issue row and one stored key.
- **Unverified:** None beyond the missing concurrent same-key HTTP race on the issue route.

### OWR-2026-09-06-D-3 — Owner requirement · **Blocked**

> Detect repeated demand against the same work-order/task/part context, considering existing reservations, issued quantities, returns, cancellations, and approved revisions.

- **Normalised behaviour:** Before an issue (or reservation) commits, the server computes the net position for the (work order, job, item) context — demand authorised minus (active reservations + issued − returned), with cancelled demand and superseded/rejected revisions excluded — and refuses a request that would exceed it unless the D-5 authorisation accompanies it.
- **Existing evidence:** Inputs partly exist as rows, never as a rule: active reservations per work order and unreturned issues per work order are already aggregated for closure in `countOpenCommitments` (apps/api/src/modules/inventory/data/inventory-repository.ts:1884-1907) and `openCommitmentsFor` (inventory-read-service.ts:296-306), consumed by closure (work-order-service.ts:1537-1545; tests/backend/p1-21-inventory-stock.test.ts:896-987); returned-so-far per issue is published by `inv.work-order-part-issue-list` (repository :727-792; tests/backend/p1-30-a2-inventory-reads.test.ts:526-700). Demand lines exist: `wo.required_parts (work_order_id, job_id NULL, item_ref NULL FK→inv.item_master, quantity)` (20260722100000_wo_services_parts_approvals.sql:95-127; live FKs `fk_required_parts_item`, `fk_required_parts_job`), recorded by `wo.required-part-record`, which is DEMAND only (required-parts/route.ts:4-10). The issue may cite `requiredPartRef` but the pointer is advisory — no FK on `inv.part_issues.required_part_ref` (live catalog; PROC-14, docs/product/workshop/parts-and-procurement-flow.md:367-370, docs/product/README.md:255). `InventoryStockService.issue` checks only: sellable location, scope, tracked item, work order accepting parts, reservation match and reservation ceiling (inventory-stock-service.ts:388-421) — no demand ceiling, no repeat check.
- **Remaining gap:** (a) No rule: nothing compares an issue to `wo.required_parts.quantity`, to an approved quotation line, or to prior issues; two issues of the same item to the same work order/job are accepted without limit. (b) No job/task on issues: `inv.part_issues` has no `job_id` (live columns), so 'same task' is only reachable through the advisory `required_part_ref`. (c) No uniqueness or aggregate on `(work_order, job, item)` anywhere (live unique indexes on required_parts/part_issues are pk + scope_id only). (d) 'Cancellations' unrepresentable for demand: `wo.required_parts` has no state column and only POST/GET routes (required-parts/route.ts), so a demand line cannot be cancelled; reservations (`released`/`expired`), additional work (`withdrawn`) and revisions (`superseded`/`rejected`/`expired`, 20260723096000_quo_quotations.sql:111) do carry cancellation states. (e) No error code names the refusal.
- **Owning module:** api `inventory` (issue/reserve path) with a port into `work-order` (required parts, jobs) and `quotation` (approved revision lines, per D-4); schema `inv.part_issues`, `wo.required_parts`, a new guard/function in `inv`
- **Delivery placement:** P1-30 corrective Backend slice on `remediation/p1-30-backend-*` (schema + rule; precedent: docs/phase-1/phase-1-30/tenant-bootstrap-corrective-slice.md). Reason: inventory issue is P1-30-owned and the Owner asks for server enforcement, which the Frontend lane may not add (canonical-plan.md §2). If the Owner defers it past P1-30 acceptance it must be recorded as an Integration-gate accepted risk, not left implicit.
- **Dependencies:** Owner decision OD-D-a: which demand source is authoritative when both a required-part line and an approved quotation line exist, and whether an issue with NO demand line at all (legal today) stays legal or becomes an over-issue needing D-5. Owner decision OD-D-b: unit of context — per (work order, job, item) as proposed, or per work order only. D-4 (approved revisions), D-6 (reason), D-7 (must not refuse another task/visit), D-8 (concurrency). PROC-14 (FK on required_part_ref), PROC-21 (required-parts list unpaged).
- **Acceptance criteria:** 1. Work order W, job J, item I with demand 2: issue 2 → 201; a further issue of 1 for (W,J,I) without D-5 authorisation → refused with a named code and the net position in `safeDetails`. 2. Return 1 of the 2, then issue 1 → 201 (returns re-open headroom). 3. Reserve 2 for (W,J,I) then attempt to issue 2 without citing the reservation → refused (the reservation already counts against demand). 4. Cancel/withdraw the demand line → subsequent issue refused. 5. Supersede the approved revision by one with quantity 3 → issue of the third unit → 201 (D-4). 6. Same item to job J2 on W, or to another work order → 201 without authorisation (D-7). 7. Two concurrent issues each for the last authorised unit of (W,J,I): exactly one 201 (D-8).
- **Unverified:** Whether `wo.jobs` can be cited from `inv` without a module cycle (the work-order→inventory port direction is documented at inventory-read-service.ts:291-295 and :520-522; the reverse read of jobs from inventory is not). Whether any hosted environment has real required-part data — none exists locally beyond suites.

### OWR-2026-09-06-D-4 — Owner requirement · **Blocked**

> …considering … approved revisions.

- **Normalised behaviour:** The demand authorised for a (work order, item) context includes the captured quantity of that item on the currently approved quotation revision, and a superseded, rejected or expired revision no longer authorises anything.
- **Existing evidence:** `quo.quotation_items.item_ref` foreign-keys `inv.item_master` and carries `captured_quantity` (20260723096000_quo_quotations.sql:172-217, FK :207); at most one `issued` revision per quotation (`uq_quotation_revisions_one_issued`, :118) and issued revisions move only to `superseded`/`rejected`/`expired` (:111, :155-158); item and revision decisions live in `quo.approval_decisions` (:297-317) and quotation status includes `accepted` (:55). The commercial-approval port already validates an ACCEPTED, current, issued, unexpired revision for additional-work approval (additional-work/[requestId]/approval/route.ts:104-117, 52-70).
- **Remaining gap:** No reader of quotation lines exists in the inventory path: grep of apps/api/src/modules/{quotation,billing,work-order} for `part_issues|stock_reservations` returns no file, and `InventoryStockService.issue` never consults `quo`. No link from an issue to the revision line it fulfils. Draft revision totals are database zeros until issue (P1-30 W3 record), so only issued+accepted revisions can be a demand source.
- **Owning module:** api `quotation` (a read port exposing accepted-revision item quantities per work order, in the direction the commercial-approval port already uses) consumed by `inventory`; schema `quo.quotation_items`, `quo.quotation_revisions`, `quo.approval_decisions`
- **Delivery placement:** Same P1-30 corrective Backend slice as D-3 (the port is a Backend contract; the quotation and inventory Frontends are both P1-30 W3/W5).
- **Dependencies:** D-3; Owner decision OD-D-a (precedence between required-part lines and approved revision lines); register row 'Customer approval' (P1-30, Partly blocked, INT-061) and 'Quotation' (Blocked, INT-060).
- **Acceptance criteria:** 1. Accepted revision R1 line item I qty 2 on work order W, no required-part line: issue 2 → 201, issue 1 more → refused. 2. R1 superseded by R2 with qty 3: issue 1 → 201. 3. R2 rejected: any further issue refused until a new authorisation. 4. Item on a draft (unissued) revision authorises nothing.
- **Unverified:** Whether the Owner wants the required-part line or the quotation line to win when they disagree — not stated in the Owner text.

### OWR-2026-09-06-D-5 — Owner requirement · **Undecided**

> Additional quantity or a justified repeat requires the appropriate approval

- **Normalised behaviour:** An issue that exceeds the net authorised demand for its context is accepted only when accompanied by an approval recorded by a holder of a designated approval permission who is not the issuing actor, and that approval is stored, audited under class `approval`, and bound to the specific over-issue.
- **Existing evidence:** Approval primitives exist elsewhere, none for stock issue: (i) `iam.approval_limits` — effective-dated monetary ceilings per role XOR user and `limit_type` (20260718093000_iam_approval_and_sensitive_data.sql:46-89; routes iam/approval-limits/route.ts:54-81, permission `iam.approval.manage`), consumed only by pricing discounts via `DISCOUNT_LIMIT_TYPE='discount'` (apps/api/src/modules/pricing/domain/pricing.ts:45; discount-authorization-service.ts:1-80 with maker≠approver and fail-closed defaults). (ii) `svc.pricing_approval_policies` threshold + required permission (20260723092000_svc_pricing.sql:355-392) — discounts only. (iii) `inv.stock_adjustments` carries `requires_approval`, `reason NOT NULL`, maker≠approver guard and `inv.approve_adjustment` (20260723095000_inv_operations.sql:40-52, 156-192, 756-768) under `inv.adjustment.approve` (high) — but NO route exists (PROC-10, parts-and-procurement-flow.md:692) and the code is absent from the 48-code administrator bundle (no hit in apps/api/src/modules/iam/domain/bootstrap-roles.ts, which lists `inv.item.read`, `inv.stock.read`, `inv.stock.operate` at :200-202), so under `ins_role_permissions_delegable` no first administrator can grant it. (iv) `wo.additional-work-approval` records the CUSTOMER's decision, one active approval per request, If-Match mandatory (additional-work/[requestId]/approval/route.ts:121-140; 20260722100000:341-342) — a customer-scope commitment, not a stock authorisation. Live local DB: 0 rows in `iam.approval_limits` and 0 in `svc.pricing_approval_policies`.
- **Remaining gap:** No over-issue authorisation exists: no permission code, no table/columns on `inv.part_issues` (no approved_by, no approval ref), no route, no audit action, no approval-limit `limit_type` for parts. The one inventory approval code (`inv.adjustment.approve`) is routeless and unholdable by a bootstrapped tenant.
- **Owning module:** api `inventory` (+ `iam` if a monetary ceiling via `iam.approval_limits` is wanted); schema `inv.part_issues` (or a new `inv.issue_authorizations`), `iam.permissions` seed (supabase/seeds/04_iam_permission_catalog.sql), administrator bundle (`bootstrap-roles.ts`)
- **Delivery placement:** P1-30 corrective Backend slice with D-3, but only after the Owner decision below; the permission code must also enter the administrator bundle in the same slice or it repeats A0 F-01 (docs/phase-1/phase-1-30/tenant-bootstrap-corrective-slice.md §1 row 3).
- **Dependencies:** Owner decision OD-D-c: who approves an over-issue/repeat (a new code such as an inventory over-issue approval, or reuse of `inv.adjustment.approve`), whether maker≠approver is mandatory, and whether a monetary ceiling applies (needs a cost source — `inv.cost.view`-gated `inv.item_cost_details` has no read, PROC-11/WF-27). D-3, D-6. Navigation-reachability backfill TB-R1 for existing tenants.
- **Acceptance criteria:** 1. Over-issue without authorisation → refused. 2. Over-issue with an authorisation recorded by a holder of the designated code who is not `created_by` → 201, `inv.part_issues` row references the authorisation, one audit row of class `approval`. 3. Self-approval by the issuer → refused when maker≠approver is on. 4. A fresh organisation's first administrator can hold or delegate the code (bootstrap test in tests/backend against the genesis path).
- **Unverified:** Whether the Owner intends approval by quantity, by value, or by role only — the text says 'appropriate approval' and names no threshold; none is invented here.

### OWR-2026-09-06-D-6 — Owner requirement · **Blocked**

> …and recorded reason.

- **Normalised behaviour:** Every additional-quantity or repeat issue stores a non-blank reason on the issue (or its authorisation) that is immutable after commit and readable on the work order's part-issue list.
- **Existing evidence:** Reason columns exist on neighbouring records with the same shape the platform uses: `inv.part_returns.reason` (nullable, `ck_part_returns_reason_not_blank`, 20260723095000:311-332), `inv.damaged_stock.reason NOT NULL` (:392, :413), `inv.stock_adjustments.reason NOT NULL` (:165, :187), `inv.stock_reservations.released_reason` (20260723094000:209); release accepts `reason` up to `MAX_REASON` (stock-reservations/[reservationId]/release/route.ts:38-42).
- **Remaining gap:** `inv.part_issues` has no reason column (live columns list) and `inv.stock-issue-create` accepts none (stock-issues/route.ts:47-56); `inv.work-order-part-issue-list` therefore cannot show one (repository :755-763).
- **Owning module:** api `inventory`; schema `inv.part_issues` (new nullable-until-required `reason`, frozen by `tg_part_issues_immutable`, 20260723095000:295-296) or the D-5 authorisation record
- **Delivery placement:** Same P1-30 corrective Backend slice as D-5 (one migration); the list/echo change is consumed by P1-30 W5 PartsScreen.
- **Dependencies:** D-5 (when a reason is mandatory); register row 'Part issue'.
- **Acceptance criteria:** 1. Over-issue with blank/absent reason → 422 naming `body.reason`. 2. Accepted over-issue: reason persisted, appears in `GET /work-orders/{id}/part-issues`, and an UPDATE of it is refused by the immutability trigger. 3. An in-demand issue needs no reason (unless the Owner decides otherwise).
- **Unverified:** Whether the Owner wants a free-text reason or a coded vocabulary — not stated; no vocabulary is proposed.

### OWR-2026-09-06-D-7 — Owner requirement · **Blocked**

> A legitimate use of the same part on another task or visit must remain representable.

- **Normalised behaviour:** Issuing the same item to a different job on the same work order, or to a different work order (visit), is accepted without the D-5 authorisation and is stored so that each issue is attributable to its own job and work order.
- **Existing evidence:** Visit dimension is representable today: issues are keyed to `work_order_id` (20230723095000:264, FK :286), one ordinary work order per reception origin (end-to-end-workshop-workflow.md:530), and `inv.work-order-part-issue-list` is per parent (part-issues/route.ts:6-18). Job dimension exists on DEMAND only: `wo.required_parts.job_id` FK→`wo.jobs` (live catalog `fk_required_parts_job`; jobs from 20260901100000_wo_jobs_department_routing.sql); the issue can cite the demand line via `requiredPartRef` (stock-issues/route.ts:54) but without an FK (PROC-14).
- **Remaining gap:** `inv.part_issues` has no `job_id`, so an issue is not attributable to a task except through the advisory pointer; any D-3 rule keyed on (work order, item) alone would wrongly refuse a second job's legitimate use. The web IssueForm prefill from a required part carries `requiredPartRef` (PartsScreen.tsx:565, apps/web/tests/inventory-parts.dom.test.tsx:309) but the server does not validate it belongs to the named work order.
- **Owning module:** api `inventory` + `work-order` port; schema `inv.part_issues` (job attribution: either `job_id` FK within (tenant, company, branch) or an enforced FK on `required_part_ref` from which the job derives)
- **Delivery placement:** Same P1-30 corrective Backend slice as D-3 — it is a constraint on D-3's key, not a separate build.
- **Dependencies:** D-3 (context definition OD-D-b), PROC-14.
- **Acceptance criteria:** 1. Item I issued to job J1 and then to job J2 on the same work order, each within its own demand → both 201, no authorisation. 2. Same item on two work orders of the same vehicle → both 201. 3. `requiredPartRef` naming a line of a DIFFERENT work order → refused (today: accepted, UNVERIFIED by test). 4. The part-issue list shows the job each issue belongs to.
- **Unverified:** Behaviour today for a `requiredPartRef` from another work order (no test found; the service passes it straight to the insert, inventory-stock-service.ts:437).

### OWR-2026-09-06-D-8 — Owner requirement · **Blocked**

> Enforce the rule on the server under concurrency.

- **Normalised behaviour:** The D-3/D-5 rule is evaluated inside the database transaction under a lock that serialises all issues and reservations for the same work order (and item cell), so two concurrent requests for the last authorised unit produce exactly one success, and no client-side check is relied upon.
- **Existing evidence:** The locks a demand rule can stand on already exist: every issue and every work-order-bound reservation takes the work order `FOR UPDATE OF w` (inventory-repository.ts:838-886 `lockWorkOrderState`, called from inventory-stock-service.ts:857-880 and :392) — the same row the closure path locks (work-order-service.ts:1523-1530) — and `inv.issue_part` itself locks it (20260723095000:685); the item cell is locked by `inv.lock_stock_balance` in `reserve_stock`/`consume_reservation`/`post_stock_movement` (20260723094000:257-300, 328, 378). Proven races: last-unit reservation with 10 concurrent sessions → one winner (tests/db/p1-21-inventory-integrity.test.ts:117-170); same-key concurrent first use → one execution (tests/backend/idempotency.test.ts:207-255); the gated two-connection doctrine for HTTP races is in tests/backend/p1-22-concurrency.test.ts:1-60 and p1-19-concurrency.test.ts. `openCommitmentsFor` runs after the lock so a concurrent issue cannot slip past closure (work-order-service.ts:1523-1545).
- **Remaining gap:** There is no demand rule to enforce (D-3), so nothing is enforced; no HTTP-level race test exists for two concurrent `/stock-issues` on one work order (grep for `Promise.all|concurren|race` in tests/backend/p1-21-_, p1-30-w4-_, p1-30-a2-* returns only a comment at p1-21-inventory-stock.test.ts:1081). The rule must be computed INSIDE the work-order lock (application service under `lockWorkOrderState`, or a DB guard) — a read-then-write outside it would be the race the lock exists to prevent (inventory-stock-service.ts:11-15).
- **Owning module:** api `inventory` (issue/reserve under `lockWorkOrderState`), schema `inv` guard/function; tests/db + tests/backend race suites
- **Delivery placement:** Same P1-30 corrective Backend slice as D-3; the race test is the slice's acceptance, following the gated two-connection pattern.
- **Dependencies:** D-3, D-5, D-7. Local machine timeout constraint for race suites (memory: per-case budgets).
- **Acceptance criteria:** 1. Two independent runtime connections each issue the last authorised unit of (W,J,I); the second parks on W's row lock and, after the first commits, is refused; exactly one `inv.part_issues` row. 2. Same for reserve-then-issue interleavings. 3. Removing the rule from the application layer does not make the DB accept the over-issue (the guard is the guarantee, as for `inv.guard_part_return_ceiling`, parts-and-procurement-flow.md:392-396).
- **Unverified:** Whether the DB-level guard is authorised for the slice (a migration is required; P1-30 Frontend may not add one — canonical-plan.md §2) or must be application-level under the lock as closure was (work-order-service.ts:1531-1536).

### OWR-2026-09-06-D-9 — Proposed implementation policy · **Undecided**

> (policy for D-1/D-2) — none; proposal

- **Normalised behaviour:** Give `inv.stock-issue-create` the same two-layer identity reservations have: an optional body `idempotencyKey` stored on `inv.part_issues` under a partial unique index `(tenant_id, idempotency_key) WHERE NOT NULL`, answered 200 + `replayed:true` on a same-key re-post and `ERR-INT-001` on a same-key different request; the web IssueForm holds one key per opened form and re-sends it on re-press.
- **Existing evidence:** Pattern already shipped for reservations: uq_stock_reservations_idempotency (20260723094000:212), `readReservationByIdempotencyKey` (inventory-repository.ts:1092-1104), replay view (inventory-stock-service.ts:189-206), form-held key (InventoryScreen.tsx:985-1024), tests p1-21-inventory-stock.test.ts:201-252 and p1-30-w4-inventory.test.ts:365.
- **Remaining gap:** Not built for issues (see D-1).
- **Owning module:** api `inventory`; schema `inv.part_issues` (one migration: column + partial unique index + immutability list); web `features/inventory`
- **Delivery placement:** P1-30 corrective: Backend half on `remediation/p1-30-backend-*` (migration), web half in a P1-30 W5 correction; the web half alone (stable header key per form) can land first without a migration.
- **Dependencies:** D-1, D-2; PENDING_MIRRORS/MIRROR_FILES and the web coverage ratchet traps (P1-30 W2 record).
- **Acceptance criteria:** Same as D-1 criteria 1 and 3, plus: body key + different quantity → 409.
- **Unverified:** Owner acceptance of the proposal.

### OWR-2026-09-06-D-10 — Proposed implementation policy · **Undecided**

> (policy for D-3/D-4/D-7) — none; proposal

- **Normalised behaviour:** Define the demand context as (work order, job, item) and the net position as authorised quantity − (Σ active reservations + Σ issued − Σ returned) for that context, where authorised quantity = Σ open `wo.required_parts.quantity` for the context (lines gain a cancellable state) plus, when the Owner so decides, the captured quantity on the accepted current quotation revision; compute it inside the work-order lock and refuse an overrun with a dedicated code unless a D-5 authorisation is cited; add `job_id` to `inv.part_issues` and an FK from `required_part_ref` to `wo.required_parts` (closes PROC-14).
- **Existing evidence:** Aggregation building blocks: countOpenCommitments (inventory-repository.ts:1884-1907), listPartIssuesForWorkOrder returned sum (:757-760); demand lines with job and item FKs (live catalog); revision lifecycle (20260723096000:111-118).
- **Remaining gap:** Entirely unbuilt; two Owner decisions (OD-D-a precedence, OD-D-b context unit) precede scoping.
- **Owning module:** api `inventory` + `work-order` (required-part cancel operation, job read port) + `quotation` (accepted-line read port); schema `inv.part_issues`, `wo.required_parts` (state column), new `inv` guard
- **Delivery placement:** P1-30 corrective Backend slice `remediation/p1-30-backend-duplicate-demand` (name illustrative), merged before P1-30 W9 acceptance; otherwise a named follow-on recorded at the Integration gate.
- **Dependencies:** OD-D-a, OD-D-b, D-5, PROC-14, PROC-21.
- **Acceptance criteria:** D-3 criteria 1-7 and D-7 criteria 1-4 as a backend suite, plus a two-connection race (D-8).
- **Unverified:** Whether the quotation module may expose a read port to inventory without violating the module allow-list (memory: module allow-list stays at 2 — use a port).

### OWR-2026-09-06-D-11 — Proposed implementation policy · **Undecided**

> (policy for D-5/D-6) — none; proposal

- **Normalised behaviour:** Record an over-issue authorisation as its own append-only row (approver ≠ issuer enforced by a CHECK, `reason NOT NULL` with `btrim(reason) <> ''`, quantity authorised, context, audit class `approval`), created by a new operation under a new high-risk inventory approval permission code that is added to the administrator bundle in the same migration; `inv.stock-issue-create` cites the authorisation id when exceeding demand; a value-based ceiling via `iam.approval_limits` with a parts `limit_type` is added only if the Owner asks for one and a cost source is published (PROC-11).
- **Existing evidence:** Shape precedents: `inv.stock_adjustments` maker≠approver + reason NOT NULL (20260723095000:156-197), `wo.customer_approvals` one-active-per-request unique (20260722100000:341-342), discount two-gate model (discount-authorization-service.ts:1-40), bundle at bootstrap-roles.ts:140-210.
- **Remaining gap:** Unbuilt; OD-D-c precedes it. `inv.adjustment.approve` is routeless and absent from the bundle, so reusing it would inherit the F-01 blind spot.
- **Owning module:** api `inventory` + `iam` seed + platform bootstrap bundle; schema new `inv` table, `iam.permissions`
- **Delivery placement:** Same slice as D-10; the bundle change needs the TB-R1 backfill decision for organisations created before the slice.
- **Dependencies:** OD-D-c, D-5, D-6, TB-R1, navigation-permission reachability (derive against navigation.ts).
- **Acceptance criteria:** D-5 criteria 1-4 and D-6 criteria 1-3; `verify:policies` and the permission-parity register updated in the same change.
- **Unverified:** Owner acceptance; permission code name is NOT proposed as final.

---

## Area E — Changing costs and prices

**Where this area stands today.** All paths below are relative to C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco (develop 6f6236c3). What exists: the schema keeps four money facts structurally distinct and immutable once issued — purchase cost (inv.external_purchase_part_details.unit_cost, restricted), an item standard cost (inv.item_cost_details.standard_cost, restricted, with NO production writer and NO reader), service sale prices under frozen published svc.price_list_versions, and captured quotation/invoice snapshots (quo.quotation_items.captured_*, sal.invoice_line_amounts) whose freeze guards are proven by tests/backend/p1-20-quotation.test.ts:651-676 (price republished after issue, issued figures unchanged); quantity lineage on returns is structural (inv.part_returns cites the issue, inv.return_part reads item/location off it, ceiling guard proven at tests/backend/p1-21-inventory-stock.test.ts:579-620). What is missing: there is NO approved valuation method anywhere (P1-10 put valuation out of scope at docs/phase-1/phase-1-10/phase-1-10-design.md:369, P1-11 built no GL, DEP-06 leaves cost values to the Inventory Owner, no FIFO/average/standard-cost decision exists in docs, apps or supabase); inv.stock_movements carries no cost column and inv.post_stock_movement has no cost parameter, so no movement, issue or return can carry a cost; there is no receipt movement (types are opening/issue/return/damage/adjustment — an external purchase posts no movement and opening lines are quantity-only), so "different-cost receipts" cannot be recorded; and inv.cost.view is unholdable in any provisioned tenant (omitted from the bootstrap bundle at apps/api/src/modules/iam/domain/bootstrap-roles.ts:188-207 while ins_role_permissions_delegable requires the acting administrator to hold a code), so even the one existing acquisition-cost write is refused for every principal. Where it lands: the inspection finding and the technical proposal (E-8/E-9, policies E-11…E-16) belong to the P1-30 corrective window as documentation and one bootstrap correction (E-14); every valuation-dependent build (E-1, E-2, E-4, E-6, E-7, E-10) is Blocked on the Owner's method decision and lands in a named follow-on Backend slice "inventory costing" (Backend lane, before the Integration gate only if the Owner elects valuation into Phase 1), because a P1-30 Frontend branch may not change apps/api (canonical-plan §5.5) and A0 named no such Backend prerequisite; the Owner-stated test (E-10) becomes an Integration-gate scenario once those land. Parts have no sale price at all today (svc.price_rules.service_id NOT NULL; every quotation line is itemKind 'service'), so "sale-price revisions" for parts also need an Owner pricing-model decision (E-16).

### OWR-2026-09-06-E-1 — Owner requirement · **Blocked**

> Retain each incoming quantity's acquisition-cost evidence

- **Normalised behaviour:** Every stock-increasing event (opening quantity, arrival of a purchased part, return) records the unit acquisition cost and ISO currency of that specific quantity, readable later only by a holder of inv.cost.view and never overwritten.
- **Existing evidence:** Partial, for external purchases only: inv.external_purchase_part_details.unit_cost numeric(18,4) + currency_code, restricted 1:1 (supabase/migrations/20260723095000_inv_operations.sql:545-571); written by inv.external-purchase-part-create POST /external-purchase-parts, permission inv.external_purchase.record, scope branch (apps/api/src/app/api/v1/external-purchase-parts/route.ts:83-90; write apps/api/src/modules/inventory/data/inventory-repository.ts:1468-1495); every RLS policy on the three restricted cost tables gates on inv.cost.view (tests/db/p1-10-security.test.ts:96-114); response carries costRecorded boolean, never the amount (tests/backend/p1-21-inventory-intake.test.ts:586-591); a caller without the code is refused 403/409 with full rollback rather than having the cost dropped (tests/backend/p1-21-inventory-intake.test.ts:624-641). inv.item_cost_details.standard_cost exists (supabase/migrations/20260723093000_inv_reference.sql:267-289) but has no production writer (only tests/db/p1-10-security.test.ts:123 inserts) and no reader.
- **Remaining gap:** (a) An external purchase posts NO stock movement — reference_kind admits only opening_line/part_issue/part_return/damage/adjustment (supabase/migrations/20260723094000_inv_ledger.sql:73; live ck_stock_movements_type = opening/issue/return/damage/adjustment), so the cost is attached to a reference row, not to an incoming quantity (route docblock apps/api/src/app/api/v1/external-purchase-parts/route.ts:14-19 says arrival becomes stock only via an opening batch or adjustment). (b) Opening lines are quantity-only by design (supabase/migrations/20260723095000_inv_operations.sql:107-133, COMMENT 'valuation is out of scope'). (c) No operation reads either cost table (PROC-11, docs/product/workshop/parts-and-procurement-flow.md:693; docs/product/workshop/end-to-end-workshop-workflow.md:673-677; apps/api/src/app/api/v1/items/route.ts:17-21). (d) In a tenant created by the shipped provisioning nobody can hold inv.cost.view: the bootstrap bundle omits it (apps/api/src/modules/iam/domain/bootstrap-roles.ts:188-207; deliberately excluded at docs/phase-1/phase-1-30/a0-read-surface-matrix.md:259-261) and ins_role_permissions_delegable admits a mapping only when the acting administrator already holds the code (supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql:299-312) — so the one existing cost write is refused for every principal (see E-14).
- **Owning module:** apps/api/src/modules/inventory (intake + stock services, inventory-repository); schema inv (stock_movements, opening_inventory_lines, external_purchase_parts/_details, a new cost-lot or movement-cost detail); iam bootstrap-roles for holdability
- **Delivery placement:** Blocked → named follow-on Backend slice 'inventory costing' after the E-9 decision (Backend lane; before the Integration gate only if the Owner elects valuation into Phase 1). Reason: needs new migrations (receipt movement/cost lot) which a P1-30 Frontend branch cannot carry (docs/phase-1/phase-1-30/canonical-plan.md §5.5) and which A0 named as no Backend prerequisite. The holdability half (E-14) fits the P1-30 §6.3 corrective window as a bootstrap correction.
- **Dependencies:** E-8/E-9 (valuation method decision), E-13 (receipt primitive; Owner decisions PROC-03 arrival vocabulary and PROC-18 procurement boundary), E-14 (who may hold inv.cost.view — PROC-11 'Owner confirms who may see cost'), E-15 (currency rule; OIR-04 open), F-02 (no item/location writer — a fresh tenant has no item to receive).
- **Acceptance criteria:** On a fresh tenant: record two inbound quantities of one item at two different unit costs; a holder of inv.cost.view reads back each quantity with its own cost and currency; a holder of inv.stock.read without inv.cost.view sees both quantities and no cost field (not zero, not null-as-value); a later change to the item's cost leaves both recorded costs unchanged; the write response never echoes an amount.

### OWR-2026-09-06-E-2 — Owner requirement · **Blocked**

> and the cost assigned to subsequent movements

- **Normalised behaviour:** Every outbound or transfer movement (issue, damage, adjustment) stores the cost assigned to the moved quantity under the approved valuation method, restricted to inv.cost.view, at the moment of posting.
- **Existing evidence:** None. inv.stock_movements has no cost or amount column (supabase/migrations/20260723094000_inv_ledger.sql:42-61; live columns: id,tenant_id,company_id,branch_id,item_id,location_id,movement_type,direction,quantity,signed_qty,reference_kind,reference_id,occurred_at,actor_id,correlation_id,notes,seq,created_at,created_by); inv.post_stock_movement(uuid,uuid,text,text,numeric,text,uuid,uuid,text) has no cost parameter (supabase/migrations/20260723094000_inv_ledger.sql:283-300); inv.part_issues carries no cost (supabase/migrations/20260723095000_inv_operations.sql:260-279); P1-21 filed quantity movements as audit class privileged, not financial, precisely because they carry no amount (docs/phase-1/phase-1-21/evidence/change-log.md:58-63). The only movement-adjacent money is inv.stock_adjustment_details.value_impact (supabase/migrations/20260723095000_inv_operations.sql:214-236), and no route writes adjustments (no inv._adjustment_ operation id on develop; PROC-10 at docs/product/workshop/parts-and-procurement-flow.md:695).
- **Remaining gap:** Everything: the cost assignment rule (E-9), the storage (E-12), and the posting inside inv.issue_part / inv.return_part / damage / adjustment so that every outbound movement carries its cost. No screen or read may show it without inv.cost.view.
- **Owning module:** apps/api/src/modules/inventory (inventory-stock-service, inventory-repository); schema inv (stock_movements + new restricted movement-cost detail; inv.issue_part, inv.return_part, inv.post_stock_movement)
- **Delivery placement:** Blocked → follow-on Backend slice 'inventory costing' (same slice as E-1). Reason: pure schema/function change behind the P1-30 Frontend boundary; cannot exist before the method decision.
- **Dependencies:** E-9 (method), E-12 (storage policy), E-1 (there must be a cost to assign), E-14.
- **Acceptance criteria:** After two costed receipts, issue a quantity that spans both; a holder of inv.cost.view reads the issue's assigned cost equal to the method's expected figure (per-lot allocations for FIFO, one average for weighted average); the movement ledger read (inv.stock-movement-list) shows no cost to a non-holder; the assigned cost is immutable after posting.

### OWR-2026-09-06-E-3 — Owner requirement · **Delivered**

> Keep purchase cost, inventory valuation, sale-price revisions, and quotation/invoice snapshots distinct.

- **Normalised behaviour:** Purchase cost, item cost, the sale price in force, the quotation snapshot and the invoice snapshot are separate records; changing any one never rewrites another.
- **Existing evidence:** Delivered for the services chain: purchase cost = inv.external_purchase_part_details (supabase/migrations/20260723095000_inv_operations.sql:545); item cost = inv.item_cost_details (supabase/migrations/20260723093000_inv_reference.sql:267); sale price = svc.price_rules.amount under svc.price_list_versions frozen once published (svc.guard_price_list_version_freeze supabase/migrations/20260723092000_svc_pricing.sql:40-61; rules frozen by svc.guard_price_rule_parent_frozen :63-77; table :123-160); quotation snapshot = quo.quotation_items.captured_unit_price/captured_quantity/captured_discount/captured_tax_rate/captured_tax_amount/captured_line_total plus price_rule_ref (supabase/migrations/20260723096000_quo_quotations.sql:172-215), CHECK-enforced arithmetic; invoice snapshot = sal.invoice_line_amounts.unit_price/net_amount/tax_amount/gross_amount (supabase/migrations/20260724091000_sal_invoices.sql:324-352) copied from the quotation item at invoice creation (apps/api/src/modules/billing/application/invoice-service.ts:563-585) with source_quotation_item_id on sal.invoice_lines (:235-248). Proof: tests/backend/p1-20-quotation.test.ts:651-676.
- **Remaining gap:** Two: (1) inventory valuation is not a record at all (see E-4); (2) for PARTS there is no sale price to keep distinct — svc.price_rules.service_id is NOT NULL (supabase/migrations/20260723092000_svc_pricing.sql:195-210), every quotation line is built with itemKind 'service' (apps/api/src/modules/quotation/application/quotation-service.ts:1154-1158), and invoice lines derive from quotation items, so no part price or part snapshot exists (see E-16). Also inv.item_cost_details.standard_cost is updatable in place under inv.cost.view (supabase/migrations/20260723093000_inv_reference.sql:304-307) with no history table (live inv schema has none) — see E-6.
- **Owning module:** schema svc / quo / sal / inv; apps/api/src/modules/{pricing,quotation,billing,inventory}
- **Delivery placement:** Delivered (services chain) on develop by P1-10/P1-11 schema and P1-20/P1-22 backend, re-verified by the cited tests; the parts half is tracked in E-16 and the valuation half in E-4.
- **Dependencies:** E-4 (valuation), E-16 (parts pricing model).
- **Acceptance criteria:** Record a purchase cost, set an item cost, publish a price, issue a quotation, issue an invoice; then republish the price and change the item cost: the purchase cost row, the issued quotation's captured_* columns and the invoice line amounts are byte-identical before and after (SQL assertion, as in p1-20-quotation.test.ts:665-676).

### OWR-2026-09-06-E-4 — Owner requirement · **Blocked**

> inventory valuation (kept distinct)

- **Normalised behaviour:** The inventory valuation of a (item, location) cell as at a date is a figure derived from cost-bearing movements, separate from purchase cost and sale price, readable only with inv.cost.view.
- **Existing evidence:** None. No valuation column, table, view or function exists (live catalog: no app-schema function matching _cost_ or _valu_; inv tables: customer_supplied_parts, damaged_stock, external_purchase_part_details, external_purchase_parts, item_categories, item_cost_details, item_master, opening_inventory_batches, opening_inventory_lines, part_issues, part_returns, stock_adjustment_details, stock_adjustments, stock_balances, stock_locations, stock_movements, stock_reservations, units_of_measure). P1-10 put valuation out of scope (docs/phase-1/phase-1-10/phase-1-10-design.md:369; docs/phase-1/phase-1-10/phase-1-10-opening-inventory-contract.md:21); P1-11 built no general ledger and no inventory valuation (docs/phase-1/phase-1-11/phase-1-11-no-general-ledger-boundary.md:10); the financial-event vocabulary has no inventory event (supabase/migrations/20260724093000_sal_financial_events.sql:45-49). inv.stock_balances holds quantities only (supabase/migrations/20260723094000_inv_ledger.sql:103-125). Web inventory contract states no read publishes a cost, price or valuation (apps/web/src/features/inventory/inventory-contract.ts:40-44; InventoryScreen note apps/web/src/i18n/messages/en.json:2805).
- **Remaining gap:** Everything, and it cannot be built before the E-9 decision: a valuation is the method applied to the movement costs of E-2.
- **Owning module:** apps/api/src/modules/inventory (a new restricted valuation read); schema inv; consumers in P1-31 reporting
- **Delivery placement:** Blocked → follow-on Backend slice 'inventory costing'; any valuation REPORT is P1-31 (Reporting) scope and consumes it. Reason: no method exists and the Owner asked for a proposal before any valuation-dependent posting (E-9).
- **Dependencies:** E-9, E-2, E-15 (single-currency rule — costs in different currencies are never summed, docs/product/workshop/parts-and-procurement-flow.md:258).
- **Acceptance criteria:** Given costed receipts and a partial issue, a holder of inv.cost.view reads a valuation for the cell equal to the method's expected figure (server-computed, decimal string + currency); a non-holder is refused the valuation read; an identical read as at an earlier date returns the earlier figure after a later cost change.

### OWR-2026-09-06-E-5 — Owner requirement · **Delivered**

> Later price changes must preserve historical documents

- **Normalised behaviour:** Publishing a new price-list version or changing any price after a quotation revision or an invoice is issued leaves that document's captured lines and totals unchanged.
- **Existing evidence:** Delivered: quo.guard_quotation_revision_freeze refuses any change to captured totals once a revision leaves draft (supabase/migrations/20260723096000_quo_quotations.sql:143-166); quo.guard_quotation_item refuses INSERT/UPDATE of items under a non-draft revision (:226-248); quo.guard_revision_totals re-reconciles an issued revision's totals with its items at COMMIT (:265-295); sal.guard_invoice_line_frozen and sal.guard_invoice_line_amount_frozen freeze lines and amounts once the invoice is not draft (supabase/migrations/20260724091000_sal_invoices.sql:276-300, 366-390); published price-list versions and their rules are frozen (supabase/migrations/20260723092000_svc_pricing.sql:40-77) and non-overlapping (ex_price_list_versions_no_published_overlap :150-152). Proof: 'leaves an ISSUED revision unchanged when the price list is republished' tests/backend/p1-20-quotation.test.ts:651-676 (unit 100.0000 / total 110.0000 unchanged after republish); recorded at docs/product/workshop/pricing-payment-and-delivery.md:369-372 and :483-484.
- **Remaining gap:** None for issued documents. Note (by design, not a gap): a DRAFT revision's totals are database zeros until issue and are priced at issue with the server's date (docs/product/workshop/pricing-payment-and-delivery.md:354-366); a print of a draft must say so (P1-30 W3 record).
- **Owning module:** schema quo / sal / svc; apps/api/src/modules/{quotation,billing,pricing}
- **Delivery placement:** Delivered on develop (P1-10/P1-11 schema; P1-20 backend tests; P1-30 W2/W3/W6 screens render the captured figures only). No further placement.
- **Dependencies:** None.
- **Acceptance criteria:** Issue a revision, republish the price list at a different amount, re-read the revision and its invoice: every captured_* and invoice_line_amounts value is unchanged (tests/backend/p1-20-quotation.test.ts:651-676 already asserts this at the SQL level).

### OWR-2026-09-06-E-6 — Owner requirement · **Blocked**

> ...and valuations. (Later price changes must preserve historical valuations)

- **Normalised behaviour:** A later change to an item's cost, a purchase cost or a price never alters the cost already assigned to a past movement nor the valuation as at a past date; cost changes are recorded as new dated facts, not overwrites.
- **Existing evidence:** None. No valuation exists (E-4). inv.item_cost_details.standard_cost is updatable in place: UPDATE policy and GRANT UPDATE under inv.cost.view (supabase/migrations/20260723093000_inv_reference.sql:304-307), only record_version/updated_at are touched (tg_item_cost_details_touch_metadata :292-293), the immutable guard protects identity columns only (:294-295), and no cost-history table exists — so a later cost edit would overwrite the only cost fact. inv.external_purchase_part_details' immutable guard likewise covers identity columns only (supabase/migrations/20260723095000_inv_operations.sql:568-571), leaving unit_cost mutable in principle.
- **Remaining gap:** Cost must become append-only dated facts (effective-from rows or per-receipt lots) and past movement costs must be immutable once posted; a valuation as at a date must be reproducible from the ledger.
- **Owning module:** schema inv (item_cost_details history or lots; movement-cost detail immutability); apps/api/src/modules/inventory
- **Delivery placement:** Blocked → follow-on Backend slice 'inventory costing'. Reason: depends on E-9's method and E-2's storage; a Frontend branch cannot add the guards.
- **Dependencies:** E-9, E-2, E-12.
- **Acceptance criteria:** Post a costed issue; then change the item cost; re-read the issue's assigned cost — unchanged; a valuation read as at the issue date returns the pre-change figure; an UPDATE of a posted movement cost is refused by the database (check_violation), proven by a db-tier test.
- **Unverified:** Whether an UPDATE RLS policy exists on inv.external_purchase_part_details (only its immutable-column guard was read); whether any hosted run ledger records a cost-mutation test — none was found by grep.

### OWR-2026-09-06-E-7 — Owner requirement · **Blocked**

> Returns must retain their source cost lineage.

- **Normalised behaviour:** A part return is posted at the cost assigned to the issue it reverses (and the receipt lot behind that issue), never at a current or average cost, and the issue→return→lot chain is readable.
- **Existing evidence:** Quantity lineage delivered: inv.part_returns.part_issue_id is a composite FK to inv.part_issues (supabase/migrations/20260723095000_inv_operations.sql:311-331); inv.return_part row-locks the issue, reads item_id/location_id off it and posts the 'return' in-movement citing the return row (:697-716); inv.guard_part_return_ceiling enforces Σreturns ≤ issued at the constraint layer (:344-366); the request body cannot name a different work order, item or location (tests/backend/p1-21-inventory-stock.test.ts:631-641); partial return 3 of 5, over-return refused 409, exact remainder 2 accepted (tests/backend/p1-21-inventory-stock.test.ts:579-620); returnedQty published per issue by inv.work-order-part-issue-list GET /work-orders/{workOrderId}/part-issues (apps/api/src/app/api/v1/work-orders/[workOrderId]/part-issues/route.ts:49-55; tests/backend/p1-30-a2-inventory-reads.test.ts:551-590). Register row 'Part return' (P1-30, partly blocked INT-067) covers the operation.
- **Remaining gap:** The issue carries no cost (E-2), so the return has no cost to inherit. When E-2 lands, inv.return_part must copy the issue's cost assignment (re-opening the same lots under a lot method) and the return's cost must be readable with inv.cost.view. Existing register row 'Part return' stays for the operation; this row is the cost half.
- **Owning module:** schema inv (inv.return_part, movement-cost detail); apps/api/src/modules/inventory
- **Delivery placement:** Blocked → follow-on Backend slice 'inventory costing'. Reason: cost lineage is impossible until issues carry cost.
- **Dependencies:** E-2, E-9, E-12; existing register row 'Part return' (P1-30).
- **Acceptance criteria:** Two receipts at different costs; issue spanning both; change the item cost; return part of the issue: the return's assigned cost equals the cost of the specific issued units it reverses (per lot under FIFO), not the new item cost and not a recomputed average; on-hand valuation after the return equals the pre-issue valuation of the returned units.

### OWR-2026-09-06-E-8 — Owner requirement · **Planned**

> Inspect the existing approved valuation method and document its scope;

- **Normalised behaviour:** The register states whether an approved inventory valuation method exists and, if so, which tables, movement types and currencies it covers.
- **Existing evidence:** Inspection performed 2026-09-06 at develop 6f6236c3. Finding: NO approved valuation method exists. grep over docs/, apps/, supabase/ for FIFO, LIFO, weighted average, average cost, cost layer, valuation method returns no decision; every hit says valuation is OUT of scope: docs/phase-1/phase-1-10/phase-1-10-design.md:369, docs/phase-1/phase-1-10/phase-1-10-inventory-data-dictionary.md:158, docs/phase-1/phase-1-10/phase-1-10-opening-inventory-contract.md:21, docs/phase-1/phase-1-10/phase-1-10-customer-supplied-part-contract.md:33, docs/phase-1/phase-1-21/evidence/change-log.md:60-62. P1-10 open decisions: DEP-06 leaves 'cost values' to the Inventory Owner as configuration (docs/phase-1/phase-1-10/phase-1-10-open-decisions.md:26); P1-OD-022 covers only adjustment thresholds (:14). P1-11: no general ledger (docs/phase-1/phase-1-11/phase-1-11-no-general-ledger-boundary.md:10). The only costing construct schema'd is a standard cost (inv.item_cost_details.standard_cost, classified restricted at docs/phase-1/phase-1-10/phase-1-10-classification-matrix.md:12) — never approved as a method, never written, never read.
- **Remaining gap:** Record this finding in the register (this row) and in the P1-30 corrective record so no later phase assumes a method exists; the method itself is E-9.
- **Owning module:** docs/product/owner-workflow-requirements.md; docs/phase-1/phase-1-30 corrective record
- **Delivery placement:** P1-30 corrective (documentation only, no code). Reason: it is an inspection whose output is this register entry; it lands when this entry merges.
- **Dependencies:** None.
- **Acceptance criteria:** The register carries this row with the finding 'absent' and the citations above; a reviewer can reproduce the grep and find no method decision.

### OWR-2026-09-06-E-9 — Owner requirement · **Undecided**

> if absent, make a concrete technical proposal for the authorized decision maker before introducing valuation-dependent postings.

- **Normalised behaviour:** No valuation-dependent posting (cost on movements, a valuation figure, an inventory financial event) is merged until the authorized decision maker has approved a written technical proposal; the proposal is E-11 through E-16.
- **Existing evidence:** Consistent with the codebase today: nothing valuation-dependent exists (E-2, E-4). The proposal is the six proposed-policy rows below; no rate, default, threshold or provider is proposed in any of them.
- **Remaining gap:** The decision itself: choose the method (E-11), confirm the storage rule (E-12), decide the receipt primitive and the procurement boundary (E-13), decide who holds inv.cost.view (E-14), decide the currency rule (E-15), decide the parts pricing model (E-16).
- **Owning module:** Owner decision register (a new P1-OD number is the register owner's to assign — docs/phase-1/phase-1-27/open-decisions.md:1167 records that P1-OD-042 is the highest treated as existing and P1-OD-043 is already referenced); then apps/api/src/modules/inventory and schema inv
- **Delivery placement:** Undecided → the proposal paper lands in the P1-30 corrective window as documentation; the build lands in the follow-on Backend slice 'inventory costing' only after the decision. Reason: the Owner explicitly ordered the proposal before any posting.
- **Dependencies:** E-8 (finding: absent).
- **Acceptance criteria:** A decision record exists naming the chosen method, storage, receipt path, cost-holder role, currency rule and parts pricing model; until it exists, no migration adds a cost column to inv.stock_movements or any valuation function (gate: a grep over supabase/migrations for a cost/valuation column on inv.stock_movements stays empty).

### OWR-2026-09-06-E-10 — Owner requirement · **Blocked**

> Test different-cost receipts followed by partial issue, a subsequent price change, and partial return.

- **Normalised behaviour:** An automated backend test records two inbound quantities of one item at different unit costs, issues part of them to a work order, changes the sale price and the item cost afterwards, returns part of the issue, and asserts the issue cost, the return cost, the cell valuation and the issued documents each equal their expected values.
- **Existing evidence:** Pieces exist separately: partial issue + partial return + exact ceiling (tests/backend/p1-21-inventory-stock.test.ts:579-620); price change after issue leaves the issued revision unchanged (tests/backend/p1-20-quotation.test.ts:651-676); returnedQty read per issue (tests/backend/p1-30-a2-inventory-reads.test.ts:551-590). Costed receipts: none — no receipt movement type exists (live ck_stock_movements_type = opening/issue/return/damage/adjustment), opening lines carry no cost, an external purchase posts no movement.
- **Remaining gap:** The scenario cannot be written until E-1/E-2/E-7/E-13 exist. When written it must use a tenant prefix matching no suite's delete-by-prefix (backend suites delete tenants by prefix on the shared local DB — memory rule), run in the backend tier and be recorded in the run ledger.
- **Owning module:** tests/backend (new costing suite); apps/api/src/modules/inventory
- **Delivery placement:** Blocked → written in the follow-on Backend slice 'inventory costing' and repeated as an Integration-gate scenario (the gate proves the end-to-end journey). Reason: it is the acceptance proof of E-1/E-2/E-7 and cannot precede them.
- **Dependencies:** E-1, E-2, E-7, E-11, E-13, E-14 (the test principal must hold inv.cost.view).
- **Acceptance criteria:** The test passes with: receipt A (qty a, cost cA) and receipt B (qty b, cost cB ≠ cA); issue of qty i where a < i < a+b; price republish and item-cost change; return of qty r < i; assertions that the issue cost equals the method's allocation, the return cost equals the reversed units' cost, valuation equals Σ remaining units × their costs, and the quotation/invoice figures are unchanged; all money as decimal strings with currency; a control principal without inv.cost.view sees quantities only.

### OWR-2026-09-06-E-11 — Proposed implementation policy · **Undecided**

> — (proposed implementation policy; no Owner wording)

- **Normalised behaviour:** Proposal to the decision maker — three candidate methods, one recommendation, no decision taken here: (A) per-receipt cost LOTS with FIFO consumption: each inbound movement creates one restricted lot (quantity, unit cost, currency, source movement); each outbound movement consumes lots oldest-first and records per-lot allocations; a return re-opens exactly the lots its issue consumed. (B) moving WEIGHTED AVERAGE per (item, location) cell: one restricted running average recomputed on each inbound movement; outbound movements carry the average at posting; returns carry the issue's average. (C) STANDARD cost: the existing inv.item_cost_details.standard_cost applied to every movement with a receipt variance. Recommendation: (A), because the Owner's stated requirements 'retain each incoming quantity's evidence' and 'returns retain source cost lineage' are satisfied by lots by construction and are destroyed by averaging; and because the ledger is already append-only with single-use provenance per source (uq_stock_movements_source, supabase/migrations/20260723094000_inv_ledger.sql:75) which lots extend rather than fight. The choice is the decision maker's.
- **Existing evidence:** Ledger shape that the proposal builds on: inv.stock_movements immutable append-only with signed_qty and seq (supabase/migrations/20260723094000_inv_ledger.sql:42-79); inv.guard_stock_movement_provenance binds every movement to a source row (supabase/migrations/20260723095000_inv_operations.sql:577+); restricted 1:1 detail pattern (P1-10 §20, docs/phase-1/phase-1-10/phase-1-10-design.md:409-416).
- **Remaining gap:** The decision (E-9). Under (A) a new inv.stock_cost_lots (restricted) and inv.stock_movement_cost_allocations (restricted) with a deferred identity guard Σallocations = movement quantity; under (B) a restricted running-average column on a new detail of inv.stock_balances; under (C) a variance detail per receipt.
- **Owning module:** schema inv; apps/api/src/modules/inventory
- **Delivery placement:** Undecided → proposal in the P1-30 corrective window; build in the follow-on Backend slice 'inventory costing'.
- **Dependencies:** E-9, E-12, E-15.
- **Acceptance criteria:** The decision record names one of A/B/C (or another) and the E-10 test's expected figures are derived from it.

### OWR-2026-09-06-E-12 — Proposed implementation policy · **Planned**

> — (proposed implementation policy; no Owner wording)

- **Normalised behaviour:** Movement and lot costs live only in restricted detail tables whose every RLS policy gates on iam.has_permission('inv.cost.view'); inv.stock_movements itself never gains a cost column; no list or detail read publishes a cost without the gate; write responses never echo an amount (a boolean such as costRecorded only); money is a decimal string with an ISO-4217 currency and is never summed across currencies.
- **Existing evidence:** The pattern already in force: three restricted cost tables gated on inv.cost.view (tests/db/p1-10-security.test.ts:96-114; P1-10 §20 docs/phase-1/phase-1-10/phase-1-10-design.md:409-416); external-purchase route never echoes the cost (apps/api/src/app/api/v1/external-purchase-parts/route.ts:22-27; tests/backend/p1-21-inventory-intake.test.ts:586-591); money/quantity string rule (docs/product/workshop/parts-and-procurement-flow.md:244-262); P1-30 frontend contract: cost fields render only with inv.cost.view (docs/phase-1/phase-1-10/p1-30-frontend-contract.md:30-34); no P1-30 screen computes money (docs/phase-1/phase-1-30/canonical-plan.md:86-88).
- **Remaining gap:** Apply the pattern to the new tables; extend tests/db/p1-10-security.test.ts's gated list; the audit action for a cost-bearing movement becomes class financial (consistent with docs/phase-1/phase-1-21/evidence/change-log.md:62-63).
- **Owning module:** schema inv; apps/api/src/modules/inventory; tests/db
- **Delivery placement:** Planned → follow-on Backend slice 'inventory costing' (depends on E-11). Reason: it is the storage rule for whatever method is chosen.
- **Dependencies:** E-11, E-14.
- **Acceptance criteria:** pg_policy shows every policy on each new cost table contains has_permission('inv.cost.view'); a principal without the code reading any inventory list receives no cost key; the db-tier test denies a raw INSERT into a cost table without the code (as tests/db/p1-10-security.test.ts:116-129 does today).

### OWR-2026-09-06-E-13 — Proposed implementation policy · **Undecided**

> — (proposed implementation policy; no Owner wording)

- **Normalised behaviour:** Introduce a costed inbound primitive so that 'different-cost receipts' can exist: add movement_type 'receipt' with reference_kind 'external_purchase_part', posted by an explicit arrival operation under dual control (the second-person rule the opening batch and adjustment already use), carrying the purchase's restricted unit cost as the lot cost; and allow an optional restricted unit cost on opening lines. Keep ck_external_purchase_parts_not_procurement (is_procurement = false) — this is arrival of an ad-hoc purchase, not a purchase order or goods-receipt workflow.
- **Existing evidence:** Today's inbound paths are opening batches (quantity-only, approved via inv.opening-batch-approve under inv.adjustment.approve, apps/api/src/app/api/v1/opening-inventory-batches/[batchId]/approval/route.ts:37-43) and returns; the external-purchase route states a purchase never raises stock directly because that would be an unapproved path to minting stock (apps/api/src/app/api/v1/external-purchase-parts/route.ts:14-19); status vocabulary is recorded/linked/cancelled with no 'received' and no update route (PROC-03, docs/product/workshop/parts-and-procurement-flow.md:685); procurement domain explicitly absent (PROC-18, :700).
- **Remaining gap:** Owner decisions PROC-03 (arrival vocabulary) and PROC-18 (whether procurement is in scope at all) come first; then a migration widening ck_stock_movements_type / ck_stock_movements_reference_kind / the provenance guard, an arrival operation, and the lot creation.
- **Owning module:** schema inv (stock_movements CHECKs, guard_stock_movement_provenance, external_purchase_parts status, opening_inventory_lines); apps/api/src/modules/inventory
- **Delivery placement:** Undecided → follow-on Backend slice 'inventory costing' after the PROC-03/PROC-18 decisions.
- **Dependencies:** PROC-03, PROC-18, E-11, E-14, F-02 (an item must exist to receive).
- **Acceptance criteria:** An arrival recorded for an external purchase posts exactly one 'receipt' in-movement citing the purchase, raises on_hand by its quantity, creates one restricted lot at the purchase's unit cost, and is refused without the second-person approval; a raw INSERT of a 'receipt' movement without a matching purchase is refused by the provenance guard.

### OWR-2026-09-06-E-14 — Proposed implementation policy · **Undecided**

> — (proposed implementation policy; no Owner wording)

- **Normalised behaviour:** Make inv.cost.view holdable: the Owner names who may see and record cost (PROC-11), and the administrator held-for-delegation bundle includes the code so an administrator can delegate it to that persona; organisations provisioned before the change need a backfill decision.
- **Existing evidence:** The code is seeded (supabase/seeds/04_iam_permission_catalog.sql:48, risk high) and enforced by RLS, but is absent from the bootstrap bundle (apps/api/src/modules/iam/domain/bootstrap-roles.ts:188-207 lists 17 commercial codes without it) — deliberately, per docs/phase-1/phase-1-30/a0-read-surface-matrix.md:259-261; ins_role_permissions_delegable admits a mapping only when the acting administrator already holds the code (supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql:299-312); the bundle is written once at provisioning and earlier organisations keep their set (bootstrap-roles.ts:109-111). Consequence proven by the existing suite shape: without the code the external-purchase cost write is refused (tests/backend/p1-21-inventory-intake.test.ts:624-641) — in a provisioned tenant that is every principal. PROC-11 already asks 'Owner confirms who may see cost' (docs/product/workshop/parts-and-procurement-flow.md:693).
- **Remaining gap:** Owner decision on the cost persona; one bootstrap-roles change (same shape as the 2026-09-06 commercial-block correction); a backfill decision for existing organisations; a parity check that the code is now reachable.
- **Owning module:** apps/api/src/modules/iam (bootstrap-roles, tenant-bootstrap-service); docs/phase-1/phase-1-30 corrective record
- **Delivery placement:** Undecided → P1-30 corrective (§6.3 window) once the Owner names the holder. Reason: it is a bootstrap correction of the F-01 kind, needs no migration, and unblocks the one cost write that already exists.
- **Dependencies:** Owner decision (PROC-11); backfill decision for pre-existing organisations.
- **Acceptance criteria:** On a freshly provisioned tenant an administrator can create a role holding inv.cost.view and grant it; that principal records an external-purchase unit cost (201, costRecorded true); a principal without the code still receives 403 with full rollback; the navigation/permission-parity gates stay green.

### OWR-2026-09-06-E-15 — Proposed implementation policy · **Undecided**

> — (proposed implementation policy; no Owner wording)

- **Normalised behaviour:** Valued stock is costed in exactly one currency per company: a receipt cost whose currency differs from the company's base_currency_code is refused for valued stock (stored as evidence on the purchase, never as a lot cost) until an exchange-rate decision exists; a valuation is therefore always a single-currency figure and costs are never summed across currencies.
- **Existing evidence:** Costs in different currencies are stored as given and never summed (docs/product/workshop/parts-and-procurement-flow.md:258-262); there is no exchange-rate table and no conversion path (docs/product/workshop/pricing-payment-and-delivery.md:295, :1109); a legal company states its own base_currency_code (:293); OIR-04, the approved production currency subset, is OPEN (:297); the cost columns carry a required currency_code FK to shared.currencies (supabase/migrations/20260723095000_inv_operations.sql:552-565).
- **Remaining gap:** An Owner decision on the rule (and on OIR-04); a CHECK or guard on lot creation.
- **Owning module:** schema inv (lot/cost detail guard); org.companies.base_currency_code; apps/api/src/modules/inventory
- **Delivery placement:** Undecided → follow-on Backend slice 'inventory costing'; the currency subset itself is OIR-04 (Owner).
- **Dependencies:** OIR-04, E-11, E-13.
- **Acceptance criteria:** A receipt whose cost currency equals the company base currency creates a lot; one in another currency is refused with a named error and no lot; a valuation read returns one amount and one currency.

### OWR-2026-09-06-E-16 — Proposed implementation policy · **Undecided**

> — (proposed implementation policy; no Owner wording)

- **Normalised behaviour:** Give parts a sale price that revises the way service prices do: extend the price-list/version/rule model so a rule targets exactly one of a service or an item (published versions immutable, rules frozen, quotation items of item_kind 'part' capturing price_rule_ref and captured_unit_price the same way), so that 'sale-price revisions' of parts preserve history by the same guards as services. Whether parts are priced from a price list or from cost plus a markup is the Owner's pricing-model decision; no markup or figure is proposed.
- **Existing evidence:** No part price exists: svc.price_rules.service_id is NOT NULL (supabase/migrations/20260723092000_svc_pricing.sql:195-210) and no item target column exists; the quotation service builds every line with itemKind 'service' and itemRef null (apps/api/src/modules/quotation/application/quotation-service.ts:1154-1158) although quo.quotation_items admits item_kind 'part' with item_ref (supabase/migrations/20260723096000_quo_quotations.sql:172-215); invoice lines derive from quotation items (apps/api/src/modules/billing/application/invoice-service.ts:563-585) so no part ever reaches an invoice; live inv schema has no column matching _price_.
- **Remaining gap:** Owner decision on the parts pricing model; then a migration (rule target), quotation part lines, and the W2/W3 screens' part rows.
- **Owning module:** schema svc / quo; apps/api/src/modules/{pricing,quotation}; apps/web features/pricing and features/quotations
- **Delivery placement:** Undecided → after the Owner decision, a Backend slice on the pricing/quotation lane, then a P1-30 Frontend wave; if the decision comes after P1-30 closes it is an explicit follow-on. Reason: no contract exists for a part price, and a Frontend phase may not invent one.
- **Dependencies:** Owner pricing-model decision; E-3 (distinctness must hold for parts too); existing register rows 'Work pricing' and 'Quotation' (P1-30).
- **Acceptance criteria:** A published price-list version prices an item; a quotation line of item_kind 'part' captures that unit price and price_rule_ref; republishing the item price after issue leaves the issued line unchanged (same assertion shape as tests/backend/p1-20-quotation.test.ts:651-676).

---

## Area F — Vehicle and service knowledge (oil specification)

**Where this area stands today.** Nothing in the repository knows anything about oil or fluid specifications: no table, column, operation, seed or screen mentions viscosity, capacity or lubricant, and the only 'oil' and 'fluid' tokens are the reception leak vocabulary and the inventory item type. The vehicle side gives a configuration read (make/model/trim/body/powertrain names, model year, powertrain category via veh.vehicle-read) but the catalogue is empty by policy with read-only routes and no provenance, the engine attributes in veh.engine_history have no route and zero rows, and veh.vin_verifications — the only 'verified' vocabulary — is unwritten by any code, so a 'verified vehicle configuration' cannot be asserted today. Manual quantity entry already exists generically (required-part lines with quantity + free-text unit, quotation lines with quantity and no unit, stock issues) but carries no manual/source marking, and the approval machinery (additional-work request/approval, per-line quotation decisions, pricing approval policies with iam.approval_limits) is never triggered by a quantity overrun. The area therefore lands as a named follow-on under the register's Cross-phase vehicle-catalogue row (Status Undecided), gated by the Owner's commercial data-source decision (provider-evaluation proposes P1-OD-043, unassigned), the VCAT-09 placement decision (catalogue entry vs vehicle), and a business-rule decision naming which approval policy governs extra consumption; it does not belong to the closed P1-30 corrective slice, to P1-31, or to the Integration gate, whose job is to prove the journey rather than add capability. Two pieces can start before any vendor is chosen: publishing the engine variant read and building the provider port plus curated-data writer with provenance, following the storage-provider precedent.

### OWR-2026-09-06-F-1 — Owner requirement · **Undecided**

> Propose oil specification and quantity from a verified vehicle configuration and service context

- **Normalised behaviour:** When an operator adds an oil-change service to a work order or quotation for a vehicle whose configuration is verified, the platform proposes the oil specification (grade/standard) and the fill quantity with a unit, and the operator confirms or overrides it before any line is written.
- **Existing evidence:** None for oil or fluid specification: grep of supabase/migrations and apps/api/src for oil|fluid|viscosity|lubric hits only the reception leak vocabulary ('oil' in supabase/migrations/20260721102000_rec_warning_lights_leaks.sql:171) and the inventory item type 'fluid' (supabase/migrations/20260723093000_inv_reference.sql:239); the live catalog (information_schema.columns) has no column matching oil|fluid|viscos — the only _capacity_ columns are veh.battery_masters.nominal_capacity_kwh and veh.vehicle_ev_profiles.usable_capacity_kwh. The vehicle configuration read exists: veh.vehicle-read (apps/api/src/app/api/v1/vehicles/[vehicleId]/route.ts:62) projects makeName/modelName/trimName/bodyTypeName/powertrainTypeName/modelYear/powertrainCategory (apps/api/src/modules/vehicle/data/vehicle-read-repository.ts:48-58, 127-147). Nothing marks that configuration as VERIFIED: veh.vin_verifications (check_kind checksum/format/manual/external, result passed/failed/overridden) has no route and 0 live rows (docs/product/vehicle-catalogue/manual-entry-policy.md:392-424, MVE-03 at :497). The service context is name-only: svc.services carries service_code/name/description (supabase/migrations/20260723091000_svc_catalog.sql:195-221), svc.service_versions carries notes only (:248-274), and svc.service-create's strict CreateBody accepts serviceCategoryId/serviceCode/name/description (apps/api/src/app/api/v1/services/route.ts:130-137, op at :142). No screen under apps/web/src/features/services, vehicles or quotations renders a specification.
- **Remaining gap:** Everything: a fluid-specification record (schema), a resolver from vehicle configuration + service to a specification, a route, a permission, and a screen affordance in the quotation builder / required-parts entry. Also the 'verified' precondition (a verification read/write on veh.vin_verifications or an equivalent marking) does not exist.
- **Owning module:** api modules/vehicle (veh schema: catalogue + a new specification relation) for the knowledge; modules/service-catalog (svc) for the service-context binding; consumers are modules/quotation (quo.quotation_items) and modules/work-order (wo.required_parts).
- **Delivery placement:** Named follow-on: 'Vehicle knowledge — fluid specification', under the register's Cross-phase vehicle-catalogue row. Not P1-30 corrective (that slice is the tenant-bootstrap repair and is closed; P1-30 canonical plan §2 forbids a P1-30 branch changing apps/api or schema), not P1-31 (Delivery/Warranty/Reporting), not the Integration gate (it proves the journey, adds no capability). Backend lane first (schema + vehicle module + port), Frontend consumption after.
- **Dependencies:** Owner decision on the data source (register Cross-phase row Status: Undecided, docs/product/owner-workflow-requirements.md:315-342; provider-evaluation.md:486 proposes P1-OD-043, unassigned); Owner decision whether specification belongs to the catalogue entry or to the vehicle (VCAT-09, catalogue-architecture.md:980); OWR-2026-09-06-F-2 (inputs reachable); OWR-2026-09-06-F-3 (authority rule); VDP-01 catalogue writer + permission code; P1-OD-025 only if verification evidence is photographic.
- **Acceptance criteria:** On a vehicle with make, model, model year, engine variant and powertrain resolved and marked verified, adding the oil-change service shows a proposed specification and quantity-with-unit sourced from a named record; the proposal is not written to any line until the operator confirms; on a vehicle with any of those inputs missing, no proposal is shown and the manual path (F-manual) is offered; an automated test asserts that no proposal is produced from make/model labels alone.
- **Unverified:** No API was executed; hosted environments (none exist per memory) were not checked for catalogue rows; the canonical DOCX open-decision register is outside the repo, so whether a P1-OD number is already reserved for vehicle data is unverified.

### OWR-2026-09-06-F-2 — Owner requirement · **Blocked**

> including model year, engine variant, units, and filter/service condition

- **Normalised behaviour:** The proposal is computed from, and displays, the vehicle's model year and engine variant, the quantity unit, and the service condition (e.g. with or without filter change) — each of which must be a stored, readable value, not inferred.
- **Existing evidence:** Model year: veh.vehicles.model_year (supabase/migrations/20260720092000_veh_vehicles.sql:61, ck_vehicles_model_year :100), accepted on create/update (apps/api/src/app/api/v1/vehicles/route.ts:104; vehicles/[vehicleId]/route.ts:54) and published (vehicle-read-repository.ts:57) — Delivered by P1-27 (register rows 18/19). Engine variant: veh.engine_history holds displacement_cc, power_kw numeric(7,2), fuel_note per vehicle (supabase/migrations/20260720096000_veh_engine_transmission_history.sql:74-100), 0 live rows, NO route in apps/api or apps/web (VCAT-09 catalogue-architecture.md:980; VHM-20 vehicle-history-model.md:1002); only tests/db/veh-mechanical.test.ts, veh-isolation.test.ts, veh-concurrency.test.ts touch it. veh.trims exists (20260720091000_veh_reference_catalogs.sql:260-288) but a trim is not an engine variant, and it has 0 rows. Units: inv.units_of_measure seeds litre and millilitre at platform scope (supabase/seeds/07_inv_units_of_measure.sql:20-21; 12 live rows, dimension 'volume'); wo.required_parts.unit is free text and quo.quotation_items has NO unit column (live columns). Filter/service condition: dia.template_items supports response_type numeric/text/boolean/select with unit (supabase/migrations/20260722101000_dia_templates_versions_items.sql:152-179) and dia.measurements stores label/measured_value/unit — usable for a condition prompt, but nothing links a template item to a service or to a fluid proposal.
- **Remaining gap:** An engine-variant read (and a writer) — per vehicle or per catalogue entry; a typed 'service condition' input on the service context (with/without filter etc.); a unit bound to inv.units_of_measure on the proposal and on the consuming line (quotation items carry none).
- **Owning module:** modules/vehicle + veh (engine variant read/write); modules/service-catalog + svc (service condition); modules/inventory + inv.units_of_measure (unit); modules/quotation + quo (unit on a line).
- **Delivery placement:** Same follow-on as F-1, Backend lane; the engine-variant read is the first deliverable and is independent of the provider decision (it publishes an existing table).
- **Dependencies:** VCAT-09 decision (catalogue-level vs per-vehicle specification); P1-17 owns any veh.engine_history route; the quotation-line unit change touches the frozen quo contract (P1-20).
- **Acceptance criteria:** A vehicle detail exposes engine variant fields as decimal strings (power_kw never as a float); a service can declare the condition inputs it needs; a proposal displays quantity + a unit code that exists in inv.units_of_measure; a quotation or required-part line created from a proposal records the same unit.
- **Unverified:** Whether the Owner intends 'engine variant' to mean engine code, displacement/power, or a catalogue trim — not stated; treated as the veh.engine_history attributes plus a catalogue-level variant.

### Cross-phase — the vehicle catalogue (provider integration clause: server-side, licensed, cached, source-attributed, provider-abstracted; Status Undecided) — Owner requirement · **Undecided**

> Use a sourced, versioned catalogue or authorized curated data.

- **Normalised behaviour:** Every proposed specification and quantity comes from a record that carries a named source and a version (a licensed provider release or an Owner-authorised curated dataset), loaded server-side through a provider port and reviewable; no proposal comes from an unversioned or unattributed row.
- **Existing evidence:** The five veh catalogue relations are dual-scope with zero seed rows by policy (supabase/migrations/20260720091000_veh_reference_catalogs.sql:239, :291; live counts makes/models/trims/body_types/powertrain_types = 0). Five read-only list operations exist: veh.catalogue-make-list (apps/api/src/app/api/v1/vehicle-catalogue/makes/route.ts:31), -model-list (makes/[makeId]/models/route.ts:30), -trim-list (models/[modelId]/trims/route.ts:26), -powertrain-type-list (:26), -body-type-list (:26). No write operation and no catalogue-management permission code (VDP-01 provider-evaluation.md:572; platform-scope rows cannot be created via the app role, VDP-02 :573). No provenance columns on any catalogue row (VCAT-07 catalogue-architecture.md:978; the required columns are listed at §5.2 :639-663). No vehicle-data provider port (VDP-07 :578) — the only ports are apps/api/src/modules/shared-services/provider/storage-provider.ts, message-provider.ts and modules/iam/provider/identity-provider.ts. Register row Status: Undecided (owner-workflow-requirements.md:340); e2e §8.2 records paid data providers as a commercial decision (end-to-end-workshop-workflow.md:1183-1195).
- **Remaining gap:** The Owner decision itself; provenance + version + approval-state columns; a VehicleCatalogProvider port with a getVehicleSpecification capability extended to fluids (catalogue-architecture.md:577 lists it as planned, nothing exists); a curated-data writer under a new catalogue-management permission; staging/approval per catalogue-architecture §5.
- **Owning module:** modules/vehicle + veh (catalogue provenance, specification relation, port); modules/iam seed for the permission code.
- **Delivery placement:** Named follow-on gated on the Owner's commercial decision; the port and the curated-data writer can be built before a vendor is chosen (provider-evaluation.md §11 'no vendor decision blocks the Frontend', :514-548).
- **Dependencies:** Owner commercial decision (proposed P1-OD-043); P1-OD-017 for catalogue merge rules; VDP-01/VDP-02 writer and permission; VCAT-07 provenance migration (Vehicle Database phase, not established).
- **Acceptance criteria:** Every specification row read back carries source id, source version and last-synchronised time; a row without them cannot be proposed; the browser never calls a third-party API (CSP/network evidence); a curated row is created only by a holder of the catalogue-management code and is visible in the audit log.
- **Unverified:** Whether any licensed source publishes fluid capacities for the pilot market was not evaluated here (provider-evaluation.md compares only identity data).

### Cross-phase — the vehicle catalogue (Manual fallback is mandatory) — Owner requirement · **Planned**

> Preserve manual entry when coverage is unavailable.

- **Normalised behaviour:** When no specification match exists for the vehicle, the operator can enter the oil specification and quantity by hand; the entry is recorded as manual with the person and time, and it never creates a catalogue or specification record as a side effect.
- **Existing evidence:** Generic manual quantity entry exists today: wo.required-part-record accepts description, decimal-string quantity, free-text unit and optional itemRef (apps/api/src/app/api/v1/work-orders/[workOrderId]/required-parts/route.ts:41-47, op :52; wo.required_parts.quantity numeric, unit text); quo.quotation-create lines accept serviceId + quantity + description (apps/api/src/app/api/v1/quotations/route.ts:47-61, op :80; quo.quotation_items.captured_quantity numeric(12,3), no unit); inv.stock-issue-create takes a decimal-string quantity (stock-issues/route.ts:52-54, op :59). What is absent is the manual MARKING: no source-of-entry column on veh.vehicles or on any line (MVE-01 manual-entry-policy.md:495), although six tables already carry a source column (crm.consent_history, crm.partner_roles, shared.error_records, tech.labor_sessions, veh.battery_readings, veh.plate_history — live catalog). The hard rule that manual entry never creates a catalogue record is stated at manual-entry-policy.md:326-352 (§4.4) and the register row at owner-workflow-requirements.md:329.
- **Remaining gap:** A source marking (manual vs catalogue vs provider) on the specification carried by the line, with entered-by/entered-at readable; a 'no coverage' state that opens the manual path rather than a blank; the five markings of manual-entry-policy §5 (:376-392) applied to fluid entries.
- **Owning module:** modules/work-order (wo.required_parts), modules/quotation (quo.quotation_items) for the marking on the consuming line; modules/vehicle for the vehicle-level marking.
- **Delivery placement:** The generic quantity entry is already on P1-29 (required parts) and P1-30 (quotation builder) surfaces; the manual MARKING is Backend work in the same follow-on, following the tech.labor_sessions.source precedent (manual-entry-policy.md §5.2 :424-447).
- **Dependencies:** OWR-2026-09-06-F-1 (defines when coverage is 'unavailable'); MVE-01; P1-OD-025 only if the manual entry must carry a photograph of the fill-plate or manual.
- **Acceptance criteria:** With an empty catalogue (the shipped state), an operator can still add an oil line with a typed quantity and unit; the stored line reads back as source = manual with actor and time; no row appears in any veh catalogue or specification table as a result; the label 'Manual' is never shown before the marking exists.
- **Unverified:** Whether the P1-30 W3 quotation builder exposes a free-text unit for a service line was not re-rendered here (quo.quotation_items has no unit column, so it cannot persist one).

### OWR-2026-09-06-F-3 — Owner requirement · **Planned**

> A make/model label or a model-generated guess is insufficient authority for fluid quantities.

- **Normalised behaviour:** The platform never derives a fluid quantity from make/model names alone, nor from any generated or heuristic estimate; a quantity is proposed only from a sourced record matched on the verified configuration, or entered manually and marked as such.
- **Existing evidence:** Nothing violates this today because nothing proposes a quantity. The closest stated rules: catalogue-architecture §4.3 'decodeVin returns a proposal, never a decision' and 'Missing data is absent, not blank or zero' (docs/product/vehicle-catalogue/catalogue-architecture.md:585-598); MVE-12 'Do not warn from a client-side guess' (manual-entry-policy.md:506); the P1-30 closure rule that screens render server arithmetic only (docs/phase-1/phase-1-30/canonical-plan.md §3). The standing no-fake-data policy forbids shipping a lookup table of guessed capacities.
- **Remaining gap:** A recorded rule in the specification design and a negative test; a gate (in the spirit of the server-arithmetic gate) that refuses any client-side or heuristic quantity derivation in apps/web.
- **Owning module:** modules/vehicle (resolver) and the repository gate scripts under scripts/.
- **Delivery placement:** Same follow-on as F-1; the rule is written into the design before any resolver exists.
- **Dependencies:** OWR-2026-09-06-F-1; OWR-2026-09-06-F-2.
- **Acceptance criteria:** A test creates a vehicle with make/model set but no engine variant or model year and asserts the proposal endpoint returns 'no coverage' (absent), not a quantity; a source-scan gate refuses any quantity literal or estimation function in apps/web for fluid lines; the UI shows 'no source' rather than a number.
- **Unverified:** None.

### OWR-2026-09-06-F-4 — Owner requirement · **Blocked**

> Present the source

- **Normalised behaviour:** Wherever a proposed specification or quantity is shown, the screen names its source (provider or curated dataset), its version, and when it was last confirmed, in workshop language and in both locales.
- **Existing evidence:** None on screen. No provenance columns exist (VCAT-07 catalogue-architecture.md:978); the on-screen provenance requirement is specified as planned at §3.5 (:480-495); the services web contract exposes only id/serviceCode/name/description/categoryId/lifecycleStatus/recordVersion (apps/web/src/features/services/services-contract.ts:112-118); vehicle detail exposes catalogue names only (apps/web/src/features/vehicles/contract.ts:94, 217-221).
- **Remaining gap:** Provenance on the specification record, projected by the read, rendered by the line and by the print document; a locale-safe label vocabulary (shared.localization_keys is not linked to veh, VCAT-10).
- **Owning module:** modules/vehicle + veh (columns and projection); apps/web features/quotations and features/work-orders (rendering).
- **Delivery placement:** Follow-on with F-1; the Frontend half lands in whichever Frontend phase consumes the proposal (post-P1-30, since P1-30 W3 quotations is closed).
- **Dependencies:** Cross-phase vehicle-catalogue provider clause (provenance columns); OWR-2026-09-06-F-1.
- **Acceptance criteria:** A proposed line shows 'Source: <name>, version <v>, confirmed <date>' and a manual line shows 'Entered by <person> on <date>'; a DOM test renders both; a printed quotation carries the same text; no UUID or raw enum appears.
- **Unverified:** None.

### OWR-2026-09-06-F-5 — Owner requirement · **Blocked**

> handle conflicting matches

- **Normalised behaviour:** When more than one specification record matches the vehicle's configuration, or the matched record disagrees with the vehicle's stored attributes, the platform presents the candidates with their sources and requires the operator to choose (or fall back to manual) rather than picking one silently.
- **Existing evidence:** None. catalogue-architecture §5.5 (conflict report, :715-733) and §5.6 (duplicate detection, :734-757) are planned for catalogue synchronisation only; VCAT-12 records that no staging area, conflict report or catalogue-level duplicate detection exists (:983). veh.duplicate_candidates / veh.vehicle_merges concern two records of one physical vehicle and are unrelated. veh.vin_verifications' 'overridden' result with a mandatory override_reason (live check ck_vin_verifications_override_reason) is the only existing shape for a recorded human choice over data.
- **Remaining gap:** A resolver that returns candidates rather than one answer; a recorded choice (actor, reason, chosen candidate) on the consuming line; a mismatch signal when the vehicle's stored model year or engine variant lies outside the record's range.
- **Owning module:** modules/vehicle (resolver, choice record); modules/quotation / work-order (line references the chosen candidate).
- **Delivery placement:** Follow-on with F-1; the choice record follows the vin_verifications append-only pattern.
- **Dependencies:** OWR-2026-09-06-F-1; OWR-2026-09-06-F-2; P1-OD-017 where a conflict implies two catalogue entries are the same.
- **Acceptance criteria:** Seed two curated records matching one configuration in a test tenant; the proposal returns both with sources and no default; confirming one writes a choice row with actor and reason; a vehicle whose model year is outside the record's range shows a mismatch notice, not a quantity.
- **Unverified:** None.

### OWR-2026-09-06-F-6 — Owner requirement · **Undecided**

> extra consumption follows the approval policy.

- **Normalised behaviour:** Consuming more oil than the quantity the customer approved (or than the proposed quantity, where no approval exists) cannot be recorded as ordinary issue; it is routed through the tenant's approval policy before the extra is billed or issued.
- **Existing evidence:** Approval mechanisms exist but none is triggered by a quantity overrun. Customer-facing: wo.additional-work-request (apps/api/src/app/api/v1/work-orders/[workOrderId]/additional-work/route.ts:57, wo.additional_work.request) and wo.additional-work-approval (additional-work/[requestId]/approval/route.ts:122, wo.additional_work.approve); per-line quotation decisions quo.quotation-item-decide (quotation-items/[quotationItemId]/decisions/route.ts:72, quo.decision.record). Internal thresholds: svc.pricing_approval_policies policy_type in discount/quotation_total/price_override (supabase/migrations/20260723092000_svc_pricing.sql ck_pricing_approval_policies_type; apps/api/src/modules/pricing/domain/pricing.ts:26-30) combined with iam.approval_limits monetary ceilings (supabase/migrations/20260718093000_iam_approval_and_sensitive_data.sql:46-89) in discount-authorization-service.ts:9-19; iam.approval-limit-create accepts any lower-snake limitType (iam/approval-limits/route.ts:41). Inventory guards only reservation and return: an issue may not exceed its reservation (apps/api/src/modules/inventory/application/inventory-stock-service.ts:411-421) and returns may not exceed the issued quantity (supabase/migrations/20260723095000_inv_operations.sql:353-370). No code compares an issued or consumed quantity against a quoted/approved quantity. Register rows already carrying the approval half: P1-30 'Additional-work approval — Blocked (INT-015)', 'Customer approval — Partly blocked (INT-061)'; P1-29 'Additional-work request — Contracted'.
- **Remaining gap:** The Owner has not said which policy 'the approval policy' is (customer approval via additional work, an internal threshold via svc.pricing_approval_policies/iam.approval_limits, or both); the comparison between issued/consumed quantity and the approved line quantity; a refusal or routing when the overrun is not approved.
- **Owning module:** modules/inventory (inv.part_issues vs approved quantity), modules/work-order (additional work), modules/pricing (policy/threshold), modules/quotation (approved quantity source).
- **Delivery placement:** Undecided until the Owner names the policy; then Backend work in the same follow-on, with the customer-approval half riding the existing P1-30 'Additional-work approval' and 'Customer approval' rows and its journey proof at the Integration gate.
- **Dependencies:** Owner business-rule decision on which approval applies and whether a tolerance exists (no numeric tolerance may be invented); INT-015 (party-role id for additional-work approval); OWR-2026-09-06-F-1 (the proposed quantity as baseline).
- **Acceptance criteria:** Issue a quantity above the approved line quantity in a test: the issue is refused or an additional-work request is created (per the decided policy) and nothing is billed until approval; an issue within the approved quantity proceeds unchanged; the audit log shows the approval before the extra issue.
- **Unverified:** Whether the Owner also wants a tolerance below which extra consumption needs no approval — not stated, not assumed.

### OWR-2026-09-06-F-7 — Proposed implementation policy · **Undecided**

> (proposed implementation policy for F-1/F-2/Cross-phase provider clause)

- **Normalised behaviour:** A fluid specification is a catalogue-level, versioned record keyed on the resolved configuration (make, model, model-year range, engine variant, powertrain category) with the §5.2 provenance columns; a vehicle references the accepted match, and any per-vehicle deviation is an append-only override with actor and reason, never an edit of the catalogue row.
- **Existing evidence:** Pattern precedents: veh.engine_history is per-vehicle and temporal (20260720096000:74-100); veh.vin_verifications is append-only with a mandatory override reason; catalogue-architecture §5.2 provenance columns (:639-663) and §4.2 getVehicleSpecification (:577).
- **Remaining gap:** Owner acceptance of the catalogue-level placement (VCAT-09 asks exactly this question).
- **Owning module:** modules/vehicle + veh.
- **Delivery placement:** Design input to the follow-on; decide before the first migration.
- **Dependencies:** VCAT-09 decision; VCAT-07 provenance.
- **Acceptance criteria:** Migration review shows one specification relation with provenance and approval state, one per-vehicle override relation that is append-only, and no free-text spec on svc.services.
- **Unverified:** None.

### OWR-2026-09-06-F-8 — Proposed implementation policy · **Planned**

> (proposed implementation policy for F-1/F-3)

- **Normalised behaviour:** The proposal is advisory and server-computed: the API returns candidates or 'no coverage', the screen never derives a quantity, and for powertrain_category = 'ev' the proposal is 'not applicable' rather than absent, so an EV never receives an engine-oil line by default.
- **Existing evidence:** veh.vehicles.powertrain_category with ck_vehicles_powertrain_category (20260720092000_veh_vehicles.sql:64, :94) and the P1-30 server-arithmetic gate (canonical-plan.md §3).
- **Remaining gap:** The resolver and the EV rule.
- **Owning module:** modules/vehicle; apps/web consumers.
- **Delivery placement:** Follow-on with F-1.
- **Dependencies:** OWR-2026-09-06-F-1.
- **Acceptance criteria:** An EV vehicle shows 'not applicable' for engine oil; a hybrid/PHEV/ICE vehicle proceeds to the resolver; a gate refuses client-side quantity math.
- **Unverified:** None.

### OWR-2026-09-06-F-9 — Proposed implementation policy · **Planned**

> (proposed implementation policy for F-2 units)

- **Normalised behaviour:** Fluid quantities are decimal strings bound to a unit from inv.units_of_measure (litre/millilitre exist at platform scope); the consuming quotation line gains a unit reference instead of free text, and the required-part line's free-text unit is validated against the same table.
- **Existing evidence:** supabase/seeds/07_inv_units_of_measure.sql:20-21; wo.required_parts.unit text; quo.quotation_items has no unit column (live catalog); inv.item_master.uom_id references units_of_measure (20260723093000_inv_reference.sql).
- **Remaining gap:** Unit column on quotation items; validation on required-part unit.
- **Owning module:** modules/quotation + quo; modules/work-order + wo; modules/inventory + inv.
- **Delivery placement:** Follow-on with F-2; touches P1-20/P1-19 contracts under change control.
- **Dependencies:** OWR-2026-09-06-F-2.
- **Acceptance criteria:** A quotation line for a fluid reads back with a unit code that exists in inv.units_of_measure; a required-part line with an unknown unit is refused 422.
- **Unverified:** None.

### OWR-2026-09-06-F-10 — Proposed implementation policy · **Undecided**

> (proposed implementation policy for F-6)

- **Normalised behaviour:** Extra consumption is defined as issued quantity for a fluid line exceeding the customer-approved line quantity; the excess is refused at inv.stock-issue-create unless an approved additional-work request (or, where the Owner so decides, an internal approval under svc.pricing_approval_policies / iam.approval_limits) covers it — no silent line-quantity change.
- **Existing evidence:** The issue-vs-reservation guard (inventory-stock-service.ts:411-421) is the structural twin; additional-work approval and pricing approval policies exist as cited on F-6.
- **Remaining gap:** The Owner's choice of policy and the comparison itself.
- **Owning module:** modules/inventory; modules/work-order; modules/pricing.
- **Delivery placement:** After the F-6 Owner decision, same follow-on.
- **Dependencies:** OWR-2026-09-06-F-6; INT-015.
- **Acceptance criteria:** As F-6, with the specific mechanism named in the test.
- **Unverified:** None.

---

## Area G — RootLco owner administration (platform CRM and subscriptions)

**Where this area stands today.** The register today has no Area G rows at all (grep of docs/product/owner-workflow-requirements.md for platform/subscription/seat/delegation finds nothing), so every id here is new. What exists is a proven control plane with exactly three operations — platform.organization-read/-provision/-lifecycle — a single out-of-band platform operator (genesis CLI, 3 active grants on the live stack), a First-Owner bootstrap that gives a fresh tenant an isolated administrator, payment methods and number sequences in one transaction, and tenant-side IAM whose delegation, scope-containment and one-identity-one-tenant rules are delivered and tested. What is missing is the whole platform-owner product: no console page in apps/web, no platform CRM (contacts, leads, activities, follow-ups), no plan or subscription writer (0 plans, 0 subscriptions, org.subscription.manage inert, entitlement gates nothing, capacity_limits read by nothing), no renewals, no company/branch create operation anywhere, no employee master (every 'employee' column is a FK to iam.user_accounts), no seat concept in any code path, no post-provisioning platform authority into a tenant (so no delegated-administrator repair, no support access, no backfill of the six pre-slice organizations), no tenant-status enforcement at session, and no cross-organization audit read. Onboarding therefore creates an isolated organization that is usable for the P1-29 journey and for a receipt but not for the commercial chain until F-02's eleven master-data writers exist. Placement: the seat/state definition, plan catalogue, support-access model and backfill are Owner decisions (Undecided); F-02 and the bootstrap residuals are P1-30 corrective territory because they gate the fresh-organization acceptance; tenant-status enforcement and the dual-trail audit rule are small Backend slices; everything else is a named follow-on — the Platform Owner Console after the Integration gate, Backend lane first, with no price, quota or provider invented here.

### OWR-2026-09-06-G-1 — Owner requirement · **Contracted**

> Provide dedicated platform-owner pages

- **Normalised behaviour:** A signed-in platform operator (holder of a platform.* grant) reaches a dedicated web surface, separate from the tenant dashboard, from which every Area G capability is driven; a tenant principal cannot reach it.
- **Existing evidence:** No platform-owner page exists in apps/web: apps/web/src/config/navigation.ts:451-620 (Administration group) lists only tenant screens; apps/web/src/features/ and apps/web/src/app/[locale]/(dashboard)/ hold no platform feature or route (directory listing 2026-09-06); the only web mention of the three platform operations is the operation-registry mirror apps/web/src/lib/api/idempotent-operations.ts:1411-1430, which is metadata, not a screen. The web session carries exactly one tenantId (apps/web/src/features/authentication/types/session.ts:22) and no platform authority. Backend contracts a console could consume: platform.organization-read / -provision / -lifecycle (apps/api/src/app/api/v1/platform/organizations/route.ts:141-169; .../[tenantId]/status/route.ts:62-74), proven by tests/backend/pre-p1-29-platform-control-plane.test.ts:325-690.
- **Remaining gap:** Whole UI; a web session/authorization branch that recognises platform authority (apps/api/src/server/auth/authorization.ts routes platform.* codes to iam.has_platform_authority for API calls, but the web navigation/permission model has no platform branch); operations for every capability beyond the organization trio.
- **Owning module:** web: new platform route group (none today); api: `platform` module (apps/api/src/modules/platform); schema: org, iam
- **Delivery placement:** Named follow-on: Platform Owner Console, after the Integration gate (register phase map ends at the Integration gate; no P1-27..P1-31 scope field names a platform UI). Backend prerequisites travel on the Backend lane first, as P1-29/P1-30 did.
- **Dependencies:** G-2..G-12 contracts; Owner decision on the console's scope for the pilot (gap-register.md:196-199 GAP-24 asks whether subscription management belongs in the pilot at all); Wave D global identity (wave-b-control-plane-design-v2.md:297-310) if one identity must hold both a tenant account and platform authority.
- **Acceptance criteria:** A platform operator provisioned by scripts/platform/genesis-platform-operator.mjs signs in and sees the organization list from platform.organization-read; a tenant_administrator of any tenant is refused the same page (403/not rendered); PC-1 proved on a real response for each console screen.

### OWR-2026-09-06-G-2 — Owner requirement · **Contracted**

> CRM for subscribing organizations

- **Normalised behaviour:** Each subscribing organization is a platform-side record (tenant root plus commercial attributes) that the platform owner can list, open, create and transition, without entering the tenant.
- **Existing evidence:** org.tenants (supabase/migrations/20260717101000_org_tenants.sql:87-117, status provisioning|active|suspended|closed) with append-only org.tenant_status_history (:135-163) and graph guard org.change_tenant_status (:172-221). Control plane: GET/POST /platform/organizations and POST /platform/organizations/{tenantId}/status (route files above); repository reads the tenant root only (apps/api/src/modules/platform/data/platform-repository.ts:64-96) under sel_tenants_platform (20260831093000_iam_platform_privilege_graph.sql:90-97). Live stack 2026-09-06: 9 tenants, all active, one being platform_operators (psql).
- **Remaining gap:** Read returns only id, code, display name, status, locale, timezone, created_at — no commercial attributes (contact, plan, renewal date, owner account); no update of a tenant's display fields from the platform (app_platform holds UPDATE (status) only, :101); no list filters/paging beyond limit; no UI.
- **Owning module:** api `platform` (organization-service.ts, platform-repository.ts); schema org (org.tenants) plus a platform-side commercial record to be designed
- **Delivery placement:** Named follow-on: Platform Owner Console (Backend lane first). The three existing operations are the seed; widening the read is a Backend change under the platform module.
- **Dependencies:** G-1; G-6 for plan attributes; decision on which organization attributes are platform-owned vs tenant-owned (org.tenants.display_name is tenant-editable via iam.tenant-settings-update, apps/api/src/app/api/v1/org/tenant/route.ts:49-54).
- **Acceptance criteria:** platform.organization-read returns every tenant to a platform.organization.read holder and nothing to a tenant principal (R1-R4 already prove this); a console screen renders that list and opens one organization with its status history.

### OWR-2026-09-06-G-3 — Owner requirement · **Planned**

> contacts

- **Normalised behaviour:** A subscribing organization carries platform-side contact persons (name, role, channels) visible to the platform owner and never to other tenants.
- **Existing evidence:** none — no platform contact table exists; the only contact tables are tenant workshop CRM (crm.contact_points, psql catalog 2026-09-06). The First Owner's email/display name are held only as an iam.user_accounts row inside the tenant (tenant-bootstrap-service.ts) — not as a platform contact.
- **Remaining gap:** Table, operations, permission code, UI — all absent.
- **Owning module:** api `platform`; schema: a platform-side schema/table with no tenant_id (proposed, see G-26)
- **Delivery placement:** Named follow-on: Platform Owner Console.
- **Dependencies:** G-1, G-2, G-13 (distinctness rule), G-26 placement decision.
- **Acceptance criteria:** A platform operator adds a contact to organization X; the row is invisible to every tenant session (RLS negative) and visible on the organization page.

### OWR-2026-09-06-G-4 — Owner requirement · **Undecided**

> lead/opportunity stages

- **Normalised behaviour:** A prospective organization moves through an Owner-approved, ordered set of lead/opportunity stages before (or without) becoming a provisioned tenant, with the transition history kept.
- **Existing evidence:** none — org.tenants exists only from provisioning onward (provisioning is the first state, 20260717101000:117); no pre-tenant prospect record, no stage vocabulary, no seed.
- **Remaining gap:** Stage vocabulary (an Owner commercial decision — the no-fake-data policy forbids inventing one), prospect record, transition graph, operations, UI.
- **Owning module:** api `platform`; schema: platform-side (proposed)
- **Delivery placement:** Named follow-on: Platform Owner Console; vocabulary is an Owner decision before any slice is scoped.
- **Dependencies:** Owner-approved stage vocabulary; G-2 (a won opportunity becomes a provisioned organization via platform.organization-provision).
- **Acceptance criteria:** Stages render from a declared seed, never hard-coded; a prospect's stage history is append-only and attributed; converting a won prospect calls the existing provisioning operation.

### OWR-2026-09-06-G-5 — Owner requirement · **Planned**

> activities and follow-ups

- **Normalised behaviour:** Platform staff record dated activities against an organization or prospect and schedule follow-ups that surface as due.
- **Existing evidence:** none on the platform side. (Tenant-side analogues exist only for workshop customers: crm.timeline_events, register 'Cross-phase — the three histories'.)
- **Remaining gap:** Everything; a due-follow-up surface also needs a notification path, and shared notifications today are tenant-scoped (end-to-end-workshop-workflow.md WF-28).
- **Owning module:** api `platform`; schema: platform-side (proposed)
- **Delivery placement:** Named follow-on: Platform Owner Console.
- **Dependencies:** G-2/G-3/G-4; decision whether follow-ups need notifications or only an in-console list.
- **Acceptance criteria:** An activity is stored with server-stamped actor and time; a follow-up with a due date appears in a due list for platform staff and nowhere in any tenant.

### OWR-2026-09-06-G-6 — Owner requirement · **Undecided**

> subscription/entitlement lifecycle

- **Normalised behaviour:** The platform owner defines plans (entitlements and capacities), assigns a plan to an organization for an effective interval, changes or ends it, and the runtime resolves the effective entitlement per request.
- **Existing evidence:** Schema exists and is proven at the database tier: org.feature_flags, org.subscription_plans (entitlement_document + capacity_limits jsonb, trigger-validated), org.tenant_subscriptions (non-overlapping active intervals), org.current_subscription_plan_id (20260717102000_org_subscriptions.sql:66-262; policies :281-296; SELECT-only grants :305-307); org.resolve_feature_enabled and org.tenant_feature_overrides (20260717105000_org_settings_tax_features.sql:262-307); entitlement middleware apps/api/src/server/auth/entitlement.ts:1-60 wired at route-handler.ts:389 behind an optional operation.featureFlag (operation-registry.ts:69). tests/db/org-subscriptions.test.ts:80-317. Provisioning writes one tenant_subscriptions row from spec.subscription (20260717107000_org_provisioning.sql:145-168; ProvisionBody admits plan_code/status/effective_from, platform route :121-128).
- **Remaining gap:** No plan writer in the product — org.subscription_plans is inserted only by the out-of-band script scripts/db/provision-organization.mjs:120-125 (gated to local-pilot/production-pilot, :13,:76-79); no assignment change/end operation; org.subscription.manage is seeded (04_iam_permission_catalog.sql:25) and referenced by zero operations (gap-register.md:107 GAP-16, :115 GAP-24; end-to-end-workshop-workflow.md:1108-1112); no operation declares featureFlag (grep of apps/api/src/app/api/v1: none), so entitlement gates nothing; capacity_limits is read by no function or code (psql pg_proc scan: only validate_plan_documents, current_subscription_plan_id, provision_organization touch these tables); live stack holds 0 plans and 0 subscriptions; feature_overrides cannot be passed through the shipped route (ProvisionBody is .strict() without that member, while the function reads p_spec->'feature_overrides' at :223-236).
- **Owning module:** api `platform` (new subscription service) + `org` schema; entitlement enforcement in apps/api/src/server/auth/entitlement.ts
- **Delivery placement:** Named follow-on: Platform Owner Console (Backend lane). GAP-24 records that whether it belongs in the pilot is an Owner commercial decision (gap-register.md:196-199).
- **Dependencies:** Owner decision on plan catalogue content (no price, no quota invented); G-16/G-21 for capacity semantics; G-28 for what a suspended/expired subscription does to sessions.
- **Acceptance criteria:** A platform operator creates an active plan version and assigns it to an organization; org.current_subscription_plan_id resolves it inside that tenant and NULL in another; ending the assignment writes a new row, never an UPDATE of tenant_id/plan_id (tg_tenant_subscriptions_immutable); an operation declaring featureFlag is refused when the plan disables it.

### OWR-2026-09-06-G-7 — Owner requirement · **Contracted**

> onboarding

- **Normalised behaviour:** One platform action creates a new organization with its first company, branch, administrator, payment methods and document numbering in a single transaction, or nothing.
- **Existing evidence:** platform.organization-provision (platform/organizations/route.ts:155-169, body :80-134) -> OrganizationService.provision (organization-service.ts:107-215): org.provision_organization, then withPlatformTarget (apps/api/src/server/db/transaction.ts:234-275) runs the First-Owner bootstrap (bootstrap-roles.ts:137-243), canonical payment methods (20260906090000_sal_payment_method_tenant_bootstrap.sql), number sequences, and a genesis audit record, optional activation after the administrator exists. Proofs: W9-B1..B12 (tests/backend/p1-29-w9-owner-bootstrap.test.ts:301-677), PM-B1..B9, NS-B1/B2, F01-B1 (tests/backend/p1-30-tenant-bootstrap-reachability.test.ts:384-631), P1-P5 (control-plane test :495-559). Record: docs/phase-1/phase-1-30/tenant-bootstrap-corrective-slice.md.
- **Remaining gap:** No UI (today onboarding is a curl/CLI act by whoever holds platform.organization.provision); the commercial chain on the new tenant is not usable (F-02, slice §4); organizations created before the slice lack methods/sequences/17 codes (TB-R1/TB-R2, slice §5 — backfill needs an Owner decision); eight navigation gates unheld by the administrator bundle (TB-R3; a0-read-surface-matrix.md:313-340); subscription member of the body is optional and unvalidated against a real plan catalogue (0 plans exist).
- **Owning module:** api `platform` + `iam` (tenant-bootstrap-service.ts) + `payments` + `shared-services`; schema org, iam, sal, shared
- **Delivery placement:** P1-30 corrective for the usability residuals that block the P1-30/P1-31 fresh-organization acceptance (F-02 writers, TB-R1..R3 decisions); the onboarding UI itself belongs to the Platform Owner Console follow-on.
- **Dependencies:** F-02 Owner decision (which Backend lanes P1-20/P1-21/P1-22 write the eleven master-data tables); TB-R1/TB-R2 backfill decision; G-15.
- **Acceptance criteria:** On a production build a fresh organization provisioned through the route lets its First Owner log in (W9-L), create a cashier role holding sal.payment.record (F01-B1), record a receipt (PM-B4), and — once F-02 closes — publish a service, price it, quote and invoice it; a failure at any step leaves no tenant row (W9-B6/B7, PM-B8).

### OWR-2026-09-06-G-8 — Owner requirement · **Undecided**

> renewals

- **Normalised behaviour:** An organization's subscription interval can be extended or replaced before it ends, the upcoming expiry is visible to the platform owner, and expiry has a defined runtime consequence.
- **Existing evidence:** org.tenant_subscriptions carries effective_to and status draft|active|cancelled|expired with an EXCLUDE on overlapping active intervals (20260717102000:206-232) — the data shape a renewal needs. No operation, function, job or screen renews, expires or lists expiring assignments (grep apps/api/src: zero references to tenant_subscriptions outside the provisioning call).
- **Remaining gap:** Renewal/expiry operations, an 'expiring soon' read, the automatic status flip at effective_to (nothing sets status='expired'), and the consequence for a lapsed tenant (see G-28).
- **Owning module:** api `platform`; schema org
- **Delivery placement:** Named follow-on: Platform Owner Console, after G-6.
- **Dependencies:** G-6; Owner decision on grace/expiry semantics (not invented here); a scheduler for expiry (none exists in-product beyond the notification worker — UNVERIFIED whether the worker can host it).
- **Acceptance criteria:** Renewing writes a new tenant_subscriptions row contiguous with the old one and never overlaps (23P01 negative); an assignment past effective_to resolves NULL from org.current_subscription_plan_id; the console lists assignments ending within an Owner-chosen window.

### OWR-2026-09-06-G-9 — Owner requirement · **Blocked**

> companies, branches

- **Normalised behaviour:** The platform owner sees every organization's companies and branches and an organization can be given additional companies and branches after provisioning.
- **Existing evidence:** Tenant-side: org.company-list/-update/-status-set, org.branch-list/-update, company and branch settings read/write (apps/api/src/app/api/v1/org/companies/_, org/branches/_; ids listed by grep) and the Administration > Organization screen (apps/web/src/features/administration/organization). Provisioning creates exactly one company and one branch (org.provision_organization; ProvisionBody company/branch objects). app_platform can read legal_companies/branches only inside the provisioning window (sel_legal_companies_platform, sel_branches_platform, 20260831093000:234-247).
- **Remaining gap:** No org.company-create or org.branch-create operation exists anywhere (only GET on org/companies/route.ts:49 and org/branches/route.ts:37; POST routes absent) — a tenant can never grow beyond its first company/branch through the product; org.company.manage/org.branch.manage are seeded and inert for creation (scope.md:49 G-4); no platform-side cross-tenant read of companies/branches after provisioning; no UI on the platform side.
- **Owning module:** api `iam` organization-administration (tenant side) and `platform` (cross-tenant read); schema org
- **Delivery placement:** Company/branch CREATE is a Backend contract gap for the tenant Administration screens (owner: the org/IAM Backend lane, pre-P1-29 GAP-16) and blocks any multi-branch acceptance; the platform-side view belongs to the Platform Owner Console follow-on.
- **Dependencies:** Owner decision whether a tenant self-serves branch creation or the platform does it (affects whether the writer is a tenant operation or a platform one); number-sequence provisioning for a new branch (invoice/receipt/quotation sequences are branch-scoped, slice §2).
- **Acceptance criteria:** A second branch created through the product receives its branch-scoped sequences and payment methods and can issue an invoice; the platform owner can list organization X's companies and branches without a tenant session.

### OWR-2026-09-06-G-10 — Owner requirement · **Undecided**

> employees

- **Normalised behaviour:** A tenant holds an employee register (people employed by the workshop) that exists independently of whether the person has a login account, and workshop records that name an employee resolve to it.
- **Existing evidence:** Placeholder only: iam.user_employee_links with employee_ref text and 'NO foreign key to a Phase 1-9 employee table exists yet, by design' (20260718090000_iam_user_accounts_and_profiles.sql:166-194); 0 rows and no writer (psql; grep apps/api/src: referenced only in identity-repository.ts). Every shipped 'employee' column resolves to an IAM account instead: rec.reception_visits.receiving_employee_id FK (tenant_id, id) -> iam.user_accounts (20260815093000_rec_receiving_employee_identity.sql:82-85), tech.technician_profiles.user_id FK -> iam.user_accounts (20260722094000_tech_profiles_skills_certs.sql:42,59-60), sal.deliveries.delivering_employee_id (20260724094000_sal_delivery.sql:113). Register rows already Blocked on this: P1-31 'Delivery employee — Blocked — no employee identity', 'QA employee — Blocked (INT-047)'.
- **Remaining gap:** No employee master table, no operations, no permission code, no UI; the migration's 'Phase 1-9' pointer is stale (docs/phase-1/phase-1-9 is the work-order database phase) — UNVERIFIED that any phase was ever assigned the HR master.
- **Owning module:** schema: new (org or a dedicated hr schema — proposal); api: `iam` or a new `people` module (proposal)
- **Delivery placement:** Backend contract for the tenant side first (it unblocks the two P1-31 register rows and P1-29's 'Assign named employees'), then the Platform Owner Console reads it; placement of the Backend slice is an Owner decision because it changes the data model the Owner has been told is P1-31's.
- **Dependencies:** G-14 (the employee/account distinction decision); P1-31 'Delivery employee' and 'QA employee' rows.
- **Acceptance criteria:** An employee can exist with no iam.user_accounts row; a reception, delivery or QA record names an employee by that register and renders a human name; linking an employee to an account is dated (user_employee_links) and never changes account status.

### OWR-2026-09-06-G-11 — Owner requirement · **Blocked**

> users

- **Normalised behaviour:** The platform owner can see each organization's user accounts and their states; tenant administrators manage their own users through the tenant screens.
- **Existing evidence:** Tenant side Delivered: iam.user-list/-detail/-update/-status-change/-session-list/-session-revoke-all, iam.invitation-create/-cancel/-activate (route ids by grep under apps/api/src/app/api/v1/iam), UsersScreen with invite/cancel/activate/status/revoke actions (apps/web/src/features/administration/users/actions.ts:48-135), status vocabulary invited|active|locked|archived (20260718090000:94-95). Platform side: app_platform holds only a column-scoped self read of iam.user_accounts (id, status, deleted_at) via sel_user_accounts_platform_self (20260831093000:58-66) and INSERT only inside the provisioning window (:341-347).
- **Remaining gap:** No cross-tenant user read or count for a platform operator; no platform-side lock/unlock; no per-organization seat count (see G-16).
- **Owning module:** api `platform` (new read) + `iam`; schema iam
- **Delivery placement:** Named follow-on: Platform Owner Console.
- **Dependencies:** G-1; G-16 (seat count semantics); design §6.1's rule that app_platform holds no privilege on tenant business tables must be re-decided explicitly for iam.user_accounts (wave-b-control-plane-design-v2.md:319-330).
- **Acceptance criteria:** A platform operator lists organization X's accounts with states and counts; a tenant session cannot reach that read; every such read is audited as security class (iam.audit-event-list precedent, apps/api/src/app/api/v1/audit-events/route.ts:45-50).

### OWR-2026-09-06-G-12 — Owner requirement · **Blocked**

> delegated administrators

- **Normalised behaviour:** The platform owner can establish, replace or re-enable an organization's administrator at any time, and the administrator's authority is a finite, server-owned set that can be delegated onward only within itself.
- **Existing evidence:** At provisioning: first_owner (three IAM codes) and tenant_administrator (65 codes) written by the bootstrap (bootstrap-roles.ts:137-243), proven W9-B1..B3 (owner-bootstrap test :301-445); delegation onward bounded by ins_role_permissions_delegable / ins_role_grants_delegable (20260726090000:299-384) and iam.grant_delegation_within_authority (20260902130000:57), W9-R (:744). Last-administrator protection (user-administration-service.ts:189; delegation-policy.ts:243).
- **Remaining gap:** After the bootstrap window closes (first legal transition, upd_tenants_platform_lifecycle :101-115; L8 :445) the platform has NO write path into a tenant's IAM: it cannot replace a lost First Owner, re-invite an administrator, or widen the bundle of a pre-slice organization (TB-R1). Only one platform operator can ever exist through the sanctioned genesis (G2, platform-genesis test :268) and platform grants have no in-product writer (20260831090000:110-112) — there are no 'delegated platform administrators' either.
- **Owning module:** api `platform` + `iam` (tenant-bootstrap-service.ts); schema iam (platform_grants, roles, role_grants)
- **Delivery placement:** Backend contract on the Backend lane before the Platform Owner Console; the TB-R1 backfill decision is P1-30 corrective territory because it gates the fresh-organization acceptance of already-provisioned pilots.
- **Dependencies:** Owner decision on post-window platform authority into a tenant's IAM (design §5.4/§6.1 deliberately withholds it); G-22 (support access is the same authority question); G-29 backfill.
- **Acceptance criteria:** A platform operator holding a named authority re-establishes organization X's administrator after the window closed, the act is refused without that authority, attributed to the operator, and visible in X's own audit trail; a second platform operator can be granted platform.organization.read by the first through a recorded act rather than SQL.

### OWR-2026-09-06-G-13 — Owner requirement · **Planned**

> Keep platform subscriber CRM distinct from a tenant's workshop-customer CRM

- **Normalised behaviour:** Platform CRM records (organizations, contacts, leads, activities) live in platform-owned tables and modules with no tenant_id, readable only by platform authority; tenant CRM (crm.*) never stores or reads them.
- **Existing evidence:** Vacuously true today: no platform CRM exists; crm.* is tenant-scoped and gated by crm.* codes (register P1-27 rows; crm.contact_points in catalog). Precedent for platform-only tables without tenant_id: org.feature_flags, org.subscription_plans (20260717102000:98-100 'documented exception to the tenant-column rule'), iam.platform_grants (20260831090000:106-108), each carried in the no-tenant-column exception set of tests/db/org-security.test.ts.
- **Remaining gap:** The rule must be written as a gate before G-3/G-4/G-5 exist (a platform CRM table with tenant_id, or a crm.* table reused for prospects, would violate it).
- **Owning module:** api `platform`; schema: platform-side (proposal G-26); gate: tests/db/org-security.test.ts exception set
- **Delivery placement:** Platform Owner Console follow-on, as its first design rule; recorded now so nothing drifts into crm.*.
- **Dependencies:** G-26.
- **Acceptance criteria:** A structural test asserts every platform CRM table is in the no-tenant-column exception set and carries app_platform-only policies; a tenant session SELECT on any of them returns zero rows/42501; no crm.* migration references a platform table.

### OWR-2026-09-06-G-14 — Owner requirement · **Undecided**

> and employees distinct from login accounts

- **Normalised behaviour:** An employee record and a login account are different entities: an employee may have zero or one account over time, and disabling an account never deletes or alters the employee record.
- **Existing evidence:** Design intent only: iam.user_employee_links is effective-dated and 'never modifies account state' (20260718090000:43-44,192-194). In shipped behaviour the two are the same thing: every employee-naming column is a FK to iam.user_accounts (see G-10 citations), and the receiving-employee stamp requires an ACTIVE IAM user with a live grant (20260815093000:117-143).
- **Remaining gap:** The employee entity (G-10); a rule for which employee-naming columns move to it; the dated link's writer.
- **Owning module:** schema iam (user_employee_links) + the new employee master; api `iam`
- **Delivery placement:** Same Backend slice as G-10; Owner decision first.
- **Dependencies:** G-10.
- **Acceptance criteria:** Archiving an account leaves its employee record and all historical custody/delivery references intact; an employee with no account can be named as delivering_employee and rendered by name.

### OWR-2026-09-06-G-15 — Owner requirement · **Blocked**

> Onboarding must create an isolated usable organization.

- **Normalised behaviour:** A newly provisioned organization can see no other tenant's data and no other tenant can see it, and its administrator can run the full workshop journey (reception to receipt) without out-of-band database work.
- **Existing evidence:** Isolation proven: the bootstrap window admits writes only to the tenant this transaction created (withPlatformTarget created_by/created_at check, transaction.ts:248-261; W9-B4 :445; PM-N :578); every bootstrap policy carries tenant_id = iam.current_tenant_id() AND status='provisioning' (20260831093000:320-385); app_platform holds no privilege on business tables (design §6.1). Usability partially proven: W9-L login, W9-R persona delegation, PM-B4 receipt on a fresh tenant, F01-B1 commercial code mapping.
- **Remaining gap:** Commercial usability is Blocked by F-02 — eleven master-data tables with no in-product writer (svc.service_categories, svc.service_versions, svc.price_list_assignments, svc.discount_rules, svc.pricing_approval_policies, inv.item_categories, inv.item_master, inv.stock_locations, sal.invoice_numbering_configs, org.tax_classes, org.tax_rates; tenant-bootstrap-corrective-slice.md §4; a0-read-surface-matrix.md:87); eight navigation gates unheld (TB-R3); prefix/pad/reset rules unconfigurable (TB-R5).
- **Owning module:** api `platform` for the act; the F-02 writers belong to `service-catalog`, `pricing`, `inventory`, `billing` and the org tax surface
- **Delivery placement:** P1-30 corrective (F-02 is a blocking disposition for P1-G30 integrated acceptance, slice §4) plus the Integration gate for the end-to-end proof on a fresh organization.
- **Dependencies:** Owner decision on F-02 (build the writers in P1-20/P1-21/P1-22 lanes, or declare them onboarding activities with direct database access — the latter contradicts 'usable'); G-7.
- **Acceptance criteria:** On a production build, a fresh organization's First Owner completes customer -> vehicle -> reception -> work order -> service -> price -> quotation -> invoice -> receipt with no SQL; a cross-tenant read of any of those records from another tenant returns nothing.

### OWR-2026-09-06-G-16 — Owner requirement · **Undecided**

> Enforce the approved user-seat limit

- **Normalised behaviour:** When an organization's seat-consuming accounts already equal its approved seat limit, any act that would create another seat-consuming account is refused server-side with a catalogued error, and nothing is written.
- **Existing evidence:** none — the words seat, quota and max_users appear in no route, service, migration or policy (grep apps/api/src, supabase; the only hits are approval_limits and capacity_limits). org.subscription_plans.capacity_limits is a validated open-key jsonb (non-negative numbers, 20260717102000:177-188) read by nothing at runtime (psql pg_proc scan; grep apps/api/src). InvitationService.invite (invitation-service.ts:101-215) checks delegation and duplicates only.
- **Remaining gap:** The seat definition (G-21), the limit's source (a capacity_limits key on the effective plan is the shape that exists), the count query, the refusal in the same transaction as insertAccount and as iam.change_user_status (invited->active, locked->active), the error code, and the platform-side approval of a limit per organization.
- **Owning module:** api `iam` (invitation-service.ts, user-administration-service.ts) + `platform`; schema org (plan capacity) and iam (user_accounts); a database backstop (constraint trigger) in the style of 20260727090000
- **Delivery placement:** Backend lane after the Owner decisions; enforcement is tenant-runtime code so it lands before any console UI.
- **Dependencies:** G-21 (which states consume a seat); G-6 (where the approved limit lives); no numeric quota is chosen here.
- **Acceptance criteria:** With limit N reached, iam.invitation-create and iam.user-status-change to 'active' answer a catalogued refusal and write no account/history row; archiving one account makes the next invite succeed; the refusal is independently reproduced by a direct INSERT as app_runtime (database backstop).

### OWR-2026-09-06-G-17 — Owner requirement · **Delivered**

> and delegation rules server-side

- **Normalised behaviour:** An administrator can map, grant or scope only authority they themselves hold, cannot act on their own access, and cannot remove the last holder of an administrative permission — enforced in the database as well as the service.
- **Existing evidence:** Delivered (tenant side): ins_role_permissions_delegable and ins_role_grants_delegable (20260726090000:299-384), ck_role_grants_no_self_grant, DelegationPolicy.assertDelegable/assertNotSelf/last-holder (delegation-policy.ts:104-142,243), deferred backstop iam.grant_delegation_within_authority (20260902130000:57; architecture-decisions.md:227), tests/backend/iam-access-administration.test.ts:206-444, W9-R (:744), F01-B1. First Owner set frozen at three codes (W9-B2).
- **Remaining gap:** Platform-side delegation (one operator granting another a platform.* code) has no in-product path (20260831090000:110-112 'out-of-band operator act').
- **Owning module:** api `iam` (access-administration-service.ts); schema iam
- **Delivery placement:** Delivered by P1-14 and PRE-P1-29; re-verified at the Integration gate; platform-side delegation belongs to G-12's Backend slice.
- **Dependencies:** none for the tenant side; G-12 for the platform side.
- **Acceptance criteria:** Mapping a code the actor does not hold answers 403 ERR-IAM-001 with requiredPermissions; a direct INSERT as app_runtime is refused by RLS independently of the service; locking the last iam.user.manage holder is refused.

### OWR-2026-09-06-G-18 — Owner requirement · **Undecided**

> including concurrent invitations/activation

- **Normalised behaviour:** Two simultaneous invitations or activations for the same address, or racing against a seat limit, cannot both succeed: exactly one wins and the other is refused deterministically.
- **Existing evidence:** Identity races are Delivered: uq_user_accounts_tenant_email_active and the global uq_user_accounts_provider_identity_active (20260718090000:107-110) turned into ERR-RES-002 on unique violation (invitation-service.ts:146-156); iam.change_user_status takes FOR UPDATE and refuses a same-state transition (20260718090000:292-309), and activation is idempotent on the request key (activation route :28-40). tests/backend/iam-auth-provider.test.ts:731-945 cover duplicate, unconfirmed-provider and cross-tenant refusals.
- **Remaining gap:** No seat-aware serialization exists because no seat limit exists (G-16): two concurrent invites at N-1 seats would both commit; no test exercises true concurrency (UNVERIFIED by execution — the suite tests sequential duplicates).
- **Owning module:** api `iam`; schema iam (a per-tenant advisory lock or counted backstop is the proposed mechanism)
- **Delivery placement:** With G-16 on the Backend lane.
- **Dependencies:** G-16, G-21.
- **Acceptance criteria:** Two invitations issued in parallel at N-1 seats yield one 201 and one refusal; two activations of the same invited account yield one state change and one 'already active' refusal; the account count never exceeds N in the database after any interleaving.

### OWR-2026-09-06-G-19 — Owner requirement · **Delivered**

> scope escalation attempts

- **Normalised behaviour:** A company- or branch-scoped administrator cannot issue, widen or re-scope a grant beyond the scopes they hold, including the empty-scope (tenant-wide) form, and a mixed request fails as a whole.
- **Existing evidence:** Delivered: DelegationPolicy unrestricted-delegation refusal and hierarchical scopeCovers (delegation-policy.ts:73-100,143+), normalizeScopes de-duplication (access-administration-service.ts:68-90), scope containment at :394-410, deferred constraint backstop (architecture-decisions.md:227 names 20260727090000_iam_grant_delegation_scope_backstop.sql), composite FKs on iam.grant_scopes (20260726090000:391-403); tests iam-access-administration.test.ts cases 4,5,9,10/11,12,13 (:237-303) and scope add/remove (:443-444).
- **Remaining gap:** none found for the tenant side; escalation via a platform principal is structurally impossible today because app_platform can write iam.role_grants only inside the provisioning window (:378-385).
- **Owning module:** api `iam`; schema iam
- **Delivery placement:** Delivered (P1-14 remediation, PRE-P1-29); re-verified at the Integration gate.
- **Dependencies:** none.
- **Acceptance criteria:** A company-scoped admin's grant with omitted, null or empty scopes is refused; a grant naming a foreign company is refused with no partial row; the same INSERT as app_runtime is refused by the backstop at COMMIT.

### OWR-2026-09-06-G-20 — Owner requirement · **Delivered**

> and tenant switching

- **Normalised behaviour:** A session is bound to exactly one tenant and cannot be steered at another: an identity resolves to one account in one tenant, a request naming a different tenant is refused, and every request context carries exactly one tenantId.
- **Existing evidence:** Delivered by construction: uq_user_accounts_provider_identity_active is unique on (identity_provider, provider_subject) with no tenant in the key (20260718090000:109-110); resolveTenant derives the tenant from the provider binding and refuses a caller-named different tenant (authentication-service.ts:317-360), tenant-binding-mismatch and subject-mismatch denials (:240-256); the web login has no tenant field (apps/web/src/features/authentication/schemas/credentials.ts:37-44; actions/login.ts:95-97); 'Exactly one tenant per request, always' (apps/api/src/server/context/request-context.ts:27); W9-B12 refuses an Owner address bound elsewhere (owner-bootstrap test :677-694); cross-tenant invitation negative (iam-auth-provider.test.ts:812).
- **Remaining gap:** There is no legitimate multi-tenant identity either (a person working for two organizations needs two provider identities) — Wave D 'global identity' is unbuilt (design :977-980); the platform operator's own account is an ordinary account in the platform_operators tenant (design §5.4 T-1 :753). Tenant status is not enforced at session: no request-path code reads org.tenants.status (grep route-handler.ts, request-context.ts, identity-repository.ts, authorization-repository.ts, iam migrations — none), so a 'suspended' or 'closed' tenant's users can still log in and act (grep-verified absence; not executed) — see G-28.
- **Owning module:** api `iam` (authentication-service.ts); schema iam
- **Delivery placement:** Delivered for the refusal; the multi-membership model is the named Wave D follow-on and an Owner decision; suspension enforcement is G-28.
- **Dependencies:** G-28; Owner decision on whether one person may hold accounts in several organizations under one identity.
- **Acceptance criteria:** A login naming tenant B for an identity bound to tenant A answers the generic failure and writes a login_audit failure; no operation accepts a tenantId body/query member outside the platform module; a provider identity cannot be bound to two live accounts (23505).

### OWR-2026-09-06-G-21 — Owner requirement · **Undecided**

> Define which account states consume a seat; do not invent a subscription price or numeric quota.

- **Normalised behaviour:** The register records, as an Owner decision, which of invited | active | locked | archived (and soft-deleted) count against the seat limit, and no price or numeric quota is written anywhere in the product until the Owner gives one.
- **Existing evidence:** The state vocabulary is fixed: ck_user_accounts_status invited|active|locked|archived plus deleted_at (20260718090000:94-96); transitions invited->active|archived, active->locked|archived, locked->active|archived, archived terminal (:301-309); iam.has_permission answers false for non-active accounts (invitation-service.ts docblock :22-30). Live stack: 46 accounts, all 'active' (psql). No price or quota exists anywhere (grep; 0 plan rows).
- **Remaining gap:** The decision itself. Options the schema supports without invention: (a) active + locked consume, invited reserves, archived never; (b) active only; (c) active + invited. Each changes G-16's count query and G-18's race window.
- **Owning module:** docs/product/owner-workflow-requirements.md (decision record); enforcement in api `iam`
- **Delivery placement:** Owner decision before G-16 is scoped; recorded in the register, not in code.
- **Dependencies:** none (pure decision); G-16/G-18 consume it.
- **Acceptance criteria:** The register carries the chosen state set with the date; a unit test pins the seat predicate to exactly that set; repository grep for a price or quota literal stays at zero.

### OWR-2026-09-06-G-22 — Owner requirement · **Undecided**

> Platform support access must have explicit authority

- **Normalised behaviour:** A platform operator can read or act inside a specific organization only while holding a named, server-checked authority for that purpose; absent it, the control plane holds no privilege on any tenant business table.
- **Existing evidence:** Containment is Delivered and proven: platform authority is a named grant in iam.platform_grants resolved by iam.has_platform_authority (20260831090000:84-166), exactly three codes exist (04_iam_permission_catalog.sql:365-367; genesis PLATFORM_CODES), app_platform holds no privilege on tenant business tables (design §6.1 :319-330) and can read iam.user_accounts only for itself (:58-66); tenant-only principals are refused (L5, P3, R4). No support/impersonation concept exists anywhere (grep apps/api/src, migrations, docs/product: none).
- **Remaining gap:** A support authority (e.g. a platform.tenant.support code — name is a proposal), its target-scoping (per organization, time-boxed), its read/act surface, and whether the tenant must consent — all Owner decisions; the current session model has no 'acting on tenant X' context outside the provisioning window (withPlatformTarget refuses any tenant not created by this transaction, transaction.ts:248-261).
- **Owning module:** api `platform` + `iam`; schema iam (platform_grants) and a support-session ledger (proposal G-27)
- **Delivery placement:** Named follow-on: Platform Owner Console, Backend lane first; Owner decision on the model precedes it.
- **Dependencies:** G-27 proposal; G-12 (same authority question); design §5.4 residual.
- **Acceptance criteria:** Without the support authority every read of a tenant business table by the platform connection is 42501/empty (already true); with it, only the named organization becomes readable, for the granted interval, and the grant itself is a recorded row with granted_by <> account_id (ck_platform_grants_no_self_grant).

### OWR-2026-09-06-G-23 — Owner requirement · **Planned**

> actor/target attribution

- **Normalised behaviour:** Every platform act on an organization records the operator (actor) from the session and the organization (target) in the record, and the target organization can see who from the platform touched it.
- **Existing evidence:** Delivered for the three control-plane operations: actor is iam.current_user_id(), never the request (route docblocks; P5 refuses actor_id; A1 asserts actor_id = operator, control-plane test :649-674); provisioning's audit record is written INSIDE the target tenant's trail with the target as entity_id (organization-service.ts:166-206; A1 asserts tenant_id = new tenant); org.tenant_status_history rows carry the server-stamped actor in the target tenant (20260831093000:119-136; L6/L7 :421); the genesis writes platform.operator.genesis (G4 :390).
- **Remaining gap:** The lifecycle audit record (org.tenant.status_changed) is appended with db.context.principal.tenantId — the operator's HOME tenant (audit.ts:102) — so the target organization's own audit trail carries only the status-history row, not the audit record naming the reason; no operation lets a tenant read its status history (no SELECT for app_platform either, :137-139; UNVERIFIED whether a tenant-side read of org.tenant_status_history is published — grep of route ids shows none); nothing exists yet for support access (G-22).
- **Owning module:** api `platform` (organization-service.ts), apps/api/src/server/audit/audit.ts; schema iam.audit_records, org.tenant_status_history
- **Delivery placement:** Pattern reused by G-22's Backend slice; the dual-trail correction (G-30) can land as a small Backend change on the platform module before the console.
- **Dependencies:** G-22; G-30.
- **Acceptance criteria:** For every platform act on organization X, an audit record with actor = operator and entity_id = X exists in X's trail (verifiable via iam.audit-event-list as X's administrator) and an audit record exists in the operator's home tenant; a request carrying an actor field is refused at the boundary.

### OWR-2026-09-06-G-24 — Owner requirement · **Planned**

> and auditing

- **Normalised behaviour:** All platform acts, including support access, are appended to the hash-chained audit trail and security-event log, are readable by the platform owner across organizations, and can be verified.
- **Existing evidence:** Delivered for what exists: privileged audit class on provision/lifecycle (route declarations), appendAudit -> iam.audit_append with per-tenant SHA-256 chain (audit.ts:1-17; 20260718095000_iam_audit_subsystem.sql:267-296), app_platform INSERT/SELECT on the three audit tables with tenant-matching policies (20260831093000:392-416), iam.security_events INSERT for the platform with rate-limit.breached persisted once (B9 :695-733), genesis audit without secrets (G4).
- **Remaining gap:** No cross-organization audit READ for a platform operator (iam.audit-event-list/-detail are tenant-scoped on iam.audit.view, audit-events/route.ts:45-50; app_platform's SELECT policy is tenant-matching); no audit of control-plane READS (platform.organization-read is auditClass 'none', route :149 — declared, but a cross-tenant read arguably deserves the 'security' class the tenant audit-log read carries); support-access auditing depends on G-22.
- **Owning module:** api `platform` + `iam` (audit-view-service.ts); schema iam audit tables
- **Delivery placement:** Named follow-on: Platform Owner Console (a platform audit read is a new operation on the Backend lane).
- **Dependencies:** G-22, G-23, G-30.
- **Acceptance criteria:** A platform operator can page the audit trail of organization X and of the operator home tenant without a tenant session; iam.audit_verify (chain verifier) passes on both after platform acts; every support-access session start and end is an audit record in X.

### OWR-2026-09-06-G-25 — Proposed implementation policy · **Undecided**

> Define which account states consume a seat

- **Normalised behaviour:** PROPOSED for Owner decision, not chosen: a seat is consumed by an account with deleted_at IS NULL and status IN ('active','locked'); an 'invited' account reserves a seat from invitation until activation or cancellation so the limit cannot be overshot by pending invitations; 'archived' never counts; the platform_operators home tenant is exempt because it holds no business data (W9 record §1).
- **Existing evidence:** The state graph and the invited->archived cancellation path make 'reserve on invite' expressible with no schema change (20260718090000:301-309; invitation-service.ts:224-278).
- **Remaining gap:** Owner acceptance or an alternative; then the count predicate in G-16.
- **Owning module:** decision record in docs/product/owner-workflow-requirements.md; api `iam`
- **Delivery placement:** Owner decision now; enforcement with G-16.
- **Dependencies:** G-21.
- **Acceptance criteria:** The chosen predicate is pinned by one unit test and one database backstop test; cancelling an invitation frees the seat in the same transaction.

### OWR-2026-09-06-G-26 — Proposed implementation policy · **Planned**

> Provide dedicated platform-owner pages and CRM for subscribing organizations

- **Normalised behaviour:** PROPOSED placement: platform CRM tables live in a new platform-owned schema with no tenant_id (added to the tests/db/org-security.test.ts exception set), policies admit app_platform holders only, operations are registered under the existing `platform` module prefix so authorization.ts's platform branch gates them, and the web console is a separate route group whose session is established through the platform authority rather than a tenant account.
- **Existing evidence:** Precedents: platform-only tables (20260717102000:98-100; 20260831090000:106-108); the platform module prefix and its authority branch (platform/organizations/route.ts:1-21); the ownership-profile mechanism used for p1-30-backend / p1-30-frontend (canonical-plan.md §1.4).
- **Remaining gap:** Owner acceptance of the placement; a new ownership profile for the follow-on lane; the session design for platform authority in the web app.
- **Owning module:** api `platform`; schema: new platform schema (name to be chosen); web: new route group
- **Delivery placement:** First design decision of the Platform Owner Console follow-on.
- **Dependencies:** G-1, G-13, G-22.
- **Acceptance criteria:** A structural test fails if a platform CRM table carries tenant_id or a crm.* table gains a platform column; the console's screens pass the access gate with platform codes only.

### OWR-2026-09-06-G-27 — Proposed implementation policy · **Undecided**

> Platform support access must have explicit authority, actor/target attribution, and auditing.

- **Normalised behaviour:** PROPOSED model: a support session is a recorded row (operator, target tenant, purpose, opened_at, expires_at, closed_at) created under a dedicated platform.* authority and, if the Owner requires it, a tenant administrator's consent record; while open, the platform connection is retargeted to that tenant through a bounded variant of withPlatformTarget that admits READ policies only, every request inside it is audited in the target tenant with the session id, and the session is closed by expiry or by either party.
- **Existing evidence:** withPlatformTarget already implements retargeting with app.tenant_id and a window predicate (transaction.ts:234-275); iam.platform_grants is append-and-revoke with self-grant refusal (20260831090000:84-110); the 'window' pattern (status='provisioning') shows how a time-bounded authority is expressed in RLS (20260831093000:341-385).
- **Remaining gap:** Owner decisions: consent required or not; read-only or read/act; maximum duration; whether support sessions appear in the tenant's audit log screen. Then schema, policies, operations, console UI.
- **Owning module:** api `platform` + `iam`; schema iam (support session ledger — proposal)
- **Delivery placement:** Platform Owner Console follow-on, Backend lane first; Owner decision precedes scoping.
- **Dependencies:** G-22, G-23, G-24.
- **Acceptance criteria:** Outside an open session the platform connection reads nothing from the tenant (42501/empty); inside it only the named tenant is readable; the session row, its opening and closing, and every read are in the tenant's audit trail with actor = operator; the session cannot be opened by the operator for themselves without the authority row.

### OWR-2026-09-06-G-28 — Proposed implementation policy · **Planned**

> subscription/entitlement lifecycle, onboarding and renewals

- **Normalised behaviour:** PROPOSED: a tenant whose org.tenants.status is 'suspended' or 'closed' — and, once G-6 exists, whose subscription has lapsed — is refused at login and at every request with one catalogued error and no data leak, and its live sessions are revoked on the transition.
- **Existing evidence:** The status column was designed for exactly this ('Queryable by the future session layer to refuse suspended/closed tenants', 20260717101000:117) and the lifecycle operation can set it (L1-L3); the session-revocation mechanism exists for accounts (iam.user-status-change docblock, users/[userId]/status/route.ts:9-12).
- **Remaining gap:** No request-path code reads tenant status (grep-verified absence, G-20); no hook on org.change_tenant_status revokes sessions; Owner decision on grace behaviour for a lapsed subscription (no numeric grace invented).
- **Owning module:** api `iam` (authentication-service.ts, route-handler.ts) ; schema org/iam
- **Delivery placement:** Backend lane, small slice, before the Platform Owner Console; it is the runtime half of G-6/G-8.
- **Dependencies:** G-6, G-8, Owner decision on lapse semantics.
- **Acceptance criteria:** After platform.organization-lifecycle to 'suspended', an active user's next request is refused and login fails with the generic failure; 'active' again restores access; a test proves the refusal comes from the server, not the client.

### OWR-2026-09-06-G-29 — Proposed implementation policy · **Undecided**

> Onboarding must create an isolated usable organization.

- **Normalised behaviour:** PROPOSED disposition of the recorded residuals: (1) organizations provisioned before the corrective slice receive the 17 commercial codes, canonical payment methods and number sequences through a one-time, Owner-approved, audited backfill run on the platform connection (TB-R1/TB-R2); (2) the administrator bundle is derived against apps/web/src/config/navigation.ts's gates rather than one phase's routes, closing the eight unheld gates the Owner has not deliberately excluded (TB-R3); (3) the genesis and pilot runners are documented as not producing usable business tenants (TB-R4).
- **Existing evidence:** Residuals recorded in tenant-bootstrap-corrective-slice.md §5 and a0-read-surface-matrix.md:313-340; the bootstrap writes the bundle once at provisioning (bootstrap-roles.ts docblock 'written ONCE').
- **Remaining gap:** Owner decision on mutating live tenants' authority (slice §5 TB-R1); the backfill mechanism (no post-window platform write path exists — G-12).
- **Owning module:** api `iam` (bootstrap-roles.ts) + `platform`; schema iam, sal, shared
- **Delivery placement:** P1-30 corrective (it gates the fresh-organization acceptance of the pilots already provisioned).
- **Dependencies:** G-12 (post-window write authority), Owner decision.
- **Acceptance criteria:** After the backfill, every pre-slice tenant's administrator can map sal.payment.record and record a receipt (F01-B1/PM-B4 re-run per tenant); the backfill is idempotent and audited in each target tenant.

### OWR-2026-09-06-G-30 — Proposed implementation policy · **Planned**

> actor/target attribution, and auditing

- **Normalised behaviour:** PROPOSED rule for every platform act on an existing organization: write the audit record in BOTH the operator's home tenant (for the platform trail) and the target organization's trail (for the tenant's own visibility), each with actor = operator and entity_id = target, and publish a platform-side audit read that pages both.
- **Existing evidence:** Provisioning already writes in the target trail (organization-service.ts:166-206, A1), lifecycle writes only in the operator's home tenant (changeStatus :286-299 via audit.ts:102) — the two operations disagree today; the target tenant's audit policies for app_platform are tenant-matching (20260831093000:396-416) so a dual write needs a retarget, which withPlatformTarget refuses outside the provisioning window.
- **Remaining gap:** A bounded retarget for audit-only writes (or an audit function accepting an explicit target under platform authority), the read operation, tests A3/A4.
- **Owning module:** api `platform`, apps/api/src/server/audit/audit.ts; schema iam audit tables
- **Delivery placement:** Small Backend slice on the platform module ahead of the console; the pattern G-27 depends on.
- **Dependencies:** G-23, G-24, G-27.
- **Acceptance criteria:** After a lifecycle transition on X, X's administrator sees org.tenant.status_changed in Administration > Audit log with the operator named as actor, and the operator's home trail holds the same record; iam audit chain verification passes in both tenants.

---

## Area H — Reception workflow and camera/OCR

**Where this area stands today.** The "32-step Owner workflow" is the P1-28 table of docs/product/owner-workflow-requirements.md (rows 1–32, lines 147–180); the end-to-end journey document holds exactly twenty-nine steps (Step 1 at line 280 … Step 29 at line 953, heading "The twenty-nine steps" line 278) and no document adds three more — the two counts describe different registers, not a lost trio of steps. Reception media capture EXISTS and was Owner-accepted (P1-28 closure PASS 2026-08-20): six capture requirements incl. a baseline floor of seven exterior photographs, seven seeded reception_* categories, immutable scanned document versions, per-visit bindings with device capture time and a VIN-only readable/unreadable flag, an attributable override, and a wizard MediaStep — but the register's P1-28 status column still says Blocked/Planned for rows it has since delivered. What is MISSING against the Owner's new direction: any camera path in the web app (the shipped control is a plain <input type=file> with no capture attribute, and apps/web/tests/p1-28-reception-media.test.ts:897-915 actively bans getUserMedia/ImageCapture/<video>/capture=), any OCR/assisted extraction (no code anywhere), a preserved extracted-candidate record, a VIN format/check-digit verification operation (veh.vin_verifications is read and written by nothing), a pre-submit candidate-vs-odometer-history comparison, a confirm/correct step, a media viewer in the web (shared.attachment-download-authorize has no web consumer), and the road-test / unsafe-to-test record (still absent everywhere). Where it lands: the register update and the capture-policy/status refresh are documentation work now; camera capture and the confirm/correct UI are Frontend work owned by closed P1-28, so they need a named P1-28 corrective slice sequenced before the Integration gate (P1-30 explicitly does not own reception and P1-31 owns delivery/warranty/reporting); the candidate record, VIN verification and the OCR port are Backend prerequisites on the shared-services/vehicle/reception lanes; the OCR approach and provider are an Owner commercial decision (Undecided); road test stays Blocked on an Owner placement decision plus schema.

### OWR-2026-09-06-H-1 — Owner requirement · **Delivered**

> Read and preserve the existing 32-step Owner workflow from its repository register.

- **Normalised behaviour:** The Owner's intake workflow as recorded in the register (P1-28 table rows 1–32) and the twenty-nine-step journey document remain the canonical, unaltered statement of the reception-to-history journey, and every later requirement is attached to one of those rows rather than restated.
- **Existing evidence:** docs/product/owner-workflow-requirements.md:147-180 (P1-28 table, rows 1–32 — this is the only 32-item workflow list in the repository); docs/product/workshop/end-to-end-workshop-workflow.md:13, 41, 278 ('twenty-nine-step', 'The twenty-nine steps') with Step 1 at :280 through Step 29 at :953 — exactly 29 headings; docs/product/README.md:51 also says twenty-nine. No document in docs/ adds three steps (grep for thirty-two/32-step across docs/ matches only unrelated P1-27 counts); inspection-and-diagnostics.md and the P1-28 docs restate the same journey without renumbering it.
- **Remaining gap:** None for preservation itself. The 29-vs-32 discrepancy must be recorded explicitly so a later reader does not hunt for three missing steps: 29 = journey steps (arrival→retained history), 32 = P1-28 intake requirement rows.
- **Owning module:** docs/product (register + workshop docs); no api module, no schema.
- **Delivery placement:** Now, as a documentation-only register update (repository-tooling/docs lane) — no phase code changes; the register is the cross-phase authority.
- **Dependencies:** None.
- **Acceptance criteria:** The register carries a note naming both counts with their sources (rows 1–32 at owner-workflow-requirements.md:147-180; Steps 1–29 at end-to-end-workshop-workflow.md:280-953) and no row of the P1-28 table has been removed or reworded.
- **Unverified:** Whether the Owner's '32' refers to anything other than the P1-28 register table — no other 32-item workflow list exists in the repository.

### OWR-2026-09-06-H-2 — Proposed implementation policy · **Planned**

> (derived from) Read and preserve the existing 32-step Owner workflow from its repository register.

- **Normalised behaviour:** The P1-28 status column of the register is refreshed from the P1-28 closure evidence so that rows delivered by P1-28 no longer read Planned/Blocked/Contracted, with each new status citing the phase record that proves it.
- **Existing evidence:** docs/phase-1/phase-1-28/closure-record.md:5-16 (OWNER ACCEPTANCE: PASS 2026-08-20 at develop 93af64dd) and :118-136 (live finalization of accepted evidence, EICAR quarantine, damage marks read back); docs/phase-1/phase-1-28/canonical-plan.md:161 (FE-017 'Reception camera and media upload' bound to eight operations) and :250-273 (P1-OD-025 RESOLVED FOR RECEPTION EVIDENCE). The register still shows rows 12–14 '**Blocked** — media upload unsupported (INT-093/094/095)' (owner-workflow-requirements.md:160-162), row 3 Blocked INT-012 (:151) although crm.customer-vehicle-list now exists (apps/api/src/app/api/v1/customers/[customerId]/vehicles/route.ts:81-97), rows 7/9/11/22/23/27/28/31/32 Contracted (:155-180) although the P1-28 wizard consumes them.
- **Remaining gap:** Every P1-28 row's status is stale; rows 16–21 (road test, lift inspection) and 24 (party roles — rec.reception-party-role-list now exists) need individual re-verification against code before their status moves.
- **Owning module:** docs/product/owner-workflow-requirements.md.
- **Delivery placement:** Now, documentation-only, together with H-1 — the register is the durable record and 'Documented is not implemented' cuts both ways: a delivered row recorded as Blocked misleads planning of the follow-on slices in this area.
- **Dependencies:** H-1; the P1-28 closure record as the evidence source.
- **Acceptance criteria:** Each P1-28 row's status cites a phase record or route file; rows 12–14 read Delivered with the angle-set decision recorded as the remaining Owner input; rows 16–21 remain Blocked citing INS-04/INS-05/WF-10.
- **Unverified:** Row-by-row status of P1-28 rows 15, 20, 21, 25, 29, 30 was not re-derived in this pass.

### P1-28 #12 "Seven exterior photos: front, rear, front-left, front-right, rear-left, rear-right, approved seventh overall/roof angle" — Owner requirement · **Delivered**

> The historical record includes seven exterior photos

- **Normalised behaviour:** A reception visit is expected to hold at least seven finalized (accepted, scanned) exterior photographs bound to it before the exterior requirement reads satisfied, and those images remain readable for the life of the visit.
- **Existing evidence:** apps/api/src/modules/reception/domain/reception-capture.ts:18-25 (requirement 'exterior'), :63-71 (maps to category reception_exterior), :95 (baseline minCount 7, deviceCapturedAtRequired true); supabase/migrations/20260815100000_rec_reception_evidence_contracts.sql:59-95 (rec.capture_policy_rules, min_count 0–20, append-then-retire), :188-232 (rec.reception_evidence_bindings, one row per document VERSION per requirement), :380-437 (rec.guard_reception_evidence_binding: category must match, version must be linked to the visit and be pending/accepted; finalize needs accepted); supabase/seeds/05_shared_reference.sql:41 (platform category reception_exterior: image/jpeg|png|webp, 10485760 bytes, restricted, evidence-audit, link purpose inspection_media); routes apps/api/src/app/api/v1/receptions/[receptionId]/evidence-bindings/route.ts:59-70 (rec.reception-evidence-binding-list, rec.reception.read, branch) and :94-107 (rec.reception-evidence-binding, rec.reception.evidence.manage, audit rec.reception.capture_evidence_bound), .../[bindingId]/finalization/route.ts:38-43 (rec.reception-evidence-binding-finalize); apps/web/src/features/receptions/components/steps/MediaStep.tsx (count rendered as finalizedCount/minCount, five states incl. 'partly met'); apps/web/src/i18n/messages/en.json:1353 ('Exterior photographs'); closure-record.md:118-136 (Owner-accepted live).
- **Remaining gap:** (a) The seven ANGLES are not modelled: a binding carries requirement_code only (migration :194), so 'front' vs 'rear' cannot be asserted or counted — the angle set is an open Owner decision (reception-media-checklist.md:102-105; media-capture-decision-record.md:33-45). (b) rec.capture_policy_rules ships empty (live count 0) so seven is a read-model baseline; the tenant writer exists (rec.catalogue-capture-policy-set, apps/api/src/app/api/v1/reception-catalogue/capture-policies/route.ts:79-86, rec.catalogue.manage, tenant scope) but no web screen consumes it (grep: only receptions-contract.ts and idempotent-operations.ts mention it). (c) Whether missing media blocks rec.reception-approve is not enforced (checklist §4.1, RMC-14) — the floor is advisory.
- **Owning module:** api: modules/reception (reception-capture-service), modules/shared-services (attachment-service); schema: rec.capture_policy_rules, rec.reception_evidence_bindings, shared.documents/document_versions/document_links/document_categories; web: features/receptions.
- **Delivery placement:** Delivered by P1-28 (closed). The angle-set model and a capture-policy admin screen are follow-on work for a P1-28 corrective slice; not P1-30 (canonical-plan.md §2 excludes reception) and not P1-31.
- **Dependencies:** Owner decision on the seven angles (P1-OD-025 residue); Owner decision on advisory vs blocking floor (RMC-14).
- **Acceptance criteria:** On a fresh tenant a visit's evidence contract lists exterior 0/7; after seven accepted, finalized exterior captures it reads satisfied; a rejected/quarantined version is refused at binding (SQLSTATE 23514); the bindings and their versions are readable after the visit converts.
- **Unverified:** Whether the tenant capture-policy writer is reachable from any administration screen — no web consumer found.

### P1-28 #13 "Dashboard photo showing odometer, SOC for EV/hybrid, fuel where applicable, visible warning lights" — Owner requirement · **Delivered**

> a dashboard image

- **Normalised behaviour:** A visit holds an accepted dashboard photograph evidencing the odometer (and state of charge / warning lamps where applicable), bound to the visit and readable alongside the odometer value that was recorded.
- **Existing evidence:** reception-capture.ts:19-21 (dashboard_odometer, ev_soc, warning_lamp → category reception_dashboard, :64-66), baseline minCount 1 each (:96-98); seeds/05_shared_reference.sql:42 (reception_dashboard category); same binding/guard chain as row 12; en.json:1354-1356 labels; apps/web/src/features/receptions/components/steps/ReadingsStep.tsx:26-75 (odometer recorded through veh.vehicle-odometer-record from the wizard) and WarningLightsStep.tsx.
- **Remaining gap:** RMC-09 still open: veh.odometer_readings has no document/evidence column (live columns: id, tenant_id, vehicle_id, value, unit, value_km, observed_at, capture_method, correction_of, correction_reason, anomaly_flag, correlation_id, recorded_by, seq) and apps/api/src/app/api/v1/vehicles/[vehicleId]/odometer-readings/route.ts:37-40 accepts no document — the photograph binds to the VISIT, never to the reading it evidences. ev_soc/fuel remain immutable after create (RMC-10; ReadingsStep.tsx:60-70).
- **Owning module:** api: modules/reception, modules/vehicle (vehicle-odometer); schema: rec.reception_evidence_bindings, veh.odometer_readings.
- **Delivery placement:** Delivered by P1-28. The reading↔photo association is a P1-17-owned schema decision (RMC-09) and is a prerequisite of the odometer-extraction line H-7; sequence it on the vehicle Backend lane before the extraction slice.
- **Dependencies:** RMC-09 decision (add an evidence reference on the reading OR rule that the visit binding suffices).
- **Acceptance criteria:** A dashboard capture finalizes against dashboard_odometer; the visit contract shows 1/1; the reading recorded in the same wizard is visible in veh.vehicle-odometer-history with capture_method reception.
- **Unverified:** Whether any screen renders the dashboard image beside the reading — no image viewer exists in apps/web (see H-13).

### P1-28 #14 "VIN / chassis photo on first visit, or when existing evidence is missing or unreadable" — Owner requirement · **Planned**

> first-visit VIN evidence

- **Normalised behaviour:** A VIN/chassis photograph is required on a vehicle's first visit and again only when no readable VIN evidence exists for the vehicle; a capture judged unreadable is recorded as such rather than counted.
- **Existing evidence:** reception-capture.ts:22 ('vin' → reception_vin, :67), baseline minCount 1 on every visit (:99); migration 20260815100000:198, :214-216 (quality_status readable|unreadable, permitted ONLY for requirement 'vin'); seeds:43 (reception_vin, link purpose identity_document); evidence-bindings/route.ts:47-56 (CreateBody accepts qualityStatus); en.json:1357 'VIN plate'; MediaStep renders the requirement like any other.
- **Remaining gap:** (a) No first-visit conditionality: the baseline asks for a VIN photo on EVERY visit and nothing reads the vehicle's prior visits' finalized vin bindings (grep first-visit/prior VIN in reception-capture-service.ts: none). (b) The web never sends qualityStatus — apps/web/src/features/receptions/evidence-capture.ts bindEvidence call passes requirementCode/documentId/documentVersionId/deviceCapturedAt only — so 'unreadable' is unreachable from the product. (c) A tenant can only lower min_count to 0 globally via capture policy, not make it conditional.
- **Owning module:** api: modules/reception (reception-capture-service read model); schema: rec.reception_evidence_bindings (+ a per-vehicle 'has readable VIN evidence' read); web: features/receptions MediaStep.
- **Delivery placement:** P1-28 corrective slice (Frontend + reception read-model), sequenced with H-5/H-7 because the readable/unreadable judgement is the same step the extraction confirm will surface.
- **Dependencies:** Row 12 chain; an 'existing readable VIN evidence for this vehicle' read (reception module, uses bindings→visit→vehicle); H-10 (poor-image handling).
- **Acceptance criteria:** Second visit of a vehicle with a finalized readable vin binding shows the VIN requirement as not required (or 0/0) with the reason; marking a capture unreadable stores quality_status='unreadable' and does not count toward satisfied; first visit still demands 1.
- **Unverified:** None beyond the absence of a prior-visit read (asserted from grep).

### P1-28 #11 "Capture reception condition" + P1-27 #23 "Odometer history" — Owner requirement · **Delivered**

> odometer/fuel/SOC/warning lights

- **Normalised behaviour:** At check-in the odometer reading (value, unit, observed time), fuel level, EV state of charge and observed warning lamps are recorded against the visit/vehicle with catalogue-coded values, and the odometer joins the vehicle's append-only history.
- **Existing evidence:** ReadingsStep.tsx:26-75 (odometer via veh.vehicle-odometer-record / -history, permission veh.vehicle.odometer.record; fuel and SOC read back from rec.reception-create fields); odometer route :37-40 (value, unit km|mi, observedAt, captureMethod), :47-66 (veh.vehicle-odometer-history on veh.vehicle.read; record on veh.vehicle.odometer.record); migration 20260720101000:53-104 (append-only, value_km generated, capture_method reception|delivery|manual|correction); rec.catalogue-warning-light-code-create/-list/-update/-status-set and rec.catalogue-fuel-level-* now exist (RMC-11 contract closed; live rec.warning_light_codes = 0 rows by the no-fake-data policy); WarningLightsStep.tsx; workflow doc Step 4 :356 (visit accepts odometer, fuel, SOC).
- **Remaining gap:** RMC-10: ev_soc_percent / fuel_level_id / odometer_reading_id are frozen by tg_reception_visits_immutable and no rec.* operation amends them (ReadingsStep.tsx:60-70) — a mis-keyed SOC has no evidenced correction path. Warning-lamp and fuel catalogues are tenant inputs (0 rows) and their administration screen in the web is UNVERIFIED.
- **Owning module:** api: modules/reception, modules/vehicle; schema: rec.reception_visits, rec.warning_light_observations, rec.warning_light_codes, rec.fuel_levels, veh.odometer_readings; web: features/receptions ReadingsStep/WarningLightsStep.
- **Delivery placement:** Delivered by P1-27/P1-28. The SOC/fuel correction path (RMC-10) is P1-18-owned Backend follow-on; catalogue content is a tenant/Owner input, not code.
- **Dependencies:** Tenant-populated warning-light and fuel-level catalogues; RMC-10 decision.
- **Acceptance criteria:** A reading recorded at check-in appears in the vehicle's odometer history with capture_method reception; a lower normal reading is refused (23514) with the correction route named; a warning-lamp observation records against a tenant-created code.
- **Unverified:** Existence of a web administration screen for rec.catalogue-warning-light-code-* and fuel levels.

### P1-28 #16 "Conditional road test" / #19 "Unsafe-to-road-test outcome" — Owner requirement · **Blocked**

> the road-test outcome including unsafe-to-test

- **Normalised behaviour:** A road test, when warranted, is recorded as its own event with driver, start/end, observations and a coded outcome that includes 'not performed — unsafe to test' with a reason, and the record is part of the vehicle's history.
- **Existing evidence:** None as a contract. apps/web/src/features/receptions/components/steps/InspectionStep.tsx:85-87, 436-439 renders data-testid road-test-absent ('WF-10 is open and no road-test contract exists'); docs/product/workshop/inspection-and-diagnostics.md:329-349 (§4.5 — status vocabulary draft|in_progress|completed|cancelled has no 'unsafe'; only a free-text notApplicableReason on a checklist item), :831-832 (INS-04 no road-test record, INS-05 no coded unsafe outcome); vehicle-history-model.md:539-561, :993 (VHM-11); end-to-end-workshop-workflow.md:440-462 (Step 8 ABSENT, WF-10), :1221 (mandatory/conditional/discretionary not established). Since P1-29, a tenant CAN author a diagnostic template item labelled road test (docs/phase-1/phase-1-29/w9-acceptance-record.md:150 'road_test (boolean, optional)') — but that is a job-level checklist answer, not a reception-time record and not a coded outcome.
- **Remaining gap:** Whole capability: no table, no operation, no permission, no reception-time placement (diagnostics hang off a job which exists only after conversion — workflow :437). Owner decisions outstanding: placement (reception vs job), whether first-class record vs template item, mandatory/conditional.
- **Owning module:** api: modules/reception (if reception-time) or modules/diagnostics (if job-time); schema: rec or dia (new table); web: features/receptions InspectionStep or features/diagnostics.
- **Delivery placement:** Backend prerequisite on the P1-18/P1-19 lane, then a P1-28 corrective slice (reception-time) — the register owns it under P1-28 rows 16–21; it cannot be placed in P1-30 or P1-31. Sequence before the Integration gate because Step 8 is on the journey.
- **Dependencies:** Owner decision on placement and on first-class vs checklist (WF-10, INS-04, INS-05); the odometer 'road_test' capture reason (INS-06) if adopted.
- **Acceptance criteria:** A visit (or job) can record a road test with an outcome from a closed vocabulary that includes an unsafe-to-test value and a reason; the unsafe outcome is countable in a read; the reception InspectionStep no longer renders road-test-absent.
- **Unverified:** None.

### P1-28 #26 "Separate customer statement, technical observation and confirmed diagnosis" — Owner requirement · **Delivered**

> separation of customer statement, technical observation, and confirmed diagnosis

- **Normalised behaviour:** A customer's reported concern, a staff condition observation and a technician's verified finding are three distinct records with distinct vocabularies and permissions, and every customer concern is labelled 'Not yet technically verified' until a verification record exists.
- **Existing evidence:** end-to-end-workshop-workflow.md:235-274 (§4: rec.complaints/rec.complaint_details vs rec.condition_items vs dia.findings, different writers and permissions); inspection-and-diagnostics.md:548-564 (§7.1 mandatory labels); web: ComplaintsStep.tsx:40, 158-162 (data-testid complaint-unverified, key receptions.evidence.notTechnicallyVerified), InspectionStep.tsx:50, 270 (staffObservationNote), SummaryStep.tsx:85, 191 (notVerified); backend rec.reception-condition-evidence (kind complaint|inspection|condition_item…) and dia.diagnostic-finding-record (P1-29 diagnostics feature apps/web/src/features/diagnostics).
- **Remaining gap:** WF-05: dia.findings carries no reference to rec.complaints and no operation associates them (workflow :267-274), so the 'Not yet technically verified' label can never be lifted by a verification and no read shows concern→observation→diagnosis side by side.
- **Owning module:** api: modules/reception, modules/diagnostics; schema: rec.complaints, rec.condition_items, dia.findings; web: features/receptions, features/diagnostics.
- **Delivery placement:** Delivered (P1-28 + P1-29). The verification link is line H-3.
- **Dependencies:** None for the separation; H-3 for lifting the label.
- **Acceptance criteria:** A complaint written with kind complaint appears with the unverified label in both languages; a condition item written by staff never appears as a complaint; a diagnostic finding cannot be created from the reception surface.
- **Unverified:** None.

### OWR-2026-09-06-H-3 — Proposed implementation policy · **Blocked**

> (derived from) separation of customer statement, technical observation, and confirmed diagnosis

- **Normalised behaviour:** A diagnostic finding may cite the customer complaint it verifies (append-only link, never an edit of the complaint), and reads on the work order and vehicle history present the complaint, the reception observation and the verifying finding together with the label lifted only where such a link exists.
- **Existing evidence:** None — end-to-end-workshop-workflow.md:267-274 (WF-05: no column, the only nearby link is wo.additional_work_requests.originating_finding_id pointing the other way); inspection-and-diagnostics.md:559-563 (the original words remain on file unaltered).
- **Remaining gap:** Schema (dia.findings → rec.complaints soft/hard link), a write on dia.diagnostic-finding-record, and a read that joins them.
- **Owning module:** api: modules/diagnostics (write), modules/reception or work-order read model; schema: dia.findings (+ link) ; web: features/diagnostics, features/work-orders.
- **Delivery placement:** Backend lane (P1-19 diagnostics owner) then the Integration gate's cross-domain history read — P1-29 is closed and this is a cross-record read.
- **Dependencies:** P1-28 #26 delivered records; the cross-phase three-histories requirement (register lines 294-311).
- **Acceptance criteria:** Recording a finding with a complaint reference stores the link; the complaint row is byte-identical afterwards; the work-order detail shows the complaint with 'verified by finding …'; a complaint with no link still shows 'Not yet technically verified'.
- **Unverified:** None.

### P1-27 "one customer may have multiple vehicles" / P1-28 #3 "Show the customer's vehicles" + #4 — Owner requirement · **Delivered**

> Preserve customer-to-multiple-vehicles relationships

- **Normalised behaviour:** A customer may be related to any number of vehicles, the relationship is readable from both sides, and a reception or appointment starts by selecting one of that customer's vehicles explicitly.
- **Existing evidence:** apps/api/src/app/api/v1/customers/[customerId]/vehicles/route.ts:41-47 (crm.vehicle-link POST, crm.customer.vehicle.manage) and :81-97 (crm.customer-vehicle-list GET, crm.customer.read — added for P1-27-INT-012); web consumers apps/web/src/features/receptions/components/CheckInStartScreen.tsx:32 and apps/web/src/features/appointments/components/AppointmentBookingScreen.tsx:21, 60, 423 (listCustomerVehicles); register :123-138 (relationship read from the vehicle side delivered in P1-27).
- **Remaining gap:** None found. Register row 3 still reads Blocked INT-012 (owner-workflow-requirements.md:151) — stale, see H-2.
- **Owning module:** api: modules/crm, modules/vehicle; schema: veh.vehicle_relationships; web: features/receptions, features/appointments, features/crm.
- **Delivery placement:** Delivered (P1-27 write/vehicle-side read; P1-28 customer-side read and selection).
- **Dependencies:** None.
- **Acceptance criteria:** A customer linked to two vehicles sees both in the check-in start screen and must pick one; the GET refuses cross-tenant ids; the register row reads Delivered.
- **Unverified:** None.

### P1-29 table + P1-30 table (rows "Customer approval", "Part issue", "Progressive work logging", "Final QA checklist"/"Rework", "Invoice", "Payment state") — Owner requirement · **Blocked**

> and the linked work-order journey through approvals, parts, work, QC/rework, billing, payment

- **Normalised behaviour:** From a converted reception, one work order carries approvals, part issues, work logging, QC and rework, invoicing and payment as linked records reachable from the work order, and the whole chain can be exercised on a fresh organisation.
- **Existing evidence:** Operations present on develop: rec.reception-convert-to-work-order; wo.* (38 ops incl. wo.additional-work-approval, wo.job-work-log-record, wo.job-evidence-record, wo.work-order-closure-eligibility, wo.work-order-timeline); quo.* 10; inv.* 17; qms.* 15 (qc-record-open/finalize, rework-create/sign-off, reopen-attempt); sal.* 20 (invoice, payment); route tree apps/api/src/app/api/v1/work-orders/[workOrderId]/{additional-work,closure,closure-eligibility,evidence,invoice,invoice-preview,jobs,part-issues,quality-controls,quotations,required-parts,rework,service-lines,timeline,transition}; web features: work-orders, diagnostics, technicians, quality, quotations, inventory, billing, payments (apps/web/src/features/*). P1-29 closed 2026-09-03 (docs/phase-1/phase-1-29/closure-record.md); P1-30 W1–W7 merged and protected-verified (memory: PRs #314–#320), W8/W9 not yet taken.
- **Remaining gap:** The end-to-end journey on a fresh tenant is blocked by F-02: eleven master-data tables in the commercial chain have no in-product writer (docs/phase-1/phase-1-30/tenant-bootstrap-corrective-slice.md:124-146 — no service category/version writer, no price-list assignment, no item/location writer), so no quotation line, part issue or invoice line can be produced without direct SQL; P1-30 Owner acceptance (W9) is outstanding; the three histories remain sectioned (INT-043/WF-19).
- **Owning module:** api: modules/work-order, quotation, inventory, quality, sales(billing); schemas wo, quo, inv, qms, sal; web: the seven feature areas above.
- **Delivery placement:** P1-30 corrective (F-02 writers, Backend lane remediation/p1-30-backend-*) then the Integration gate for the linked proof — the register assigns the end-to-end proof to the Integration gate.
- **Dependencies:** F-02 Owner decision (which phase writes the eleven tables); P1-30 W9 acceptance; H-3/WF-19 for a unified history.
- **Acceptance criteria:** On a fresh organisation an operator can convert a reception, approve additional work, issue a part, log work, pass QC (or fail→rework→pass), issue an invoice and record a payment, with each record reachable from the work-order detail and timeline.
- **Unverified:** Current P1-30 W-item closure states were taken from session memory, not re-derived from docs/phase-1/phase-1-30 in this pass.

### P1-31 "Customer handover" / "Payment / delivery-policy verification" / "Warranty" — Owner requirement · **Contracted**

> authorized delivery, and warranty

- **Normalised behaviour:** A vehicle is released only to a verified authorised receiver after the delivery policy (payment/QC) passes, the custody chain is released exactly once, and a warranty record is issued at delivery and readable afterwards.
- **Existing evidence:** Backend only: sal.delivery-create, sal.delivery-eligibility-read (apps/api/src/app/api/v1/deliveries/[deliveryId]/eligibility/route.ts:52 'with every blocking reason'), sal.delivery-receiver-verify, sal.delivery-checklist-record, sal.delivery-signature-attach, sal.delivery-complete; wty.warranty-generate, wty.warranty-detail; tables sal.delivery_records, sal.authorized_receivers, sal.delivery_signatures, wty.warranty_records; rec.custody_history release + uq_custody_history_released (workflow :199-207). No apps/web/src/features/delivery or warranty directory exists; navigation.ts:410-411 gates /delivery on sal.delivery.read.
- **Remaining gap:** Entire Frontend; delivery evidence/media category does not exist (P1-OD-025 resolved for reception evidence only — P1-28 canonical-plan.md:255-262).
- **Owning module:** api: modules/sales (delivery), modules/warranty; schema sal, wty; web: (to be created) features/delivery, features/warranty.
- **Delivery placement:** P1-31 — the register's owner for Delivery and Warranty Frontend.
- **Dependencies:** P1-30 payment state; QC pass (P1-29/P1-31); delivery media category decision (P1-OD-025 remainder).
- **Acceptance criteria:** Delivery cannot complete while eligibility lists a blocking reason; completing writes the custody release once; a warranty record exists and is readable from the vehicle/work order after delivery.
- **Unverified:** None.

### OWR-2026-09-06-H-4 — Owner requirement · **Planned**

> Give each role a clear next action and explain missing prerequisites.

- **Normalised behaviour:** For every role (reception, technician, QC, service adviser/finance, delivery) the product shows what that person should do next on each record and, where an action is withheld, states which prerequisite or permission is missing rather than hiding or greying the control.
- **Existing evidence:** Partial, per screen: apps/web/src/features/quality/components/WorkOrderClosureScreen.tsx:9-11, 212-222 (closure gate panel from wo.work-order-closure-eligibility incl. deferred conditions; 'No closing state is reachable…' seen in P1-29 W9 acceptance :117); deliveries eligibility read :52 ('every blocking reason'); apps/web/src/features/work-orders/api.ts:109 (reachable states on work-order detail); MediaStep.tsx (overrideWithheld reason when rec.reception.evidence.override is not held; capture states in words); ReadingsStep.tsx:271 (readOnly reason); technicians/me workspace (navigation.ts:250-263); docs/phase-1/phase-1-28/operator-guide.md:255-257 (approval needs its own permission).
- **Remaining gap:** No role-oriented 'my next actions' surface or inbox; prerequisite explanations are per-screen and phase-local, not consistent across the journey; the reception→work-order→QC→billing→delivery handoffs are not surfaced as a single 'what is owed next'. Also a session finding not recorded in the repository: several navigation gates are unreachable by the first administrator's permission bundle (recorded in session memory only) — a role that cannot reach a screen cannot be told its next action there.
- **Owning module:** web: shell/navigation (apps/web/src/config/navigation.ts), each feature's detail screens; api read models that publish eligibility (wo, sal, rec capture contract).
- **Delivery placement:** Integration gate as a cross-phase UX requirement (the register gives the end-to-end journey to the gate), with P1-31 delivering the delivery-role half and each corrective slice keeping the per-screen 'withheld with reason' rule.
- **Dependencies:** Role/permission bundle decision (administrator bundle and navigation reachability); eligibility reads exist for closure and delivery, absent for reception approval (media precondition, RMC-14) and quotation approval.
- **Acceptance criteria:** For each role account in the acceptance tenant, every detail screen shows either the next available action or a sentence naming the missing prerequisite/permission; no disabled control without a stated reason; the navigation shows every gate the role's bundle grants.
- **Unverified:** Whether a role home/inbox is specified in the out-of-Git canonical plan (RootLco_Phase_1_Development_Plan) — not readable here.

### OWR-2026-09-06-H-5 — Owner requirement · **Planned**

> The Owner now explicitly requires camera capture within the web application

- **Normalised behaviour:** From the reception evidence step an operator on a camera-equipped device can take the photograph inside the web application (not only choose an existing file), and the captured image enters the same authorize→store→scan→link→bind→finalize chain.
- **Existing evidence:** None. The shipped control is a plain <input type="file"> with no capture attribute and no accept list unless the server's list is passed (apps/web/src/features/receptions/components/CaptureFileField.tsx:60-68); the bytes cross to a Server Action which performs the object PUT server-side (apps/web/src/features/attachments/api.ts:31-56, 269-274; evidence-capture.ts:96-200). A camera path is EXPLICITLY BANNED in the reception tree: apps/web/tests/p1-28-reception-media.test.ts:68-72 ('No camera path is sanctioned') and :897-915 (regex getUserMedia|getDisplayMedia|mediaDevices|ImageCapture|MediaStream|capture=|<video|<canvas asserted absent from every reception file); docs/phase-1/phase-1-28/media-capture-decision-record.md:90-100 (§2.1 'A file input, drag target or camera control — absent') and :160-168 (the P1-27 gate covers no camera construct). grep getUserMedia/ImageCapture/tesseract/ocr across apps/web/src and apps/api/src: no matches.
- **Remaining gap:** The whole camera path, and the deliberate reversal of the test ban under this Owner direction; CSP img-src is 'self' data: only (apps/web/src/lib/security/csp.ts:156) so a blob: preview would be blocked; Permissions-Policy for camera UNVERIFIED; device policy (which devices/browsers at the desk) not established.
- **Owning module:** web: features/receptions (MediaStep, CaptureFileField), features/attachments; apps/web/tests (ban → sanctioned allowance); lib/security/csp.ts. No api change required for the minimal path.
- **Delivery placement:** Named follow-on: P1-28 corrective slice 'reception camera capture' — Frontend-only, owned by the closed P1-28 (the register forbids moving it into P1-30, whose canonical plan §2 excludes reception, or P1-31); sequence before the Integration gate.
- **Dependencies:** Owner direction (given here; supersedes the P1-28 exclusion); H-6 approach; CSP/Permissions-Policy change; the seven seeded reception categories and the running store/scanner (P1-OD-025 resolved for reception evidence).
- **Acceptance criteria:** On a device with a camera the evidence step offers 'Take photo' for each requirement; the capture reaches finalized without the browser holding a storage credential; the reception-media test suite has an explicit sanctioned camera allowance replacing the ban; desktop without a camera still offers the file chooser.
- **Unverified:** Permissions-Policy/camera headers anywhere in apps/web (only csp.ts and proxy.ts were grepped).

### OWR-2026-09-06-H-6 — Proposed implementation policy · **Planned**

> (derived from) camera capture within the web application

- **Normalised behaviour:** Camera capture is added through the single sanctioned capture component: first by the `capture="environment"` attribute plus the server-published accept list on CaptureFileField (no bytes handled in browser JS, no new upload path), and a live getUserMedia preview is admitted only as a second, explicitly sanctioned path with the same Server Action boundary.
- **Existing evidence:** CaptureFileField.tsx:7-25 (one sanctioned input, FILE_INPUT_ALLOW holds exactly one entry), :40-49 (accept only ever the server's list); test :364-367 and :405 (both capture steps must render the shared field); attachments api.ts:31-56 (why the browser never PUTs to storage); shared.document_versions.captured_at as a device claim (supabase/migrations/20260815090000_shared_reception_evidence_foundation.sql:100-101, grant :190; evidence-capture.ts derives it from file.lastModified).
- **Remaining gap:** Implementation and the test/gate change; captured_at semantics for a live camera capture (device time is then the capture instant, not lastModified).
- **Owning module:** web: features/receptions/components/CaptureFileField.tsx, MediaStep.tsx, SignatureStep.tsx; apps/web/tests/p1-28-reception-media.test.ts; scripts/ci/check-p1-27-frontend.mjs gate rules (rule count is a published marker — change under its own record).
- **Delivery placement:** Same P1-28 corrective slice as H-5.
- **Dependencies:** H-5; Owner confirmation that the P1-27 gate's rule count may change (it is a published document marker per media-capture-decision-record.md:160-168).
- **Acceptance criteria:** The rendered input carries capture and the server's accept list; a planted getUserMedia outside the sanctioned file fails the suite; the sanctioned path passes; bytes still cross only via the Server Action.
- **Unverified:** Behaviour of the capture attribute on the pilot devices (not established).

### OWR-2026-09-06-H-7 — Owner requirement · **Undecided**

> and assisted extraction of VIN and odometer values

- **Normalised behaviour:** After a VIN-plate or dashboard photograph is captured, the product proposes the VIN and/or odometer value read from the image as a candidate for staff to confirm; the candidate never writes the vehicle or the reading by itself.
- **Existing evidence:** None — no OCR, barcode or text-recognition code in apps/web/src or apps/api/src (grep tesseract, ocr, BarcodeDetector, ImageCapture: none); no provider port for extraction under apps/api/src/modules/shared-services/provider (only storage, message). Related inputs exist: the VIN photo category reception_vin and dashboard category, the immutable version the extraction would read (shared.document_versions), veh.vehicle-odometer-record and veh.vehicle-update (accepts vin, apps/api/src/modules/vehicle/domain/vehicle-write.ts:196-199) as the confirm-time writers.
- **Remaining gap:** Entire capability plus the design decision: on-device (browser library) vs server-side provider; provider selection is a commercial decision the Owner must take (the register's provider rule for the vehicle catalogue — server-side, licensed, cached, source-attributed, provider-abstracted, never a third-party API from the browser — is the closest standing policy, owner-workflow-requirements.md:336-338).
- **Owning module:** api: modules/shared-services (new extraction port + provider adapter), modules/reception (candidate read/write), modules/vehicle (confirm writers); schema: new candidate table (see H-9); web: features/receptions MediaStep/ReadingsStep, features/vehicles.
- **Delivery placement:** Backend prerequisites on the shared-services/reception lanes, then the P1-28 corrective slice for the confirm UI; not startable until the Owner decides approach/provider.
- **Dependencies:** Owner decision: approach and provider (commercial); H-9 candidate record; P1-27 #20 VIN verification (H-11); RMC-09 reading↔photo association; H-5 camera.
- **Acceptance criteria:** Capturing a VIN plate yields a candidate shown beside the image with a confidence indicator; confirming writes through the existing operations and their guards; nothing is written without confirmation; with the provider unavailable the manual path works unchanged.
- **Unverified:** Whether the out-of-Git canonical plan already names an OCR provider or budget.

### OWR-2026-09-06-H-8 — Proposed implementation policy · **Undecided**

> (derived from) assisted extraction of VIN and odometer values

- **Normalised behaviour:** Extraction runs server-side behind a provider-abstracted port reading the accepted document version from the store (never from the browser to a third-party API), returns candidates with confidence and raw text, and is recorded as an audited, tenant-scoped operation; on-device recognition, if ever used, still submits its candidate through the same server record.
- **Existing evidence:** Precedent only: owner-workflow-requirements.md:336-338 (catalogue provider rule); storage port contract and no-credential-in-browser rule (attachments api.ts:31-56; reception-media-checklist.md §5.6); scanner handoff pattern shared.begin_document_scan / complete_document_scan (migration 20260815090000:195-258) as the model for a server-side read of an accepted version.
- **Remaining gap:** Port, adapter, operation, permission code, audit action, rate-limit policy; provider evaluation (recommendation only — no purchase asserted).
- **Owning module:** api: modules/shared-services/provider (new extraction-provider port), modules/reception application; seeds/04_iam_permission_catalog.sql (new code); schema: candidate table (H-9).
- **Delivery placement:** Backend lane, after the Owner's approach/provider decision; before the H-7 UI.
- **Dependencies:** H-7 decision; STORAGE provider configured (already true for the acceptance launcher per media-decision.ts:24-37).
- **Acceptance criteria:** The browser never contacts a recognition provider; a candidate row cites the document_version_id it was read from; the operation refuses cross-tenant versions; provider outage yields a named refusal and the manual path.
- **Unverified:** None.

### OWR-2026-09-06-H-9 — Owner requirement · **Planned**

> Preserve the original image and extracted candidate

- **Normalised behaviour:** The photographed image is kept as an immutable, checksummed version and every extracted candidate (raw text, parsed value, unit, confidence, source version, actor, time, and the value finally confirmed or corrected) is kept as its own append-only record linked to that version.
- **Existing evidence:** Original image: Delivered — shared.document_versions is append-only with sha256, terminal rows immutable, only status is updatable and only by the scan handoff (migration 20260718101000; 20260815090000:104-105, 152-170); bindings name the exact version (evidence-bindings route.ts:6-11). Extracted candidate: none — no table under rec/shared/veh holds an extraction (live catalog: rec.reception_evidence_bindings columns are id…quality_status, finalized__, created__; veh.vin_verifications holds vin_checked/check_kind/result/override_reason only).
- **Remaining gap:** A candidate table + operation; the confirmed/corrected value must be recorded WITH the candidate so a later dispute can compare what the image said, what the machine read and what staff entered.
- **Owning module:** schema: new rec (or shared) extraction-candidate table with FK to shared.document_versions and to the visit; api: modules/reception; web: features/receptions.
- **Delivery placement:** Backend lane (P1-18 reception owner, with P1-15 shared-services for the version FK) ahead of the H-7 UI; migration count moves — pins in the schema baseline must move with it.
- **Dependencies:** H-7/H-8; the six new-migration pins (memory: schema baseline pins three values that move together).
- **Acceptance criteria:** After confirm, the candidate row, the accepted value and the version id are all readable; the version's sha256 is unchanged; deleting or editing a candidate is refused (no UPDATE/DELETE grant).
- **Unverified:** Whether shared.file_scan_results or an existing audit detail could carry candidates without a new table — assessed as no.

### P1-27 #20 "VIN validation within the approved contract" (RMC-17 / WF-04) — Owner requirement · **Blocked**

> validate against applicable identifier rules

- **Normalised behaviour:** A candidate or typed VIN is checked against the rules that apply to it (17-character form, disallowed characters, check digit where the VIN is a standard one), the result is recorded, and a non-standard identifier can be accepted only through an attributable manual override.
- **Existing evidence:** Normalisation only: supabase/migrations/20260720090000_veh_normalization.sql:17-21, 43-60 (veh.normalize_vin uppercases and strips separators, deliberately preserves I/O/Q — 'never silently corrects'; format/checksum validation is a distinct concern for veh.vin_verifications); active-VIN uniqueness (vehicle-write.ts:7, 12-14); vehicle create/update accept any raw string up to 64 chars (vehicle-write.ts:26-28, 161-162, 196-199; vehicles/route.ts:98). The verification table exists — supabase/migrations/20260720094000_veh_vin_verifications.sql:37-83 (check_kind checksum|format|manual|external, result passed|failed|overridden, override_reason, INSERT policy for app_runtime :83) — but is referenced by no TypeScript file and no seed (grep), live row count 0; reception-media-checklist.md:146-147 (RMC-17) and workflow :339 confirm no operation, no check-digit routine, no override policy, no permission code.
- **Remaining gap:** Verification operation + permission code + rule set + override authority; then surfacing the verdict on the confirm step (H-12) and on the vehicle profile.
- **Owning module:** api: modules/vehicle (domain rule + application), route under /vehicles/{vehicleId}/vin-verifications; schema veh.vin_verifications (exists); seeds/04 permission code; web: features/vehicles, features/receptions.
- **Delivery placement:** Backend lane (P1-17 vehicle owner) before the extraction UI; the P1-27 register row is the owner.
- **Dependencies:** Owner decision: which rule set is 'applicable' (standard 17-char with check digit vs. imported/older/no-standard-VIN vehicles where the catalogue register makes manual fallback mandatory, owner-workflow-requirements.md:329-331) and who may override.
- **Acceptance criteria:** A 17-char VIN with a bad check digit records result failed; I/O/Q in a standard VIN is flagged, not corrected; a manual override records override_reason and the actor; a vehicle can still be created with a non-standard identifier via override.
- **Unverified:** None.

### P1-27 #23 "Odometer history" (candidate comparison) — Owner requirement · **Delivered**

> and odometer history

- **Normalised behaviour:** A candidate odometer value is compared with the vehicle's effective odometer before it is recorded: a lower value is refused as a normal reading and can only be entered as a reasoned correction; the comparison and the prior value are shown to staff before confirmation.
- **Existing evidence:** DB guard: supabase/migrations/20260720101000_veh_odometer_readings.sql:144-210 (veh.guard_odometer_reading locks the vehicle, refuses a normal reading below max value_km with 23514 'use a correction'; corrections may lower with correction_reason from a closed list, anomaly_flag set by the platform — vehicle-history-model.md:333-355); read: veh.vehicle-odometer-history (odometer route :47-52); web: ReadingsStep.tsx:160-210 renders the history and the record form; unit explicit km|mi stored verbatim with generated value_km.
- **Remaining gap:** The comparison happens only at insert (a refusal after submit); no pre-submit read of the effective odometer against a candidate; no plausibility rule beyond monotonicity (none stated by the Owner — none invented); the correction path is deliberately not on the intake step (ReadingsStep.tsx:55-58).
- **Owning module:** api: modules/vehicle (veh.latest_odometer exists, migration :243); web: features/receptions ReadingsStep + the H-7 confirm step.
- **Delivery placement:** Delivered at the data level (P1-27/P1-17); the candidate pre-check is part of the P1-28 corrective slice for H-7.
- **Dependencies:** H-7; RMC-09 (photo↔reading association).
- **Acceptance criteria:** Confirming a candidate below the effective odometer is refused before submission with the prior value shown and the correction route named; confirming a higher value records capture_method reception; a correction records reason and anomaly_flag true.
- **Unverified:** None.

### OWR-2026-09-06-H-10 — Owner requirement · **Planned**

> handle units/ambiguous characters/poor images

- **Normalised behaviour:** The extraction flow makes the odometer unit an explicit staff confirmation, presents ambiguous VIN characters (0/O, 1/I, Q) as unresolved positions rather than auto-correcting them, and records a poor/unreadable image as such with a retake path instead of a guess.
- **Existing evidence:** Foundations only: unit is a required explicit field (odometer route :38; migration :86 ck unit km|mi); veh.normalize_vin never rewrites I/O/Q (normalization migration :17-21); quality_status readable|unreadable exists for VIN bindings only (migration 20260815100000:214-216) and the web never sets it (evidence-capture.ts bindEvidence call carries no qualityStatus); MediaStep states capture outcomes in words (capturedTerminal etc.).
- **Remaining gap:** No candidate confidence/ambiguity representation; unreadable not reachable from the product; no retake affordance tied to a quality verdict; unreadable is not permitted for dashboard captures (constraint restricts it to vin).
- **Owning module:** schema: rec.reception_evidence_bindings.quality_status (extend to dashboard requirements) + candidate table (H-9); api: modules/reception; web: features/receptions.
- **Delivery placement:** P1-28 corrective slice (with H-7), schema change on the reception Backend lane.
- **Dependencies:** H-7/H-8/H-9; H-14 (a viewer, so staff can see the image they are judging).
- **Acceptance criteria:** An operator can mark a capture unreadable for vin and dashboard requirements and it does not count; ambiguous VIN positions are highlighted and must be resolved by staff; the unit is never inferred from the image alone.
- **Unverified:** None.

### OWR-2026-09-06-H-11 — Owner requirement · **Planned**

> and let staff confirm or correct.

- **Normalised behaviour:** Every extracted candidate is presented for explicit confirmation or correction by the operator, and the confirmed or corrected value is written through the existing vehicle/odometer operations so their permissions and guards apply, with the choice recorded against the candidate.
- **Existing evidence:** Writers exist: veh.vehicle-odometer-record (veh.vehicle.odometer.record) and veh.vehicle-update accepting vin under veh.vehicle.manage (vehicle-write.ts:196-199); corrections via capture_method correction on the vehicle profile (ReadingsStep.tsx:55-58, 277-282); a confirm step over a candidate: none.
- **Remaining gap:** The confirm/correct UI and the candidate outcome record (accepted-as-read vs corrected, by whom).
- **Owning module:** web: features/receptions (MediaStep/ReadingsStep), features/vehicles; api: modules/reception (candidate outcome), modules/vehicle (unchanged writers).
- **Delivery placement:** P1-28 corrective slice, after H-9 lands.
- **Dependencies:** H-7, H-9, P1-27 #20 verification verdict, P1-27 #23 comparison.
- **Acceptance criteria:** A candidate cannot be written without a confirm click; editing the value before confirm records 'corrected' with both values; an operator without veh.vehicle.manage sees the VIN candidate but the write is withheld with the reason.
- **Unverified:** None.

### OWR-2026-09-06-H-12 — Owner requirement · **Delivered**

> Provide manual fallback

- **Normalised behaviour:** Typing the VIN and the odometer reading by hand remains available on every device and whenever extraction is unavailable, refused or wrong, and produces the same records as an assisted capture.
- **Existing evidence:** Manual entry is the ONLY path today and is Owner-accepted: vehicle creation with VIN entry (P1-27, workflow :111), ReadingsStep.tsx:215-265 odometer form (value, unit, observedAt, captureMethod), walk-in intake; the catalogue register already makes manual fallback mandatory for identification (owner-workflow-requirements.md:329-331).
- **Remaining gap:** None today; the requirement becomes a non-regression constraint on H-5/H-7 (extraction must be assistive, never a precondition).
- **Owning module:** web: features/vehicles, features/receptions.
- **Delivery placement:** Delivered; carried as an acceptance criterion of the P1-28 corrective slice.
- **Dependencies:** None.
- **Acceptance criteria:** With the extraction provider unconfigured or refusing, a VIN and an odometer can still be recorded by hand from the same screens with no error other than the named unavailability notice.
- **Unverified:** None.

### OWR-2026-09-06-H-13 — Owner requirement · **Delivered**

> and secure tenant-scoped media access.

- **Normalised behaviour:** Reception media is stored and served only within the tenant: rows are tenant-isolated, the store key is server-built and carries no business data, the browser never holds a storage credential, and a file is retrievable only through a permission-gated, short-lived signed URL for an accepted version reachable via a live link.
- **Existing evidence:** RLS enabled with tenant predicates: supabase/migrations/20260718100000_shared_document_categories_and_documents.sql:233-250 (sel_documents_tenant), 20260718101000:197-206 (versions, scan results), 20260718102000:127-130 (links); reception capture tables FORCE RLS (20260815100000:796-887); storage key server-built, no business data (attachment-policy/storage-key.ts per checklist §5.6); browser never PUTs or holds a signed URL (attachments api.ts:31-56, 269-274); download only for accepted versions with TTL (download-authorizations/route.ts:4, 26-28; checklist §4.6 rows 1–6); real S3 adapter + scanner in place (modules/shared-services/provider/s3-storage-provider.ts; storage-round-trip.test.ts; media-decision.ts:24-37); shared.document.read seeded (seeds/04:83) and used by shared.document-version-read (:12-17) and shared.document-category-list (:9-14).
- **Remaining gap:** (a) No media VIEWER anywhere in the web — shared.attachment-download-authorize is registered only in apps/web/src/lib/api/idempotent-operations.ts and rendered by no screen (grep img/downloadUrl in features: none); the wizard shows version state words, never the image. (b) shared.document-read, shared.attachment-download-authorize and veh.vehicle-document-list are still gated on the WRITE code shared.document.manage (routes :22, :27, :32) — RMC-07 only half closed. (c) RMC-04 token mismatch persists: vehicle read asks 'veh.vehicle' (modules/vehicle/domain/vehicle-history.ts:22) while links accept 'veh.vehicles' (attachment-policy.ts:42-52). (d) /documents navigation entry is status planned (navigation.ts:422-430). (e) Whether reception media is restricted data needing iam.sensitive.view is not established (checklist §9).
- **Owning module:** api: modules/shared-services (attachment routes, policy), modules/vehicle (document list); schema shared.*; web: features/attachments, features/receptions.
- **Delivery placement:** Delivered for the storage/access chain (P1-15/P1-28). The viewer and re-gating are line H-14.
- **Dependencies:** None for the chain; H-14 for viewing.
- **Acceptance criteria:** A download authorisation for another tenant's document is refused; a pending/quarantined version cannot be downloaded (ERR-DOC-001); the browser network log shows no direct storage request during capture; keys contain no VIN/name/phone.
- **Unverified:** FORCE ROW LEVEL SECURITY on shared.documents/versions/links (checklist §4.6 asserts 'enabled and forced'; only ENABLE was seen in the three base migrations — a later migration may force it).

### OWR-2026-09-06-H-14 — Proposed implementation policy · **Planned**

> (derived from) secure tenant-scoped media access + let staff confirm or correct

- **Normalised behaviour:** A tenant-scoped media viewer (reception evidence gallery and per-binding preview) is built on shared.attachment-download-authorize, gated on shared.document.read; the two document reads and the vehicle document list are re-gated from shared.document.manage to shared.document.read, and the veh.vehicle/veh.vehicles token is reconciled with a test.
- **Existing evidence:** Contracts present (H-13 evidence); nav placeholder navigation.ts:422-430; reception-media-checklist.md:483-490 (RMC-06/07 required actions) and :486, :389-401 (RMC-04).
- **Remaining gap:** All of it; plus CSP img-src must admit the signed-URL origin or the server must proxy bytes (csp.ts:156 allows 'self' data: only).
- **Owning module:** api: attachments routes (permission re-gate), modules/vehicle/domain/vehicle-history.ts; web: features/attachments (viewer), features/receptions (gallery), lib/security/csp.ts.
- **Delivery placement:** Backend re-gate on the shared-services lane (P1-15 owner); viewer in the P1-28 corrective slice — required before staff can 'confirm' a candidate against the image they cannot currently see.
- **Dependencies:** Owner decision on restricted-data classification of reception media (iam.sensitive.view); CSP change.
- **Acceptance criteria:** An operator holding shared.document.read and rec.reception.read sees the visit's finalized photographs; one holding only rec.reception.read sees the binding list but no image; GET /vehicles/{id}/documents returns linked documents; the download URL expires.
- **Unverified:** None.

### OWR-2026-09-06-H-15 — Owner requirement · **Planned**

> Compare existing reception/media implementation with that requirement and record the remaining work; earlier capture exclusions do not remove this new direction.

- **Normalised behaviour:** The register records, line by line, what the shipped reception media capture does and does not do against camera capture and assisted extraction, and states that the P1-28 exclusion of camera constructs is superseded by this Owner direction.
- **Existing evidence:** This entry (lines H-5…H-14) is the comparison. The earlier exclusions being superseded: media-capture-decision-record.md:90-100 (§2.1 — no camera control, no disabled control), apps/web/tests/p1-28-reception-media.test.ts:68-72 and :897-915 (camera ban), CaptureFileField.tsx:60-68 (file chooser only). What is NOT superseded: the no-invented-media-limit and no-upload-path rules (canonical-plan.md:263-270) and the single-sanctioned-input rule — a camera path must still read its policy from the server.
- **Remaining gap:** Writing the comparison into the register and marking the P1-28 ban as superseded-by-Owner-direction in the decision record.
- **Owning module:** docs/product/owner-workflow-requirements.md; docs/phase-1/phase-1-28/media-capture-decision-record.md (provenance note).
- **Delivery placement:** Now, documentation-only, with H-1/H-2.
- **Dependencies:** H-1, H-2.
- **Acceptance criteria:** The register contains this area's lines with their statuses; the decision record carries a dated note that the camera exclusion is superseded by Owner direction 2026-09-06 and names the slice that lifts the ban.
- **Unverified:** None.

---

## Area I — AI integration and future ERP

**Where this area stands today.** Nothing in the repository integrates OpenAI, any other model provider, or OCR: a case-insensitive search of apps/ for openai|anthropic|llm|ocr|gpt returns zero hits, apps/api/package.json declares no AI SDK, and a read-only catalog query found no table or column named for OCR, LLM, prediction or confidence. Earlier phase records state the opposite boundary explicitly (OCR out of scope in P1-15, "no machine learning" in the P1-16/P1-17 gates, "Predictive diagnostics. Full HR." out of scope in P1-19), so the Owner's text is a new permission, not a confirmation of anything built. What does exist and is reusable is the provider-port discipline (identity, storage and message ports with an unconfigured default that refuses, env-selected adapters, secret and boundary gates), the "proposal, never a decision" pattern for third-party data (veh.vin_verifications, duplicate-candidate queues, the concern-versus-verified-finding rule), per-tenant feature flags and a typed rate-limit catalogue for usage limits, and the outbox worker for asynchronous calls. The Owner's rule that authorized commands and server arithmetic own stock, money, approvals and permissions is already a delivered, gate-enforced invariant; the only gap is that no gate yet forbids a future AI adapter from becoming a caller of those commands. Full accounting, HR and rewards are all follow-ons beyond Phase 1: sal.financial_events is documented as the future accounting integration point and expressly not a ledger, iam.user_employee_links still carries a placeholder comment promising an HR master that P1-9 explicitly did not build, and "rewards" appears nowhere in the repository. Every AI line therefore lands in an Owner-commissioned evaluation followed by a named follow-on, never in the P1-30 corrective lane, whose canonical plan excludes new Backend features and whose ownership gate is verified but path-based rather than topic-based.

### OWR-2026-09-06-AI-1 — Owner requirement · **Undecided**

> OpenAI API use is an allowed implementation option.

- **Normalised behaviour:** The platform MAY call the OpenAI API from the server for a named use case; the permission selects nothing, obliges nothing, and does not itself contract a provider, which remains a Product Owner commercial decision.
- **Existing evidence:** none — no integration, adapter, config key or dependency exists. apps/api/package.json dependencies (lines 24-36) are @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @supabase/ssr, @supabase/supabase-js, next, pg, pino, react, react-dom, sharp, zod. Grep of apps/ for openai|anthropic|llm|ocr|gpt (case-insensitive) returns no match. Read-only catalog query over information_schema.columns for ocr|llm|openai|model_output|confidence|ai_ returns only wo.additional_work_requests.fulfillment_state (a substring hit, unrelated). Prior records state the opposite boundary: docs/phase-1/phase-1-15/phase-1-15-initial-audit.md:172 lists OCR as out of scope; docs/phase-1/phase-1-16/phase-1-16-owner-gate.md:176 and docs/phase-1/phase-1-17/README.md:199 say duplicate scoring is deterministic with no machine learning; docs/phase-1/phase-1-19/README.md:155 lists 'Predictive diagnostics' as out of scope. The standing rule for any paid external provider: docs/product/README.md §0.1 (lines 31-45) and docs/product/workshop/end-to-end-workshop-workflow.md §8.2 (lines 1183-1194) — evaluation is recommended, purchase is the Owner's decision.
- **Remaining gap:** Everything: no use case, no port, no adapter, no config, no evaluation, no register row. The only thing this line changes today is that the earlier 'no machine learning / no OCR' boundary statements are no longer absolute and must be re-read as phase-scoped, not permanent.
- **Owning module:** none today; proposed port home apps/api/src/modules/shared-services/provider (beside storage-provider.ts and message-provider.ts); consuming module depends on the chosen use case (reception, vehicle or diagnostics)
- **Delivery placement:** Named follow-on beyond Phase 1 (proposed name: 'AI-assisted capture'), preceded by an Owner-commissioned evaluation. Not P1-30 corrective — docs/phase-1/phase-1-30/canonical-plan.md §2 forbids Backend feature development in P1-30 and the tenant-bootstrap slice records 'This is not new product scope'. Not P1-31 (Delivery/Warranty/Reporting). Not the Integration gate, which proves the journey and adds nothing.
- **Dependencies:** Owner commercial decision to contract OpenAI (docs/product/README.md §0.1); OWR-2026-09-06-AI-2 (a named, evaluated use case); for any image-reading use case P1-OD-025 (media policy, OPEN) and a provisioned object store (STORAGE_PROVIDER defaults to 'unconfigured', apps/api/src/server/config/backend-config.ts:189-192).
- **Acceptance criteria:** The register carries this line with status and owner; no AI call site exists on develop until AI-2's evaluation is recorded; grep of apps/ for an AI SDK stays empty until the follow-on branch opens.
- **Unverified:** Whether the Owner intends OpenAI specifically or 'a model provider' generally; the text names OpenAI, this entry does not widen it.

### OWR-2026-09-06-AI-2 — Owner requirement · **Undecided**

> Assign it a concrete evaluated use case

- **Normalised behaviour:** Before any model or OCR call ships, exactly one use case is named in writing and evaluated against the platform's own axes (coverage on real workshop inputs, licence terms, data leaving the platform, cost, outage consequence), and no AI capability exists without such a named use case.
- **Existing evidence:** The evaluation pattern exists for other providers: docs/product/vehicle-catalogue/provider-evaluation.md §4 axes (lines 246-265), §10 Owner questions, §11 spike rules — 'Nothing the spike produces enters the product database' (line 606), 'No account is created and no terms are accepted' (line 610). Candidate use cases the journey already exposes, none chosen: dashboard photo → odometer value (DSH-1, docs/product/workshop/reception-media-checklist.md:93,122-124; RMC-09 line 491 — the reading cannot yet be bound to its photograph); VIN/chassis plate photo (IDN-1, lines 96,143-144); fault-code plain-language description (INS-03, docs/product/workshop/inspection-and-diagnostics.md:830 — description is free text, no catalogue; the deterministic alternative is a licensed fault-code dictionary, line 869); VIN decode (VS-07, provider-evaluation.md:223; decodeVin is 'a proposal, never a fact', docs/product/vehicle-catalogue/catalogue-architecture.md:578,593).
- **Remaining gap:** No evaluation document exists for any AI use case; no use case is chosen; every image-based candidate is blocked on P1-OD-025 and on an object store; the fault-code candidate competes with a deterministic licensed dictionary the docs already recommend evaluating.
- **Owning module:** docs/product (evaluation record) then the consuming module: reception (rec._) for odometer/VIN capture, vehicle (veh._) for VIN decode, diagnostics (dia.*) for fault-code description
- **Delivery placement:** Owner-commissioned evaluation first (planning work, no code), then the named follow-on. Never P1-30 corrective.
- **Dependencies:** OWR-2026-09-06-AI-1; P1-OD-025 for any photo-reading case; STORAGE_PROVIDER provisioning (an Owner purchase decision, reception-media-checklist.md:484,532); OWR-2026-09-06-AI-6 (the quality baseline the evaluation must produce).
- **Acceptance criteria:** A committed evaluation record under docs/product names ONE use case, its inputs by column, its ground-truth source, its measured baseline on real (non-fabricated) samples, its fallback, and an Owner verdict; the follow-on's task register cites it. A second use case requires a second evaluation.

### OWR-2026-09-06-AI-3 — Owner requirement · **Planned**

> server-side integration

- **Normalised behaviour:** Every model or OCR call originates in apps/api (request path or app_worker) behind a provider port; the browser never holds a provider credential, never calls the provider, and no provider SDK type crosses into application services.
- **Existing evidence:** The port discipline exists three times: apps/api/src/modules/iam/provider/identity-provider.ts:1-30 (no SDK type upstream, RootLco error model, FakeIdentityProvider for CI); apps/api/src/modules/shared-services/provider/storage-provider.ts:1-32 (server-built keys, credentials never cross the boundary); apps/api/src/modules/shared-services/provider/message-provider.ts:1-22 and UnconfiguredMessageProvider (~lines 63-74) which refuses rather than pretends. Env selection with a refusing default: backend-config.ts:189-192 STORAGE_PROVIDER, 224-229 NOTIFICATION_PROVIDER + NOTIFICATION_PROVIDER_TIMEOUT_MS bounded(100, 60_000, 5_000). Gates: scripts/check-browser-exposed-secrets.mjs, scripts/check-tracked-secrets.mjs, scripts/check-module-boundaries.mjs, validate:api-backend-only (package.json:80), security:all (package.json:52). The same rule is already written for data providers: docs/product/owner-workflow-requirements.md:336-338 'server-side, licensed, cached, source-attributed and provider-abstracted. Never scrape websites. Never call a third-party catalogue API directly from the browser.' The only outbound fetch in modules today is apps/api/src/modules/iam/provider/supabase-provider.ts.
- **Remaining gap:** No AI port, no adapter, no AI_* config keys, no deterministic local double; no documented outbound-egress allow-list anywhere in docs/security (grep for outbound|egress|third-party found none).
- **Owning module:** shared-services (provider port + unconfigured default + local double); server/config (env keys); iam untouched
- **Delivery placement:** Named follow-on, first slice: the port and the refusing default, before any adapter — the order provider-evaluation.md:548 prescribes ('Build the port before any adapter').
- **Dependencies:** OWR-2026-09-06-AI-2 (the port's method shape follows the use case); OWR-2026-09-06-AI-7 (the unconfigured default IS the fallback path).
- **Acceptance criteria:** No NEXT_PUBLIC_ variable names an AI key (check-browser-exposed-secrets); apps/web imports nothing from the AI port (web boundary gate); the port's default adapter refuses with a catalogued error when AI_PROVIDER-style config is absent; a CI suite runs entirely against the local double with no network.
- **Unverified:** Whether an egress allow-list is enforced at the hosting layer — no hosting environment exists (ADR-012 open).

### OWR-2026-09-06-AI-4 — Owner requirement · **Planned**

> scoped inputs

- **Normalised behaviour:** A provider call carries only the allow-listed fields the named use case needs; restricted classes (customer words in rec.complaint_details, contents descriptions, personal identifiers, amounts gated by sal.finance.view or inv.cost.view) never leave the platform unless the use case names them and the Owner approved that in the evaluation.
- **Existing evidence:** Classification machinery exists: iam.sensitive.view as an additive gate and the restricted tables it binds (end-to-end-workshop-workflow.md §7.7 lines 1141-1163); docs/database/sal-wty-rpt-personal-data-classification.json and sibling classification gates (verify:classifications, package.json:150); 'Data classification of every new column — Verified — tests/db/org-security dictionary-coverage assertion (fails on any unclassified column)' (docs/security/security-baseline.md:164). The message port already refuses to carry an address at all (message-provider.ts:10-17). Log redaction: src/server/observability/redaction.ts (cited at storage-provider.ts:27-31).
- **Remaining gap:** No rule states which classification classes may be sent to an external model; no request-document schema; no test asserting the outbound document contains only allow-listed fields.
- **Owning module:** shared-services (request-document builder + named wire shape) with docs/database/retention-and-sensitive-data-standard.md extended by one rule
- **Delivery placement:** Named follow-on, same slice as the port (AI-3); the classification rule is a documentation change any Backend lane may carry once the Owner approves the class list.
- **Dependencies:** OWR-2026-09-06-AI-2 (which columns); Owner approval of the class list; retention standard amendment.
- **Acceptance criteria:** The outbound request document is a named wire shape (validate:named-wire-shapes, package.json:96) built by a pure function; a unit test proves a restricted field placed in the input is refused; the field allow-list is enumerated in the evaluation record; audit detail classification masks any echoed input.

### OWR-2026-09-06-AI-5 — Owner requirement · **Undecided**

> usage limits

- **Normalised behaviour:** Provider calls are bounded per tenant and per user within a window and switchable per tenant, with every number set by the Owner; an exhausted limit degrades to the manual path, never to an error that blocks the step.
- **Existing evidence:** Typed rate-limit catalogue apps/api/src/server/http/rate-limit.ts: 'expensive-read' 30/60s keyed operation+tenant+user (~lines 140-155), 'standard-command' 120/60s (157-163), 'low-risk-metadata' 600/60s (186-193), RateLimitPolicyName typed so an unregistered name is a compile error (~205). Per-tenant enablement: OperationDeclaration.featureFlag 'checked against org.resolve_feature_enabled' (apps/api/src/server/auth/operation-registry.ts:68-69; function at supabase/migrations/20260717105000_org_settings_tax_features.sql:307-359); org.tenant_feature_overrides with mandatory reason and non-overlapping intervals (same migration, 262-300); org.feature_flags platform-global (20260717102000_org_subscriptions.sql:68-96); org.subscription_plans.capacity_limits jsonb (same file, 104-110). Live stack: feature_flags holds only the two P1-13 fixture flags, subscription_plans holds zero rows. Limits are 'proposed validation baselines pending measurement; P1-OD-027 unresolved' and the store is process-local (docs/standards/rate-limiting-standard.md:7-8, 29-30).
- **Remaining gap:** No AI rate policy, no cost or token budget concept anywhere, no per-tenant quota row; the numbers do not exist and must not be invented.
- **Owning module:** server/http (rate policy), org (feature flag + override), platform control plane (per-tenant enablement write — today overrides are platform-assigned with no application write)
- **Delivery placement:** Named follow-on; the feature flag row and the policy name ship with the first adapter. Numbers come from the Owner in the evaluation record.
- **Dependencies:** Owner-supplied limits; P1-OD-027 (NFR-SCL) for any production figure; OWR-2026-09-06-AI-7 so exhaustion falls back rather than fails.
- **Acceptance criteria:** The AI operation declares a registered rate policy and a feature flag; a tenant with the flag off never reaches the adapter (proved by a test that counts adapter invocations as a delta); exceeding the policy answers the catalogued throttle error and the manual path still completes.

### OWR-2026-09-06-AI-6 — Owner requirement · **Undecided**

> quality measurements

- **Normalised behaviour:** Every model or OCR candidate is recorded with the human outcome (accepted as-is, corrected, rejected) and the acceptance rate is reportable per tenant and use case; a use case below an Owner-set threshold is switched off.
- **Existing evidence:** none for AI. The nearest recorded-verdict shapes: shared.file_scan_results — append-only, provider-neutral scanner_code, sanitized jsonb details, status pending|clean|infected|error (supabase/migrations/20260718101000_shared_document_versions_and_scan_results.sql:98-129); veh.vin_verifications — check_kind incl. 'external', result passed|failed|overridden with mandatory override_reason (20260720094000_veh_vin_verifications.sql:56-67). Metrics discipline: docs/standards/observability-standard.md. Reporting module exists (apps/api/src/modules/reporting) with two report operations (register P1-31 row 'Reports').
- **Remaining gap:** No candidate table, no outcome column, no metric, no report dataset, no threshold; the baseline the evaluation (AI-2) must produce has no home yet.
- **Owning module:** consuming module (candidate row + outcome) and reporting (rpt) for the per-tenant measure
- **Delivery placement:** Named follow-on; the measurement is part of the FIRST slice, not an afterthought, because the Owner made it a precondition of the option.
- **Dependencies:** OWR-2026-09-06-AI-2 (ground truth definition); OWR-2026-09-06-AI-8 (the candidate row is what gets measured); Owner threshold.
- **Acceptance criteria:** For a sample of real captures, the stored outcome distribution is readable through a permissioned report; the figure is computed in SQL, not the client; the switch-off is a feature-flag override with a reason, and the evidence record cites the measured rate rather than the provider's own score.

### OWR-2026-09-06-AI-7 — Owner requirement · **Planned**

> and a working fallback

- **Normalised behaviour:** When the provider is unconfigured, unreachable, throttled, or returns nothing usable, the same workflow step completes by manual entry with no data loss; the manual path is the primary path today and is never gated by the AI feature flag.
- **Existing evidence:** The refusing-default pattern: UnconfiguredMessageProvider throws a catalogued outage ('No message-delivery provider is configured', message-provider.ts ~63-74); UnconfiguredStorageProvider refuses with ERR-SYS-001 (inspection-and-diagnostics.md:229); ProviderFailure carries a stable reason and a retryable flag (identity-provider.ts:32-60); MessageProviderError.retryable drives dead-lettering (message-provider.ts:44-57). Manual fallback is already an Owner requirement for the catalogue: 'Manual fallback is mandatory' (owner-workflow-requirements.md:329-331) and docs/product/vehicle-catalogue/manual-entry-policy.md. Manual capture routes exist for every candidate use case: veh.vehicle-odometer-record (reception-media-checklist.md:123), rec.reception-condition-evidence, POST /inspections/{id}/dtcs (inspection-and-diagnostics.md:136-143).
- **Remaining gap:** No AI port, so no fallback to test; the rule that the manual path is never behind the AI flag is unwritten.
- **Owning module:** shared-services (port default) + each consuming module's existing manual command
- **Delivery placement:** Named follow-on, first slice with the port.
- **Dependencies:** OWR-2026-09-06-AI-3.
- **Acceptance criteria:** With AI_PROVIDER-style config absent, every consuming screen and route behaves exactly as on develop today (a regression suite run twice, flag on and off, yields the same manual outcomes); a simulated provider timeout produces a candidate-absent state and the manual command still succeeds; no manual operation declares the AI feature flag.

### OWR-2026-09-06-AI-8 — Owner requirement · **Planned**

> Treat OCR and model outputs as untrusted candidate data

- **Normalised behaviour:** A machine-read value is stored, if at all, as a source-attributed candidate and is never written into an authoritative column without an explicit, permissioned, audited human acceptance; acceptance is an ordinary application command.
- **Existing evidence:** The platform already separates claim from fact: customer concerns versus technically verified findings (end-to-end-workshop-workflow.md §4 lines 235-277); 'decodeVin returns a proposal, never a decision … Accepting it is a recorded human act' (catalogue-architecture.md:593); veh.vin_verifications 'overridden' requires a non-blank reason (20260720094000:61-62) and the migration states 'no external service is performed or fabricated' (line 67); duplicate-candidate queues with review/dismiss (manual-entry-policy.md:368-369; end-to-end line 317); 'which fault a lamp indicates is diagnosis, and diagnosis belongs to a technician' (inspection-and-diagnostics.md:651); 'No operation in the platform accepts a raw machine payload' (inspection-and-diagnostics.md:198). Immutability makes direct writes dangerous: rec.reception_visits freezes odometer_reading_id and ev_soc_percent after insert (reception-media-checklist.md:127, RMC-10).
- **Remaining gap:** No candidate table or wire shape for machine outputs; no capture-method value distinguishing machine-proposed from human-entered; no acceptance command.
- **Owning module:** consuming module (candidate row, acceptance command) with shared-services holding the provider-neutral source attribution
- **Delivery placement:** Named follow-on; schema change through change control (docs/product/README.md §5 steps 1-7), never inside P1-30.
- **Dependencies:** OWR-2026-09-06-AI-2; P1-OD-025 for image-derived candidates; the classification registry every new column owes (security-baseline.md:164).
- **Acceptance criteria:** A candidate row cannot satisfy any FK or trigger that authoritative columns satisfy; the acceptance operation declares its own permission and auditClass; a test writes a candidate and asserts the authoritative column is unchanged until the acceptance command runs; the candidate carries source (provider code) and the human outcome.
- **Unverified:** Which values veh.odometer_readings.capture_method admits today — not read; do not add a machine value without the human step.

### OWR-2026-09-06-AI-9 — Owner requirement · **Planned**

> model self-reported confidence is not validated accuracy

- **Normalised behaviour:** A provider-returned confidence score is never used as an auto-accept gate, never displayed as accuracy, and at most stored as opaque sanitized provider detail; the only accuracy figure the product states is the measured one from OWR-2026-09-06-AI-6.
- **Existing evidence:** none directly. The shape for opaque provider detail exists: shared.file_scan_results.details 'sanitized JSON — no secrets' (20260718101000:128-129) and DeliveryOutcome carrying a code but never a body (message-provider.ts:36-42). The plain-language gate refuses developer vocabulary in every user-visible string (scripts/ci/check-plain-language.mjs:1-36; package.json:131).
- **Remaining gap:** No rule written; no gate would today refuse a screen rendering a provider score as 'accuracy'.
- **Owning module:** consuming module (never reads the score for control flow); apps/web i18n messages (never names it as accuracy)
- **Delivery placement:** Named follow-on, same slice as AI-8.
- **Dependencies:** OWR-2026-09-06-AI-6, AI-8.
- **Acceptance criteria:** Code review + a unit test: the acceptance decision function has no branch on any provider score; the i18n files contain no string presenting a provider score as accuracy or correctness (extend check-plain-language's list if a word is chosen); the evidence record states the measured rate only.
- **Unverified:** Whether 'confidence' is already in the plain-language banned list — not read.

### OWR-2026-09-06-AI-10 — Owner requirement · **Delivered**

> Authorized application commands and deterministic server calculations remain responsible for stock, money, approvals, and permissions.

- **Normalised behaviour:** No model output can change a stock quantity, a monetary figure, an approval or a permission; those change only through a defineOperation-registered command carrying permission codes and an audit class, with arithmetic computed in PostgreSQL and rendered as decimal strings.
- **Existing evidence:** Delivered as a platform invariant, gate-enforced: defineOperation requires permissions and validates auditClass/auditAction (apps/api/src/server/auth/operation-registry.ts:42-73,167-175; AuditClass = none|privileged|approval|financial|export|security); RLS enabled and forced everywhere (docs/security/security-testing-standard.md:36, tests/db/foundation.test.ts); money numeric(18,4) computed server-side, no setTypeParser override, decimal strings on the wire (docs/phase-1/phase-1-30/a0-read-surface-matrix.md:24-29); scripts/ci/check-p1-30-server-arithmetic.mjs ('P1-30 RENDERS SERVER ARITHMETIC ONLY', parses not greps) and scripts/ci/check-exact-money.mjs wired in verify:policies/verify:contracts (package.json:88,151,154); approvals: iam.approval_limits (20260718093000_iam_approval_and_sensitive_data.sql:46-73) and quotation approval policy; sal.financial_events provenance guard binds amount and currency to an authorized source row (20260724093000_sal_financial_events.sql:63-113); permission delegation limited to codes the actor holds (ins_role_permissions_delegable, migration 20260726090000, per docs/phase-1/phase-1-30/tenant-bootstrap-corrective-slice.md §1). Related register row: 'Decimal-string money, ISO currency codes — Delivered — platform-wide invariant, gate-enforced' (owner-workflow-requirements.md:262).
- **Remaining gap:** The invariant holds because no AI path exists. Nothing yet forbids a future adapter from being wired as a CALLER of those commands (an adapter with a principal, a db role, or an import of a module's application service). That guard is proposed as OWR-2026-09-06-AI-P3.
- **Owning module:** server/auth, server/http, database (RLS, guards); every commercial module
- **Delivery placement:** Already delivered; the guard extension lands in the follow-on's first slice.
- **Dependencies:** none for the invariant; AI-P3 for the guard.
- **Acceptance criteria:** Existing: verify:policies and verify:contracts green; tests/db RLS forced. Added: a module-boundary rule fails when any file under a provider/_ai_ path imports a module application service, a repository, server/db, or server/auth; the adapter has no database role and no principal.

### Accounting handoff — Owner requirement · **Planned**

> Full accounting … remain explicit follow-on product commitments with named ownership and acceptance criteria; they do not silently become the current P1-30 repair.

- **Normalised behaviour:** P1-30 owns only the HANDOFF: the immutable source facts an accounting system consumes exist, are complete, and are readable/exportable by an authorized finance user; P1-30 never posts journals or keeps accounts.
- **Existing evidence:** Existing register row 'Accounting handoff — Planned' (docs/product/owner-workflow-requirements.md:263). sal.financial_events: append-only, exactly one event per financial command, provenance-guarded, table comment 'The future accounting integration point (Figure 4.29) — NOT a general ledger: no debit/credit/account columns' (supabase/migrations/20260724093000_sal_financial_events.sql:22-57); SELECT gated by sal.finance.view (same file, policy sel_financial_events_gated). Boundary records: docs/phase-1/phase-1-11/phase-1-11-no-general-ledger-boundary.md:10-16 (FR-FIN-001…005 named as future accounting integration; a p1-11-security assertion checks no GL table exists); end-to-end-workshop-workflow.md Step 25 lines 877-881 ('Routed to accounting means an issued invoice and a receivable exist for an accounting system to consume'); docs/product/workshop/pricing-payment-and-delivery.md:1107 'A general ledger — Absent by design'.
- **Remaining gap:** No operation reads or exports sal.financial_events as a handoff (the two report operations and export authorization exist but no financial-event dataset is published — UNVERIFIED whether any GET projects the table); no invoice/payment list yet (INT-083, INT-085); the row has no acceptance sentence of its own.
- **Owning module:** billing + payments (writers, existing); reporting/export (rpt, shared export authorization) for the read
- **Delivery placement:** P1-30 (existing row) for the handoff read/export contract via a remediation/p1-30-backend-* branch if the Owner keeps it in P1-30; otherwise P1-31 Reporting. The full accounting domain is NOT here — see OWR-2026-09-06-AI-11.
- **Dependencies:** sal.finance.view holder in the administrator bundle (closed by the tenant-bootstrap slice, F-01); Owner decision on which phase (P1-30 vs P1-31) owns the read — docs/product/README.md §6 records the split as not established.
- **Acceptance criteria:** An authorized finance user can list or export the financial events of a branch for a period in seq order with amounts as decimal strings and ISO currency codes; a user without sal.finance.view gets nothing; every event's source row is resolvable; no debit/credit/account column exists anywhere (existing p1-11-security assertion stays green).
- **Unverified:** Whether any published GET already projects sal.financial_events — the grep found repository and route references in billing/payments/credit-notes but their read/write direction was not inspected.

### OWR-2026-09-06-AI-11 — Owner requirement · **Undecided**

> Full accounting … remain explicit follow-on product commitments with named ownership and acceptance criteria

- **Normalised behaviour:** A general ledger (journal, journal lines, chart of accounts, periods, posting rules) is a named product commitment after Phase 1 with an owner and acceptance criteria recorded in the register, consuming sal.financial_events as its only input from the workshop domain.
- **Existing evidence:** The deferral is recorded, the commitment is not: phase-1-11-no-general-ledger-boundary.md:27-29 ('the entire FIN general-ledger domain' deferred); phase-1-12-owner-gate.md:401-413 and phase-1-13/14 precondition reports repeat 'no general ledger'; the OpenAPI title still calls the product a 'CRM and ERP Platform' (docs/api/openapi.v1.json:4). No accounting module directory exists under apps/api/src/modules (listing: billing, crm, delivery, diagnostics, iam, inventory, meta, payments, platform, pricing, quality, quotation, reception, reporting, service-catalog, shared-services, technician, vehicle, warranty, work-order).
- **Remaining gap:** No register row for the follow-on, no owner, no acceptance criteria, no phase name; the FR-FIN-001…005 requirement ids live in the canonical DOCX outside Git.
- **Owning module:** none (new module beyond Phase 1); input boundary sal.financial_events
- **Delivery placement:** Explicit follow-on beyond Phase 1, recorded in the register under a new 'Follow-on commitments' section (see OWR-2026-09-06-AI-P7); never P1-30, never P1-31, never the Integration gate.
- **Dependencies:** Owner names the owner and acceptance criteria; 'Accounting handoff' delivered first (its output is this follow-on's input); OIR-04 / P1-OD-007 currency and jurisdiction decisions.
- **Acceptance criteria:** Register row exists with named owner, phase name, and acceptance sentences (at minimum: every sal.financial_event posts exactly once; a period can be closed; trial balance balances); until then, no journal/account table exists on develop and the p1-11-security no-GL assertion stays green.

### OWR-2026-09-06-AI-12 — Owner requirement · **Undecided**

> HR … remain explicit follow-on product commitments with named ownership and acceptance criteria

- **Normalised behaviour:** An HR/workforce master (employee records, employment data, payroll) is a named commitment after Phase 1 with an owner and acceptance criteria; Phase 1 keeps the IAM account as the only identity and operational profiles that never copy HR data.
- **Existing evidence:** Deferral recorded repeatedly, commitment never: iam.user_employee_links.employee_ref comment 'PLACEHOLDER string — the HR employee master and its FK arrive in Phase 1-9' (supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:166-197) — but P1-9 explicitly shipped 'no full HR/payroll' (docs/phase-1/phase-1-9/README.md:12) and tech.technician_profiles 'NEVER duplicates salary/government-id/contact/medical/payroll data. employment_ref is an opaque non-PII operational link' (20260722094000_tech_profiles_skills_certs.sql:37-69); DBCR-P1-18-002 §9 'introduces no HR or workforce master … an explicit constraint of the Owner decision' (docs/database/change-requests/DBCR-P1-18-002-rec-receiving-employee-identity.md:132-134); phase-1-19/README.md:155 'Full HR' out of scope. Structure that exists: org.departments (20260717104000_org_operational_structure.sql:109-140), iam.user_employee_links, tech.* profiles/skills/certifications/availability. Related register rows (employee identity, not HR): P1-29 'Assign named employees and technicians' and P1-31 'QA employee', 'Delivery employee'.
- **Remaining gap:** No HR module, no employee master, no payroll; the migration comment promising it in P1-9 is stale and misleading (proposed correction OWR-2026-09-06-AI-P6); no register row, owner or acceptance criteria.
- **Owning module:** none (new module beyond Phase 1); anchors iam.user_accounts, iam.user_employee_links, tech.technician_profiles, org.departments
- **Delivery placement:** Explicit follow-on beyond Phase 1, recorded in the register's follow-on section; never P1-30.
- **Dependencies:** Owner names owner and acceptance criteria; personal-data classification for any HR column (dictionary-coverage assertion, security-baseline.md:164); retention standard.
- **Acceptance criteria:** Register row exists with owner and acceptance sentences; until then no table stores salary, government id, medical or payroll data (existing classification assertions), and iam.user_employee_links keeps no FK.

### OWR-2026-09-06-AI-13 — Owner requirement · **Undecided**

> and rewards remain explicit follow-on product commitments with named ownership and acceptance criteria

- **Normalised behaviour:** A rewards capability (the Owner has not said whether customer loyalty or employee incentive) is a named commitment after Phase 1 with an owner and acceptance criteria; nothing in Phase 1 implements or implies it.
- **Existing evidence:** none. Grep of docs/product, docs/phase-1/phase-1-30, supabase/migrations and supabase/seeds for reward|loyalty|incentive|bonus|commission (case-insensitive) returns no relevant hit (only the word 'commissioned'). No table, column, permission code, operation or document names rewards.
- **Remaining gap:** Definition itself: which party is rewarded, for what, and how it is measured — all Owner decisions; no register row, owner or acceptance criteria.
- **Owning module:** none; candidate anchors only after definition (crm.* for customer loyalty; tech.labor_sessions / qms for employee measures — the vehicle-history doc warns double-clocked labour is 'a payroll and liability' matter, vehicle-history-model.md:605)
- **Delivery placement:** Explicit follow-on beyond Phase 1, recorded in the register's follow-on section; never P1-30.
- **Dependencies:** Owner definition (customer vs employee, measure, currency of the reward); if monetary, OWR-2026-09-06-AI-10 applies (server arithmetic, decimal strings) and the no-fake-data policy forbids seeded reward tiers.
- **Acceptance criteria:** Register row exists with a one-sentence definition, owner, and acceptance sentences; until then grep for reward|loyalty in apps/ and supabase/ stays empty.

### OWR-2026-09-06-AI-14 — Owner requirement · **Delivered**

> they do not silently become the current P1-30 repair.

- **Normalised behaviour:** No P1-30 branch (feature/p1-30-* or remediation/p1-30-backend-*) adds accounting, HR, rewards or AI capability; the P1-30 corrective lane repairs only what the P1-30 scope already requires, and any widening is a visible register change approved by the Owner.
- **Existing evidence:** Governance exists and is verified: docs/phase-1/phase-1-30/canonical-plan.md §1.4 (two lanes, two ownership profiles judged by tests/ci/phase-ownership.test.ts), §2 'What P1-30 does not own' (Backend feature development, schema, open decisions), §5 completion; scripts/ci/check-phase-ownership.mjs wired in verify:policies (package.json:130,154); the register's own rule 'A requirement is implemented in the phase that owns it. Never earlier … never later' (owner-workflow-requirements.md:38-40); the corrective slice's self-limitation 'This is not new product scope' (tenant-bootstrap-corrective-slice.md §1) and its explicit F-02 non-closure (§4).
- **Remaining gap:** The ownership gate is PATH-based (which files a profile may touch), not TOPIC-based: a p1-30-backend profile permits apiSource and supabase, so a new apps/api/src/modules/accounting on a remediation/p1-30-backend-* branch would pass the gate. The topical boundary is held by the register, the canonical plan and review, not by a script.
- **Owning module:** scripts/ci (phase-ownership), docs/product (register), docs/phase-1/phase-1-30 (canonical plan)
- **Delivery placement:** Delivered as governance; the follow-on section in the register (AI-P7) makes the boundary explicit for these three domains.
- **Dependencies:** OWR-2026-09-06-AI-P7.
- **Acceptance criteria:** Every P1-30 PR's changed-file set passes validate:phase-ownership; no directory named accounting, hr, payroll or rewards appears under apps/api/src/modules or supabase/migrations on any p1-30 branch; the register's follow-on section lists the three domains with status Undecided until the Owner names owners.
- **Unverified:** The exact directory allow-list of the p1-30-backend profile was not read; the path-not-topic limitation is inferred from the profile fields named in canonical-plan.md §1.4 (web, docs, tooling, tests, rootConfig; apiSource forbidden for the Frontend profile).

### OWR-2026-09-06-AI-P1 — Proposed implementation policy · **Planned**

> (proposed implementation of AI-3 / AI-7) server-side integration … and a working fallback

- **Normalised behaviour:** Add a provider port in apps/api/src/modules/shared-services/provider (proposed name DocumentReadingProvider or ModelProvider, one method per evaluated use case) with an Unconfigured default that refuses with a catalogued error, a deterministic local double for CI, and env selection plus a bounded per-attempt timeout modelled on NOTIFICATION_PROVIDER / NOTIFICATION_PROVIDER_TIMEOUT_MS; the OpenAI adapter is one adapter behind it.
- **Existing evidence:** Pattern to copy verbatim: message-provider.ts (port, UnconfiguredMessageProvider, LocalMessageProvider behaviours accept|timeout|outage|reject), identity-provider.ts (ProviderFailure reasons, retryable), backend-config.ts:224-229 (regex-constrained provider code, bounded timeout), provider-evaluation.md:548 ('Build the port before any adapter').
- **Remaining gap:** Not built; naming and method shape wait on the use case.
- **Owning module:** shared-services/provider; server/config
- **Delivery placement:** Follow-on first slice.
- **Dependencies:** OWR-2026-09-06-AI-2.
- **Acceptance criteria:** Port + unconfigured default + local double merged with tests exercising accept/timeout/outage/reject through the double; no network in CI; adapter added in a later slice only after the evaluation record.

### OWR-2026-09-06-AI-P2 — Proposed implementation policy · **Planned**

> (proposed implementation of AI-8 / AI-9) untrusted candidate data; confidence is not accuracy

- **Normalised behaviour:** Store each machine output as an append-only capture-candidate row (tenant scope, source row, provider_code constrained like scanner_code, sanitized details jsonb, outcome pending|accepted|corrected|rejected, decided_by, decided_at) and let only a human acceptance command write the authoritative column; never add a capture-method value that implies machine truth without that step.
- **Existing evidence:** shared.file_scan_results shape (20260718101000:98-129: provider-neutral code regex, sanitized details, append-only); veh.vin_verifications override-with-reason (20260720094000:61-62); duplicate-candidate review/dismiss flow.
- **Remaining gap:** Not designed; needs DBCR through docs/database/change-requests with classification of every column.
- **Owning module:** consuming module schema (rec/veh/dia) + shared-services
- **Delivery placement:** Follow-on, via a Backend change request; never P1-30.
- **Dependencies:** OWR-2026-09-06-AI-8; P1-OD-025 where the source is an image.
- **Acceptance criteria:** DBCR merged with RLS enabled and forced, classification recorded, append-only guard; acceptance command registered with permission and auditClass 'privileged'.

### OWR-2026-09-06-AI-P3 — Proposed implementation policy · **Planned**

> (proposed guard for AI-10) authorized application commands and deterministic server calculations remain responsible

- **Normalised behaviour:** Extend scripts/check-module-boundaries.mjs with a rule that any file under a provider/_ai_ (or the chosen port directory) may import nothing from any module's application or data layer, server/db, server/auth or server/audit, and that no adapter is registered as an outbox consumer with write authority; an adapter returns data and holds no principal.
- **Existing evidence:** check-module-boundaries.mjs resolves every import before judging it (header lines 1-40, ADV-01); worker consumers are registered explicitly (apps/api/src/server/worker/consumer-registry.ts, consumers/index.ts, job-assigned-notifier.ts); app_worker is a distinct db archetype (worker-db.ts:4-9).
- **Remaining gap:** Rule not written.
- **Owning module:** scripts (repository-tooling profile)
- **Delivery placement:** Follow-on first slice, or earlier on a repository-tooling branch since it is inert until an adapter exists.
- **Dependencies:** none.
- **Acceptance criteria:** A fixture adapter importing a module service makes the gate exit 1; the gate has a falsifiability test in tests/ci.

### OWR-2026-09-06-AI-P4 — Proposed implementation policy · **Undecided**

> (proposed candidate ranking for AI-2) a concrete evaluated use case

- **Normalised behaviour:** Evaluate, in this order, (1) dashboard-photo odometer reading at reception (DSH-1), (2) VIN/chassis-plate reading on first visit (IDN-1), (3) plain-language fault-code description (INS-03) — and for (3) evaluate the licensed deterministic fault-code dictionary in the same document, since a dictionary is not a model and needs no candidate handling.
- **Existing evidence:** reception-media-checklist.md:93,96,122-127,143-144 (DSH-1, IDN-1, RMC-09/RMC-10); inspection-and-diagnostics.md:830,869 (INS-03 and the dictionary recommendation); end-to-end §8.2 lines 1183-1194 (fault-code dictionaries and VIN decoding named as paid-provider candidates).
- **Remaining gap:** (1) and (2) are blocked until P1-OD-025 is decided and an object store is provisioned; (3) is unblocked but competes with a deterministic alternative.
- **Owning module:** docs/product evaluation record
- **Delivery placement:** Owner-commissioned evaluation; no code.
- **Dependencies:** P1-OD-025; storage provider decision; Owner ranking.
- **Acceptance criteria:** The evaluation record states, per candidate, the ground truth, the sample source (real, non-fabricated), the measured baseline, the fallback, the data classes sent, and an Owner verdict; no provider account is created during the evaluation.

### OWR-2026-09-06-AI-P5 — Proposed implementation policy · **Planned**

> (proposed execution model for AI-3 / AI-5) server-side integration, usage limits

- **Normalised behaviour:** Run provider calls asynchronously through shared.event_outbox and the app_worker consumer registry rather than inside the HTTP request, so a slow or throttled provider never holds a request slot; the request path enqueues, the worker writes the candidate row, and the screen reads it back.
- **Existing evidence:** docs/standards/queue-processing-and-replay-standard.md ('The queue is the database', line 28); outbox-worker.ts:1-8 (FOR UPDATE SKIP LOCKED claims, lease expiry); backoff.ts; consumers/job-assigned-notifier.ts as the one shipped consumer; worker enqueue authority via column GRANT + RESTRICTIVE policy (memory: notification-enqueue-authority).
- **Remaining gap:** No consumer, no event type in the event catalogue (docs/standards/event-catalog-v0.1.md), no candidate table to write.
- **Owning module:** server/worker consumers; event catalogue; shared-services
- **Delivery placement:** Follow-on second slice (after the port and the candidate row).
- **Dependencies:** AI-P1, AI-P2; an ECR entry in the event catalogue.
- **Acceptance criteria:** The request that triggers a read returns before the provider answers; a provider timeout dead-letters after bounded retries with a sanitized summary (no payload); the candidate row appears with outcome pending.

### OWR-2026-09-06-AI-P6 — Proposed implementation policy · **Planned**

> (proposed correction supporting AI-12) HR remains an explicit follow-on

- **Normalised behaviour:** Replace the stale COMMENT on iam.user_employee_links.employee_ref ('the HR employee master and its FK arrive in Phase 1-9') with a statement that no HR master exists in Phase 1 and that it is a named follow-on, so the schema stops promising a phase that did not deliver it.
- **Existing evidence:** supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:193-196 (the comment); docs/phase-1/phase-1-9/README.md:12 and 20260722094000:64-66 (P1-9 built operational profiles only).
- **Remaining gap:** A COMMENT change is a new migration (comments live in migrations; the structural baseline pins counts), so it travels on a Backend lane under change control, not P1-30 Frontend.
- **Owning module:** iam (schema comment); docs/database/data-dictionary.md
- **Delivery placement:** Any Backend remediation lane the Owner opens next; it is documentation-only in effect but migration-borne in mechanism.
- **Dependencies:** Baseline manifest regeneration (validate:baseline-manifest) since migration count moves.
- **Acceptance criteria:** The live comment no longer references Phase 1-9 delivering an HR master; data-dictionary.md matches; migration replays from empty.

### OWR-2026-09-06-AI-P7 — Proposed implementation policy · **Undecided**

> (proposed register change for AI-11 / AI-12 / AI-13 / AI-14) explicit follow-on product commitments with named ownership and acceptance criteria

- **Normalised behaviour:** Add a 'Follow-on commitments beyond Phase 1' section to docs/product/owner-workflow-requirements.md with one row each for Full accounting, HR, Rewards and AI-assisted capture, each carrying owner, phase name, input boundary, acceptance sentences and status, so that the register — not memory — holds the commitment and the P1-30 boundary is explicit.
- **Existing evidence:** The register already carries cross-phase sections owned by no single phase (the three histories, lines 294-312; the vehicle catalogue, lines 315-342) and uses named rows with the five-value status vocabulary (lines 15-24).
- **Remaining gap:** Section does not exist; owners and acceptance criteria are the Owner's to state.
- **Owning module:** docs/product (register)
- **Delivery placement:** Immediate documentation change on a docs-only branch; the rows start Undecided.
- **Dependencies:** Owner supplies owners and acceptance criteria; nothing technical.
- **Acceptance criteria:** Section present; four rows; each row's status is Undecided until the Owner names an owner, then Planned; no row claims Delivered on the strength of presence (register rule, lines 26-28).

---
