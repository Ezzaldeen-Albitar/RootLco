# Capability status — one compact row per capability

The baseline recorded here is the repository at protected develop `2c573a24`, measured 2026-09-16.
Rows are updated as the directive's branches merge; the date of each revision is stated when it is
made.

## The four states

- **implemented** — a user can reach the capability through a route in the web application, the
  route calls a backend operation that exists, and the evidence column names where that was
  demonstrated. Where an operation exists and works but has no screen, the row says
  `implemented (API only)` and is not a completed workflow.
- **partial** — some of the capability exists and a stated part of it does not. The gap is written
  in the row, not left to be inferred.
- **missing** — no route, no operation, or neither.
- **externally blocked** — the capability cannot be completed inside this repository, and the
  reason names what is outside it.

A row needs all three of a UI route, a backend operation and evidence before it reads
**implemented**. A plan is not evidence. An API without its screen is not a completed workflow. A
screenshot of a screen that performed no transaction is not evidence that the transaction works.

## Section 2 — Platform Owner Console

| capability                                    | status                 | UI route | backend operation                    | evidence                                                                                    |
| --------------------------------------------- | ---------------------- | -------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| List organisations                            | partial                | none     | platform.organization-read           | No search, no status filter, no total count                                                 |
| Open one organisation                         | partial                | none     | platform.organization-read(tenantId) | Returns the seven root columns only                                                         |
| Create tenant with first company and branch   | implemented (API only) | none     | platform.organization-provision      | `apps/api/src/app/api/v1/platform/organizations/route.ts`                                   |
| Add a company or branch to an existing tenant | missing                | none     | none                                 | CC-OD-06                                                                                    |
| Invite the first administrator                | partial                | none     | platform.organization-provision      | Only inside provisioning; not a standalone action                                           |
| Subscription term, plan, modules, limits      | partial                | none     | platform.organization-provision      | Provision body carries `plan_code`, `status`, `effective_from` only; no plan administration |
| Renewal, upgrade, downgrade                   | missing                | none     | none                                 | CC-OD-05                                                                                    |
| Suspend and reactivate                        | implemented (API only) | none     | platform.organization-lifecycle      | Route exists; no console screen calls it                                                    |
| Usage against entitlement                     | missing                | none     | none                                 | `org.subscription_plans.capacity_limits` is read by nothing                                 |
| Subscription lifecycle and change history     | partial                | none     | none                                 | Table `org.tenant_status_history` exists with no read operation                             |
| Platform statistics                           | missing                | none     | none                                 | CC-OD-05                                                                                    |
| Platform console user interface               | missing                | none     | none                                 | A platform-only account is redirected to `/login?reason=forbidden` (CC-OD-04)               |
| Platform operator identity                    | implemented            | none     | operator script                      | `scripts/platform/genesis-platform-operator.mjs`                                            |

## Section 3 — Organisation administration

| capability                               | status      | UI route                                   | backend operation           | evidence                                                                 |
| ---------------------------------------- | ----------- | ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------ |
| Create a company                         | missing     | none                                       | none                        | CC-OD-06                                                                 |
| Create a branch                          | missing     | none                                       | none                        | CC-OD-06                                                                 |
| Create a department                      | partial     | none                                       | org.department-create       | Operation exists, no screen                                              |
| Create an employee                       | partial     | none                                       | org.employee-create         | Operation exists, no screen                                              |
| Invite a user                            | implemented | `/[locale]/administration/users`           | iam.invitation-create       |                                                                          |
| Assign roles                             | partial     | `/[locale]/administration/users`           | iam.invitation-create       | Roles are chosen at invitation only                                      |
| Assign a branch scope                    | missing     | none                                       | iam.grant-scope-add         | Operation exists, no screen                                              |
| Deactivate a user                        | implemented | `/[locale]/administration/users`           | iam.user-status-change      |                                                                          |
| Revoke sessions                          | implemented | `/[locale]/administration/users`           | iam.user-session-revoke-all |                                                                          |
| Roles and permissions                    | implemented | `/[locale]/administration/roles`           | iam.role-list               |                                                                          |
| Approval limits                          | implemented | `/[locale]/administration/approval-limits` | iam.approval-limit-create   |                                                                          |
| Edit tenant, company and branch settings | implemented | `/[locale]/administration/organization`    | iam.tenant-settings-update  |                                                                          |
| Activate or deactivate a branch          | partial     | none                                       | shared.branch-status-change | The action exists with no call site                                      |
| Company status                           | partial     | none                                       | org.company-status-set      | No screen                                                                |
| Refusal explanations                     | partial     | every screen                               | n/a                         | Banners by HTTP kind; only `ERR-CON-001` is mapped to a specific message |
| Capacity limits                          | missing     | none                                       | none                        | CC-OD-06                                                                 |

## Section 4 — Inventory, sales, barcodes and returns

| capability                           | status      | UI route                             | backend operation                 | evidence                                                   |
| ------------------------------------ | ----------- | ------------------------------------ | --------------------------------- | ---------------------------------------------------------- |
| Warehouses and locations             | implemented | `/[locale]/inventory/setup`          | inv.stock-location-create         |                                                            |
| On-hand, reserved, available         | implemented | `/[locale]/inventory`                | inv.stock-availability-read       |                                                            |
| In-transit quantity                  | missing     | none                                 | none                              | CC-OD-07                                                   |
| Receiving                            | partial     | `/[locale]/inventory/setup`          | inv.opening-batch-create          | Opening batches only; no goods receipt                     |
| Transfers                            | missing     | none                                 | none                              | Dropped in P1-10 (CC-OD-07)                                |
| Issues                               | implemented | `/[locale]/inventory/parts`          | inv.stock-issue-create            |                                                            |
| Returns of issued parts              | implemented | `/[locale]/inventory/parts`          | inv.stock-return-create           | Issue-linked; the remaining-returnable ceiling is enforced |
| Approved adjustments                 | partial     | none                                 | none                              | Tables and `inv.approve_adjustment` exist with no route    |
| Stock counts with variance           | partial     | none                                 | inv.inventory-reconciliation-read | A read only; no count is recorded, no screen               |
| Cost history                         | missing     | none                                 | none                              | CC-OD-07                                                   |
| External sale without a work order   | missing     | none                                 | none                              | `sal.invoices.work_order_id` is `NOT NULL` (CC-OD-08)      |
| Company customer record              | implemented | `/[locale]/crm/customers/new/[kind]` | crm.company-create                |                                                            |
| Invoices: issue, cancel, outstanding | implemented | `/[locale]/invoices`                 | sal.invoice-issue                 |                                                            |
| Credit notes                         | partial     | none                                 | sal.credit-note-create            | No screen                                                  |
| Payments and allocation              | implemented | `/[locale]/payments`                 | sal.payment-record                |                                                            |
| Return condition triage              | missing     | none                                 | none                              | `inv.part_returns` carries no condition (CC-OD-09)         |
| Damaged stock                        | partial     | none                                 | inv.damaged-stock-create          | No screen                                                  |
| Financial effect of a return         | missing     | none                                 | none                              | CC-OD-09                                                   |
| Barcodes on items                    | missing     | none                                 | none                              | CC-OD-10                                                   |
| Scanning                             | missing     | none                                 | none                              | CC-OD-10                                                   |
| Label printing                       | missing     | none                                 | none                              | CC-OD-10                                                   |
| Live updates                         | missing     | none                                 | none                              | Server events are an outbox insert only (CC-OD-13)         |
| Idempotency on writes                | partial     | `/[locale]/inventory`                | inv.stock-reservation-create      | The `replayed` marker is returned on reservations only     |

## Section 5 — Duplicate-demand controls

| capability                                                | status  | UI route                              | backend operation            | evidence                                                                            |
| --------------------------------------------------------- | ------- | ------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| Approved requirement per work order and service operation | missing | none                                  | none                         | `wo.required_parts` has no service-line link (CC-OD-11)                             |
| Cumulative cap across requests, reservations and issues   | missing | none                                  | none                         | CC-OD-11                                                                            |
| Concurrent safety                                         | partial | none                                  | inv.stock-reservation-create | `inv.reserve_stock` locks the balance row only, not a demand cap                    |
| Authorized exception                                      | partial | `/[locale]/work-orders/[workOrderId]` | wo.additional-work-approval  | Carries neither a quantity nor a reason                                             |
| Unit normalization                                        | partial | none                                  | none                         | Dimension is checked; there is no conversion factor. Exact BigInt arithmetic exists |
| Oil specification source                                  | missing | none                                  | none                         | No vehicle service specification exists (CC-OD-11)                                  |
| Refusal reason shown to the user                          | partial | every screen                          | n/a                          | A translated message plus the correlation id                                        |

## Section 6 — Operational intelligence

| capability                                        | status      | UI route                              | backend operation                  | evidence                                       |
| ------------------------------------------------- | ----------- | ------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| Operational dashboard                             | implemented | `/[locale]/reports/overview`          | rpt.report-run                     |                                                |
| Drill-through to the records                      | implemented | `/[locale]/reports/overview`          | rpt.report-run                     |                                                |
| Low-stock suggestions                             | missing     | none                                  | none                               | CC-OD-13                                       |
| Discrepancy alerts                                | missing     | none                                  | none                               | CC-OD-13                                       |
| Unusual consumption                               | missing     | none                                  | none                               | CC-OD-13                                       |
| Expiring subscriptions                            | missing     | none                                  | none                               | CC-OD-13                                       |
| Capacity alerts                                   | missing     | none                                  | none                               | CC-OD-13                                       |
| Searchable audit history                          | implemented | `/[locale]/administration/audit-log`  | iam.audit-event-list               | Tenant-scoped; no cross-tenant read (CC-OD-05) |
| Health endpoint                                   | implemented | none                                  | shared.health-ready                |                                                |
| Chassis-number and odometer reading from an image | missing     | none                                  | none                               | CC-OD-15                                       |
| Image evidence preservation                       | implemented | `/[locale]/work-orders/[workOrderId]` | shared.attachment-upload-authorize | Attachment upload authorizations               |

## Section 7 — Search

| capability                     | status      | UI route                  | backend operation   | evidence                                                                                             |
| ------------------------------ | ----------- | ------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| Customer by name               | implemented | `/[locale]/crm/customers` | crm.customer-search | Name prefix                                                                                          |
| Customer by phone              | missing     | none                      | none                | CC-OD-12                                                                                             |
| Vehicle by make and model      | missing     | none                      | none                | CC-OD-12                                                                                             |
| Vehicle by chassis number      | implemented | `/[locale]/vehicles`      | veh.vehicle-search  | Exact match                                                                                          |
| Vehicle by plate, with history | partial     | `/[locale]/vehicles`      | veh.vehicle-search  | Search matches the active plate only; `veh.vehicle-plate-history` is a detail read, not a search key |
| Work order by number           | missing     | none                      | none                | Reachable by filters only (CC-OD-12)                                                                 |
| Digit normalization            | missing     | none                      | none                | No Arabic-Indic digit folding (CC-OD-12)                                                             |
| Server-side paging             | implemented | every list                | n/a                 |                                                                                                      |
| Scope isolation                | implemented | every list                | n/a                 | Enforced by row-level security                                                                       |

## Sections 1 and 11 — Environment and delivery

| capability                            | status             | UI route | backend operation   | evidence                                                                               |
| ------------------------------------- | ------------------ | -------- | ------------------- | -------------------------------------------------------------------------------------- |
| Environment inventory and templates   | partial            | none     | n/a                 | CC-OD-03                                                                               |
| Startup validation of required values | partial            | none     | shared.health-ready | Every backend value is optional or defaulted; readiness does refuse a `BYPASSRLS` role |
| Deployment                            | externally blocked | none     | n/a                 | LOCAL only, ADR-012; the deploy workflows are inert                                    |
| Platform Owner access delivered       | missing            | none     | n/a                 | CC-OD-14                                                                               |
