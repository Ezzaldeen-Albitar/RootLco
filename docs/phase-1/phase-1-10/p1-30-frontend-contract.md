# P1-30 (Frontend) Data Contract

Phase 1-10 is database-only. This document records the read-model expectations P1-30
will render. **No frontend is implemented in this phase.**

## Read-model expectations only

- **Service catalog view:** service categories (hierarchy), services (with
  `lifecycle_status`), the current effective published version and its standard labor
  times, and per-branch availability — resolved through `svc.services` /
  `svc.service_versions` / `svc.branch_service_availability`.
- **Pricing view:** price lists and their published versions, the rules of a version,
  assignments, and discount rules; a **resolved price** for a context comes from
  `svc.resolve_price(...)`, never by re-implementing precedence in the client.
- **Quotation view:** the quotation, its revisions (with captured subtotal/discount/
  tax/grand totals), the current issued revision's captured items, and per-item
  approval decisions and evidence — resolved through `quo.*`; evidence resolves through
  the linked `shared.document_versions`, **never** by raw object id.
- **Inventory view:** item master (trigram search on name), per-(item, location)
  balances (`on_hand`/`reserved`/`available`), reservations, and the movement history
  per cell (ordered by `occurred_at`/`seq`) — resolved through `inv.*`.
- **Operations view:** part issues/returns, damaged-stock dispositions, opening batches
  (draft/approved), and stock adjustments (pending/approved/rejected) with the
  maker/approver attribution.
- **Timelines:** `quo.quotation_status_history` and the movement ledger — append-only,
  ordered by `seq`.

## Restricted rendering

Cost/margin fields (`inv.item_cost_details.standard_cost`,
`inv.external_purchase_part_details.unit_cost`,
`inv.stock_adjustment_details.value_impact`) render **only** with
`iam.has_permission('inv.cost.view')`; the metadata parents render in-scope. Prices and
quantities render in-scope without that permission.

The commercial and stock surface a P1-30 read-model consumes is stable and documented
in the P1-10 contract docs and data dictionaries.
