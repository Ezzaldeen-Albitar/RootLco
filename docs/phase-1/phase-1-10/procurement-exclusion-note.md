# Procurement (PRC) Exclusion Note

Phase 1-10 deliberately excludes the **procurement** domain. This note states the
boundary so a future procurement (PRC) phase inherits a clean contract and so reviewers
can confirm no procurement crept in.

## What is excluded (not schema'd in P1-10)

- **Purchase orders (PO)** and **purchase requisitions (PR)**.
- **Goods receipt** / receiving against a PO.
- **Supplier bidding / RFQ / quotations from suppliers.**
- Any supplier-facing procurement workflow, approval chain, or three-way match.

## The structural boundary

`inv.external_purchase_parts` is a **non-procurement foundation**, not a PO:

- `is_procurement boolean NOT NULL DEFAULT false` with **CHECK `is_procurement =
false`** — a row can never claim to be a procurement artifact.
- `status IN ('recorded', 'linked', 'cancelled')` — a **closed** vocabulary with no
  procurement/goods-receipt tokens.
- It is an ad-hoc, work-order-linked purchase **reference** only; it generates no stock
  movement in P1-10.
- Its cost detail is restricted (`inv.external_purchase_part_details`, gated by
  `inv.cost.view`).

A standalone `prc` schema was **not** created, and pricing was placed in `svc` (not a
`prc`-like `pricing` schema) precisely to avoid colliding with the future procurement
domain (design §1).

## What a future PRC phase inherits

- The item master (`inv.item_master`), units of measure, and stock locations to receive
  into.
- The immutable movement ledger and its provenance pattern — a `goods_receipt`
  reference kind would be added as an additive movement source with its own provenance
  rule.
- The supplier reference (`inv.external_purchase_parts.supplier_partner_id` /
  `supplier_name`) as a starting point for supplier-master modelling.

## Verification

The P1-10 security suite and foundation allow-list assert that **no PO/PR/goods-receipt/
bidding table exists** in this phase, and the `is_procurement=false` CHECK is proven by
the `inv-operations` suite.
