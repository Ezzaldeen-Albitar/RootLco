# Phase 1-10 — Discount and Approval-Limit Contract

**Requirement:** FR-SVC-006 / BR-SVC (bounded discounts + approval authority),
P1-OD-020/021 (partial approval, pricing/discount/tax limits kept configurable).

## Bounded discounts

`svc.discount_rules(discount_type, value, currency_code, …)`:

- `discount_type` is `percentage` or `amount`.
- CHECK `ck_discount_rules_type_value`: a `percentage` is `0..100` with **no** currency;
  an `amount` is `>= 0` and **requires** a currency (`currency_code → shared.currencies`).
- Optional narrowing by `company_id` / `branch_id` / `customer_class` / `service_id`,
  effective-dated (`effective_from`/`effective_to`), soft-deletable.

## Approval authority is reused, not duplicated

The monetary **ceiling** — "who may approve up to what amount" — stays in
`iam.approval_limits` (via `limit_type` values such as `quotation_approval` /
`discount_approval`). P1-10 creates **no** new limit table.

`svc.pricing_approval_policies` stores the orthogonal facts:

- `policy_type` (`discount`|`quotation_total`|`price_override`) — what the policy
  governs.
- `threshold_kind`/`threshold_value` — when approval is required (`percentage`
  currency-free, or `amount` with a currency). **No threshold value is seeded**
  (P1-OD-020/021/022 config).
- `required_permission_code` — an FK to `iam.permissions(permission_code)` naming the
  permission that authorizes it.
- `maker_approver_distinct boolean DEFAULT true` — the segregation invariant flag.

## Division of responsibility

Over-limit **detection** is derivable in the database (a discount/quotation value vs.
the policy threshold). The **workflow** (routing, approval, maker/approver
segregation at decision time) is P1-20. P1-10 stores the structure and the invariant
flag only; maker/approver segregation for stock approvals is separately enforced in
the database (`opening_inventory_batches` / `stock_adjustments`, see
[phase-1-10-adjustment-approval-contract.md](phase-1-10-adjustment-approval-contract.md)).

**Tests:** see the `svc` pricing suite in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
