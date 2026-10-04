# Module entitlement inventory of 2026-10-04: existing access and a proposed mapping

## Status

This is a dated analysis, like the
[architecture assessment of 2026-10-01](architecture-assessment-2026-10-01.md). It is not a status
document and not a decision record. It was measured on 2026-10-04 at develop `02a0462c`, by reading
the code and by one read-only run of `scripts/platform/entitlement-inventory.mjs` against the local
acceptance database.

**Nothing in this document is enforced or applied.** No flag was registered, no entitlement row was
written, and no role, grant or permission changed. The module names below are **candidates**, not
approved names. Where a recommendation is given, it is a recommendation and not an approval.

It serves one Owner decision: the licensing method decided on 2026-10-03, recorded as the amendment
"Owner decision 2026-10-03" in
[ADR-024](../adr/ADR-024-module-entitlements-and-commercial-packaging.md) and against open decision 7
in [`docs/product/owner-directive-2026-09-16/README.md`](../product/owner-directive-2026-09-16/README.md).
That decision asks for an inventory of what existing companies use and depend on, and a reviewed,
explicit mapping from existing access to initial entitlements that proves no access is removed and
none is added. Verification state stays in `capability-status.md`; the entitlement mechanism and
lifecycle stay in ADR-024.

## 1. Candidate module catalogue

Permission codes are the platform catalogue in `supabase/seeds/04_iam_permission_catalog.sql` (134
codes). Operations are the `defineOperation({...})` declarations under `apps/api/src/app/api/**`,
parsed by the script (512 operations; 506 declare at least one code, 6 are public). Navigation
lines are in `apps/web/src/config/navigation.ts`. A module's main tables are the tables whose rows
count as business use of it in section 2.

| Candidate         | Permission codes                                                | API module and operations                                  | Navigation (`navigation.ts`)                                                                                                                                                    | Main tables                                         |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `crm`             | `crm.*` (10)                                                    | `crm`, 29                                                  | `/crm/customers` `:342`, `/crm/customer-duplicates` `:354`                                                                                                                      | `crm.business_partners`                             |
| `vehicle`         | `veh.*` (7)                                                     | `vehicle`, 27                                              | `/vehicles` `:366`, `/vehicles/duplicates` `:377`                                                                                                                               | `veh.vehicles`                                      |
| `appointments`    | `apt.*` (4)                                                     | 21 operations declared inside the `reception` API module   | `/appointments` `:227`, `/administration/appointment-setup` `:876`                                                                                                              | `apt.appointments`                                  |
| `reception`       | `rec.*` (12)                                                    | `reception`, 50 (the other 21 are appointments)            | `/reception/walk-in` `:198`, `/receptions` `:236`                                                                                                                               | `rec.reception_visits`                              |
| `work-order`      | `wo.*` (9)                                                      | `work-order`, 38                                           | `/work-orders` `:245`, `:270`                                                                                                                                                   | `wo.work_orders`                                    |
| `technician`      | `tech.*` (5)                                                    | `technician`, 18                                           | `/technicians/me` `:309`, `:321`                                                                                                                                                | `tech.technician_profiles`, `tech.labor_sessions`   |
| `diagnostics`     | `dia.*` (5)                                                     | `diagnostics`, 23                                          | `/work-orders/diagnostics` `:279`                                                                                                                                               | `dia.diagnostic_reports`, `dia.inspection_templates` |
| `quality`         | `qms.*` (5)                                                     | `quality`, 15                                              | `/work-orders/quality` `:289`                                                                                                                                                   | `qms.quality_control_records`                       |
| `delivery`        | `sal.delivery.*` (3)                                            | `delivery`, 22                                             | `/delivery` `:631`                                                                                                                                                              | `sal.delivery_records`                              |
| `warranty`        | `wty.*` (3)                                                     | `warranty`, 11                                             | `/warranty` `:648`                                                                                                                                                              | `wty.warranty_records`, `wty.warranty_policies`     |
| `service-catalog` | `svc.service.*` (2)                                             | `service-catalog`, 9                                       | `/services` `:396`                                                                                                                                                              | `svc.services`                                      |
| `pricing`         | `svc.price.*` (3)                                               | `pricing`, 11                                              | `/pricing` `:408`, `/administration/discount-threshold` `:860`                                                                                                                  | `svc.price_lists`                                   |
| `quotation`       | `quo.*` (3)                                                     | `quotation`, 12                                            | `/quotations` `:421`                                                                                                                                                            | `quo.quotations`                                    |
| `billing`         | `sal.invoice.*`, `sal.credit.*`, `sal.finance.view` (5)         | `billing`, 16, including counter sales and credit notes    | `/invoices` `:564`, `/credit-notes` `:592`, `/inventory/counter-sales` `:504` (shown in the inventory group)                                                                    | `sal.invoices`, `sal.credit_notes`                  |
| `payments`        | `sal.payment.*`, `sal.reversal.*` (4)                           | `payments`, 10                                             | `/payments` `:605`                                                                                                                                                              | `sal.receipts`                                      |
| `inventory`       | `inv.*` (14)                                                    | `inventory`, 82, including sales returns                   | `/inventory` `:434`, `:446`; transfers `:460`, goods receipts `:469`, adjustments `:478`, counts `:487`, customer returns `:513`, labels `:522`, units `:540`, specifications `:549` | `inv.item_master`, `inv.stock_movements`            |
| `reporting`       | `rpt.*` (3)                                                     | `reporting`, 11                                            | `/reports` `:695`, `:715`, `/reports/overview` `:735`                                                                                                                           | `rpt.report_configurations`, `rpt.saved_filters`    |
| Core (not a flag) | `iam.*` (10), `org.*` (12), `platform.*` (9), `shared.*` (6)    | `iam` 57, `platform` 20, `shared-services` 28, `meta` 1, `overview` 1 | `/` `:155`, `/attention` `:181`, `/documents` `:663`, `/notifications` `:672`, the other `/administration` entries `:760-954`                                          | Not counted                                         |

Notes on the catalogue:

- **Appointments live inside reception.** Their 21 operations are declared with `module:
  'reception'` (for example `apps/api/src/app/api/v1/appointments/route.ts:56-59`). A flag
  declared per API module therefore cannot separate them: licensing appointments on its own needs
  the flag declared on each of the 21 operations, or the operations moved into a module of their
  own. The script tells them apart by their `apt.` operation id.
- **Purchasing, tax and accounting have no operations.** Goods receipts are an inventory operation
  and their supplier is free text (assessment C-15); tax classes and rates have no write path
  (C-17), and `org.tax.manage` is counted under core; no ledger exists. None of the three is a
  candidate module today.
- **Core is not licensable** (rule R3). This analysis also places `meta` (a ping) and `overview` (the
  dashboard summary) in core; that placement is a classification for review, not a decision.
- `iam` 57 counts the 40 `iam.*` and the 17 `org.*` operations of the `iam` API module.

## 2. Inventory: method and aggregated results

### Method

The command, run once for this document with a private label file:

```
node scripts/platform/entitlement-inventory.mjs --db-host 127.0.0.1 --db-port 54322 \
  --labels <private label file> --out <private evidence folder>/inventory.json
```

- **Read-only.** Every statement runs inside `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` and
  ends with `ROLLBACK`. Before it is sent, each statement passes a guard that accepts only a single
  SELECT or WITH statement with no data-changing keyword, no locking clause and no call outside a
  short list of side-effect-free built-ins. Each transaction checks that the server reports it
  read-only and that no transaction id was assigned. The guard and the transaction handling are
  tested in `tests/unit/entitlement-inventory.test.ts`.
- **Four transactions.** A snapshot of the migration ledger and of 36 table row counts; the
  inventory read; the same read again; the snapshot again.
- **Effective codes** follow `iam.has_permission`: an active, not deleted account in the grant's
  tenant; an active grant inside its validity window at the database's own time; an allow mapping
  and no deny mapping for the code across all of the user's grants.
- **Business use** is a row in one of the module's main tables, or an audit action of the module in
  `iam.audit_records` (by action prefix).
- **Tenant classes.** Status and the platform operator come from the database (the operator tenant
  is the tenant of an account holding an unrevoked platform grant). The other classes come from a
  private label file kept outside the repository with the run's output, in the coordinator's
  evidence folder `owner-directive-2026-10-04-licensing-inventory`. The output and the label file
  name tenants; this document quotes counts only.

### Results

All counts below are aggregates. No tenant name, code or identifier appears in this repository.

**Tenants: 62.** By status: 61 active, 1 provisioning. By class: 1 platform operator, 1
provisioning, 52 journey organisations, 2 QA organisations, 6 other acceptance organisations.

**Configuration in use today.** 0 registered feature flags, 0 tenant overrides, 0 company settings
rows, 0 branch settings rows. 7 subscription plans, none with any entitlement in its document. 3
tenants have an active subscription.

**Administrator bundles.** 61 of the 62 tenants have exactly one standard
administrator role: 58 hold 78 codes, 1 holds 89 and 2 hold 97. One tenant has none.

**Users.** 152 active users; 145 effectively hold at least one code; 19 distinct sets of reachable
operations among those 145 (20 counting the empty set of the 7 who hold none).

**Audit trail.** 168 distinct actions; every one maps to a candidate module or to core.

**Modules across the 61 tenants other than the operator's.** _Granted_: an active user holds a code
of the module and the tenant has no business use of it. _Used_: business use with no code held.
_Both_ and _none_ follow.

| Candidate         | Granted | Used | Both | None | Entitled by the proposed mapping | Of which forced |
| ----------------- | ------: | ---: | ---: | ---: | -------------------------------: | --------------: |
| `crm`             |      29 |    0 |   32 |    0 |                               61 |               0 |
| `vehicle`         |      31 |    0 |   30 |    0 |                               61 |               0 |
| `appointments`    |       1 |    0 |    1 |   59 |                                2 |               0 |
| `reception`       |      32 |    0 |   29 |    0 |                               61 |               0 |
| `work-order`      |      34 |    0 |   27 |    0 |                               61 |               0 |
| `technician`      |      39 |    0 |   22 |    0 |                               61 |               0 |
| `diagnostics`     |      58 |    0 |    3 |    0 |                               61 |               0 |
| `quality`         |      44 |    0 |   17 |    0 |                               61 |               0 |
| `delivery`        |      43 |    0 |   18 |    0 |                               61 |               0 |
| `warranty`        |      44 |    0 |   17 |    0 |                               61 |               0 |
| `service-catalog` |      34 |    0 |   27 |    0 |                               61 |               0 |
| `pricing`         |      35 |    0 |   26 |    0 |                               61 |               0 |
| `quotation`       |      39 |    0 |   22 |    0 |                               61 |               0 |
| `billing`         |      41 |    0 |   20 |    0 |                               61 |               0 |
| `payments`        |      36 |    0 |   25 |    0 |                               61 |               0 |
| `inventory`       |      34 |    0 |   27 |    0 |                               61 |               0 |
| `reporting`       |      44 |    0 |   17 |    0 |                               61 |               0 |

No tenant uses a module without holding a code of it. The two tenants entitled to appointments are
both in the QA class; no other tenant holds an `apt.*` code.

**Observed forced dependencies.** For each dependency (rule R6), the number of tenants whose evidence
already includes the dependent module, and how many of those already include what it depends on:

| Dependency                | Basis                                            | Tenants with the dependent module | Of which already with the dependency |
| ------------------------- | ------------------------------------------------ | --------------------------------: | -----------------------------------: |
| work-order → inventory    | C-06: closure calls inventory                    |                                61 |                                   61 |
| delivery → inventory      | C-06: delivery readiness calls inventory         |                                61 |                                   61 |
| billing → inventory       | C-11: billing imports inventory                  |                                61 |                                   61 |
| delivery → billing        | delivery reads the open receivable               |                                61 |                                   61 |
| quotation → work-order    | C-09: a quotation requires a work order          |                                61 |                                   61 |
| payments → billing        | receipts are allocated to invoices               |                                61 |                                   61 |
| billing → crm             | counter sales name a customer                    |                                61 |                                   61 |

The dependency list is the one the Owner's records name, plus delivery → inventory, which the
assessment's coupling C-06 states for delivery readiness. Counter sales are part of billing, so
"counter sales → crm and inventory" is the billing → crm and billing → inventory rows.

## 3. Mapping rules

- **R1. The unit is the tenant.** Each tenant is one legal company today.
- **R2. A module is entitled if and only if** an active user of the tenant effectively holds one of
  its codes (the `has_permission` semantics above, including validity windows), or the tenant has
  business rows in one of its main tables, or the tenant's audit trail holds an action of the
  module, or it is a forced dependency (R6) of a module entitled by the first three.
- **R3. Core is not a flag.** `iam`, `org`, `platform` and `shared` are never entitlements, and the
  platform operator's tenant is given no module.
- **R4. Explicit rows.** The result is one row per tenant and candidate module, true or false, so it
  never depends on a flag default or on a plan document (all seven plans are empty today).
- **R5. No permission change.** The mapping writes no role, grant or permission row. Who may do what
  inside a tenant stays exactly as it is.
- **R6. Forced dependencies** close the entitled set, and the closure reports what it added. Measured:
  it adds nothing for any tenant.

## 4. Pending items

Each item waits on an open question in the directive record (`README.md`, "Open Owner decisions
raised by the 2026-10-01 records"). The interim choice is what the proposed mapping does until the
Owner answers; it is a recommendation, not an approval.

| Item                                          | Open question | Safe interim choice in the mapping                                                                                                      | Consequence of the interim choice                                                                                                     |
| --------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Appointments for tenants with no `apt.*` code | 1, 7          | Not entitled                                                                                                                            | Nothing changes for them today: no user can reach an appointment operation without the codes. Granting the codes later also needs the entitlement |
| Which module owns counter sales               | 2             | Billing                                                                                                                                 | A standalone inventory package would need billing, or a new internal issue (FC-10)                                                    |
| Licence dimensions, trials and grace          | 4             | Per tenant; no trial and no grace                                                                                                       | None until a structure is chosen                                                                                                      |
| Downgrade and expiry                          | 5             | Nothing is switched off                                                                                                                 | No tenant loses access through this mapping                                                                                           |
| Who runs the mapping                          | 13            | An operator script, reviewed and rehearsed                                                                                              | Tenant overrides can be inserted only while a tenant is provisioning (C-05), so writing explicit rows for active tenants needs its own reviewed write path |
| Automatic grants on purchase                  | 14            | None: entitlement grants nobody anything                                                                                                | Users keep exactly the codes they hold                                                                                                |
| The credit-note approval code beyond QA       | 8             | Unchanged; not a module-level question                                                                                                  | The D13 transition stays as recorded in CC-OD-50                                                                                     |
| The D17 notice                                | 9             | Outside the mapping                                                                                                                     | None on entitlements                                                                                                                  |
| Purchasing                                    | 15            | Goods receipts stay under inventory                                                                                                     | No purchasing module exists to entitle                                                                                                |
| Opening quantities when adding inventory      | 17            | No effect: every tenant measured is entitled to inventory today                                                                         | None until a tenant without inventory adds it                                                                                         |
| Tax and accounting                            | 10, 11, 12    | Not entitled; no such module exists                                                                                                     | None until the questionnaire is answered                                                                                              |

## 5. Proof method and measured result

**Method.**

- For every active user, the set of reachable operations is computed twice: before, every operation
  whose declared codes the user all holds (the operation registry's conjunction); after, the same
  set with the proposed entitlements applied as a filter, keeping an operation only if its own
  candidate module and the module of each code it declares are core or entitled for the user's
  tenant. The two sets must be identical, operation by operation, not only equal in size.
- For every tenant, entitled minus (held, used and audit-used) must equal the forced list.
- The computation is run twice on the same data, and once more on a second read in its own
  transaction. Both must give byte-identical results.

**Measured result, 2026-10-04.**

- Reachable sets: identical for 152 of 152 active users; 0 operations removed and 0 added.
- Entitled minus evidence: empty for all 61 tenants; forced additions 0.
- The operator's tenant: 0 modules.
- Proposed result: 59 tenants entitled to 16 candidates (all but appointments), 2 tenants to all 17,
  the operator's tenant to none; 1,054 explicit rows (62 tenants × 17 candidates).
- Idempotency: the same data computed twice gave identical bytes, and the second read gave an
  identical mapping and identical aggregates.
- No write: each of the four transactions was reported read-only by the server and was assigned no
  transaction id; the migration ledger held 167 versions, the newest `20261002100000`, before and
  after; the row counts of the 36 snapshot tables were identical before and after.
- Compared with an earlier read-only research pass, every figure it gave is unchanged: 62 tenants
  (61 active, 1 provisioning), no flag, override or settings rows, 7 plans with empty entitlements,
  administrator bundles of 78 (58 tenants), 89 (1) and 97 codes (2), 152 active users, 145 holding
  codes, 19 distinct reachable-operation sets, 61 tenants entitled to 16 candidates with
  appointments for 2, none for the operator's tenant, and no addition by a forced dependency.

**Not done here, and required before any apply.**

1. A reviewed write path for explicit rows on active tenants (see "Who runs the mapping" above).
2. A rehearsal on a restored copy of the database, comparing control totals before and after.
3. Server enforcement on operations, jobs, reports and exports (FC-02, FC-03), with tests.
4. An isolation test: switching one tenant's entitlement changes that tenant's answers and no other
   tenant's.
5. The Owner's review of this mapping and answers to the pending items that affect it.

## 6. Explicit statements

- Nothing is enforced or applied by this document or by the script it cites.
- All eight package-readiness scenarios (OD-20) remain not yet demonstrated.
- The twelve commercial questions (open decisions 1 to 12 in the directive record) remain open; for
  decision 7 only the method is decided.
- Recommendations, where any are given, are not approvals.
