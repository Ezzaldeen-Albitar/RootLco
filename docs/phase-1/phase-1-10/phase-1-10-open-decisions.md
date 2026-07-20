# Phase 1-10 — Open Decisions and Dependencies

P1-10 keeps every open decision as **configuration or a documented open contract** — no
currency, tax jurisdiction, tax rate, discount threshold, adjustment threshold,
partial-approval policy, release grouping, or invoice-numbering policy is invented.

## Open decisions (kept open)

| ID            | Decision                                                        | How P1-10 keeps it open                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-OD-007** | Jurisdiction / currency / tax / invoice / retention             | Currency is a `shared.currencies(code)` FK (no default invented); tax reuses configurable `org.tax_classes`/`org.tax_rates`; captured tax on `quotation_items` preserves history. No hard-coded jurisdiction or rate. |
| **P1-OD-020** | Partial approval policy                                         | Item-granular `quo.approval_decisions` + a derivable revision rollup form a **structural superset** (full/partial/per-item approval or rejection); **no** partial-approval policy table is created.                   |
| **P1-OD-021** | Pricing / discount / tax limits                                 | Thresholds live in `svc.pricing_approval_policies` (`threshold_kind`/`threshold_value`, no seeded value); the monetary ceiling stays in `iam.approval_limits` (reused).                                               |
| **P1-OD-022** | Inventory stock rules (adjustment threshold, requires-approval) | `inv.stock_adjustments.requires_approval` + the pending/approved gate hold the structure; the **threshold is configuration** — no value seeded; an over-threshold adjustment simply stays `pending`.                  |
| **P1-OD-041** | Release grouping                                                | Not schema'd here; quotation/approval structure is grouping-agnostic. Release grouping is a P1-20/P1-11 concern; nothing in P1-10 commits to a grouping policy.                                                       |
| **P1-OD-042** | Invoice-number policy                                           | Explicitly deferred to **P1-11**. `quo.quotations.quotation_number` uses `shared.next_display_number('quotation', company, branch)`; no invoice numbering exists in this phase.                                       |

## Dependencies

| ID         | Dependency                                           | Handling                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DEP-05** | Commercial rules (G3) — Commercial Owner             | Pricing/discount/quotation **structure** is delivered; the commercial **policy** values (thresholds, price books' contents, discount catalog) are configuration owned by the Commercial Owner, not seeded. |
| **DEP-06** | Item / stock / supplier rules (G3) — Inventory Owner | Item master, UoM, location hierarchy, and the stock ledger **structure** are delivered; item catalog contents, cost values, and supplier data are configuration owned by the Inventory Owner, not seeded.  |

## Explicitly future (not schema'd here)

FR-SVC-005 (dynamic pricing), FR-QUO-005 (insurer exchange), FR-INV-005 (reorder
prediction) — named in the plan, deliberately **not** modelled in P1-10.

## Documented residuals (deferred to P1-21)

- **Coherence-guard re-sum cost** — the balance coherence guard's full re-sum is `O(n)`
  in a cell's movement/reservation count; accepted for a foundation phase, incremental
  optimization deferred (review-response Medium).
- **Reservation-expiry scheduler** — `inv.expire_reservations` is a required
  maintenance primitive; a scheduled caller lands in P1-21, mitigated meanwhile by
  opportunistic in-lock expiry inside `reserve_stock` (review-response Medium). See
  [p1-21-inventory-backend-contract.md](p1-21-inventory-backend-contract.md).
