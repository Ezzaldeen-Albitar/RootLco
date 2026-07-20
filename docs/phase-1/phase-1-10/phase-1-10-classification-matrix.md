# Phase 1-10 — Classification Matrix

Every one of the 582 `svc`/`quo`/`inv` columns is classified against the taxonomy
`public` / `internal` / `restricted` / `secret` and reconciled to the live schema by
the project classification validator (CI + local). The validator fails on a missing,
stale, duplicate, invalid, restricted-searchable, or type-drifted entry.

## Restricted columns (3) — cost/margin, gated by `inv.cost.view`

| Restricted column                              | Table scope | Gate            | Note                        |
| ---------------------------------------------- | ----------- | --------------- | --------------------------- |
| `inv.item_cost_details.standard_cost`          | tenant      | `inv.cost.view` | Item standard cost          |
| `inv.external_purchase_part_details.unit_cost` | branch      | `inv.cost.view` | External-purchase unit cost |
| `inv.stock_adjustment_details.value_impact`    | branch      | `inv.cost.view` | Adjustment financial impact |

Each restricted column lives in a **separate 1:1 table** whose whole read/write policy
requires `inv.cost.view`, with an immutable `classification='restricted'` column. This
is genuine row-level gating, not a column-masking view. **0 restricted columns are
searchable.**

## Not restricted (deliberately)

- **Prices and quantities** (`svc.price_rules.amount`, `quo.quotation_items.captured_*`,
  balances, movements, reservations) are `internal` — visible in scope. Prices are
  operational and not cost/margin.
- **Customer-supplied part narrative** (`inv.customer_supplied_parts.description`,
  `item_condition`) is `internal` — operational custody data, not PII.
- **Supplier name / partner ref** (`inv.external_purchase_parts.supplier_name`,
  `supplier_partner_id`) is `internal`; only the **unit cost** is restricted.
- **Quotation payer reference** (`quo.quotations.payer_partner_ref`) is an opaque
  reference (`internal`); customer identity is owned by `crm`.

## Cost vs. PII separation (review-response Medium)

Financial-cost visibility is gated by the **dedicated `inv.cost.view`** permission —
distinct from the broad PII `iam.sensitive.view`. This keeps a role that may see
customer PII from automatically seeing item cost/margin, and vice versa. A
policy-qual test asserts `inv.cost.view` is referenced (no dead permission).

## Boundary

No salary, government ID, medical, payroll, or personal contact data is stored in any
`svc`/`quo`/`inv` table. Employee data remains in `iam`/`tech`; customer data remains
in `crm`.
