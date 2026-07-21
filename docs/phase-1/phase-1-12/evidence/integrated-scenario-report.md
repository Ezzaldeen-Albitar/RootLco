# P1-12 Evidence — Integrated Cross-Domain Scenario Report

**Company:** RootLco — Root Link Company · **Phase ID:** P1-12 · **Wave:** 3 (Integration) ·
**Gate condition:** Integrated cross-domain E2E (≥2 tenant/company/branch) reconciles.

- **Protected base:** `origin/develop` = `5cd16da` (P1-11 gate merge #45).
- **Branch:** `feature/p1-12-database-integration-validation-release-gate`.
- **Canonical schema hash:** `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`.
- **Suite:** `tests/db/p1-12-integrated-scenario.test.ts` on PostgreSQL 17 (Supabase local).

## Governance / self-review note

Owner-authorized technical, QA, security, and adversarial **self-review** by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing Technical
Authorization Policy. This is **not** an independent third-party audit. All figures are
from actual execution; none are fabricated or extrapolated. The user performs every merge.

## Result

**8 / 8 tests PASS.** The integrated scenario exercises the complete cross-domain chain in
a single committed transaction, then reconciles financial, custody, inventory, and warranty
state, and proves multi-tenant / multi-branch isolation including a denied cross-tenant write.

## Full chain (one committed transaction)

The scenario drives the business flow end to end, crossing every downstream domain:

`svc` (service + published price) → `inv` (item + warehouse + 50 on hand) → `veh` (vehicle)
→ `rec` (authorized visit + custody accept) → `wo` (work order) → `quo` (quotation revision

- service item) → `sal` (invoice bound to the quotation revision, i.e. the `quo`→`sal`
  forward FK; issued) → **receipt** → **allocation** → **delivery** (same WO / vehicle / visit;
  custody released) → `wty` (warranty bound to the delivered vehicle / WO).

## Reconciliation (post-commit assertions)

| Reconciliation check                             | Expected                                                        | Observed | Result |
| ------------------------------------------------ | --------------------------------------------------------------- | -------- | ------ |
| Invoice open receivable                          | 0 (fully paid)                                                  | 0        | PASS   |
| Financial-event provenance — `invoice_issued`    | exactly 1                                                       | 1        | PASS   |
| Financial-event provenance — `receipt_recorded`  | exactly 1                                                       | 1        | PASS   |
| Financial-event provenance — `payment_allocated` | exactly 1                                                       | 1        | PASS   |
| Custody released                                 | exactly once                                                    | once     | PASS   |
| Inventory on-hand                                | 50                                                              | 50       | PASS   |
| Warranty linkage                                 | `warranty.vehicle` / `work_order` / `delivery` all match source | match    | PASS   |

Provenance is complete: `invoice_issued`, `receipt_recorded`, and `payment_allocated` each
appear exactly once, and the invoice's open receivable settles to 0.

## Isolation matrix

| Isolation assertion                                              | Expected  | Result |
| ---------------------------------------------------------------- | --------- | ------ |
| Tenant B session — visibility across the 10 domain tables        | ZERO rows | PASS   |
| No-context session — visibility across the 10 domain tables      | ZERO rows | PASS   |
| Branch-A2-scoped tenant-A session — visibility of branch-A1 rows | ZERO rows | PASS   |
| Cross-tenant write (tenant B writing a tenant-A invoice)         | DENIED    | PASS   |

Neither a foreign tenant (B) nor a context-less session observes any of the scenario rows
across all 10 domain tables; a tenant-A session scoped to branch A2 sees zero branch-A1
rows; and a cross-tenant write attempt is rejected.

## Status

**PASS — Wave 3 integrated cross-domain scenario: 8/8.** The full chain commits and
reconciles (receivable 0, provenance exactly-once, custody released once, inventory 50,
warranty linkage matched), tenant and branch isolation hold, and cross-tenant writes are
denied. No orphan, leakage, or reconciliation discrepancy observed.
