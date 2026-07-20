# Phase 1-10 — Issue / Return Contract

**Requirement:** FR-INV-003 (issue/return generate immutable movements). Tables:
`inv.part_issues`, `inv.part_returns`.

## Issue

`inv.issue_part(work_order, item, location, qty, reservation?, required_part_ref?,
correlation?)` (`SECURITY INVOKER`):

- resolves the location's company/branch and requires the **work order to exist in
  scope** (`SELECT … FOR UPDATE` on `wo.work_orders`);
- inserts an `inv.part_issues` row (composite FKs to WO, item, location, optional
  reservation; `required_part_ref` is the opaque link later covered by the P1-09
  forward FK on `wo.required_parts`);
- posts an `issue`/`out` movement (`inv.post_stock_movement`, provenance-guarded to the
  issue row and quantity);
- if a reservation was supplied, **consumes** it (`inv.consume_reservation`).

The movement's provenance guard binds it to the issue row and quantity, so an issue
movement cannot exist without a real issue.

## Return

`inv.return_part(part_issue, qty, reason?, correlation?)` (`SECURITY INVOKER`):

- **locks the issue** (`SELECT … FOR UPDATE`) to serialize the return-ceiling check;
- enforces the **return ceiling** `Σ returns + qty ≤ issued quantity` (`23514`);
- inserts an `inv.part_returns` row (composite FK to the issue) and posts a
  `return`/`in` movement, provenance-guarded to the return row and quantity.

`inv.part_returns.quantity > 0`; content columns are immutable once set.

## Immutability

Both tables carry immutable-column guards on scope, WO/issue reference, and quantity;
the derived stock effect is entirely mediated by the movement ledger, so an issue or
return row never diverges from its posted movement.

**Tests:** the `inv` operations suite (issue/return ceiling, provenance) in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
