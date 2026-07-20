# Phase 1-10 — Grant Matrix

Per-object and per-function grants. Application roles are `NOLOGIN NOBYPASSRLS`;
`app_worker` receives **no** P1-10 grant. USAGE on `svc`/`quo`/`inv` is granted to
`app_runtime` + `app_readonly` (migration `…090000`); no CREATE is granted to any
application role.

## Table grants

| Table group                                                                                                                                                                                                                 | `app_runtime`                                         | `app_readonly`     | `app_worker` |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------ | ------------ |
| All tenant/branch catalogs and masters (`svc.*`, `quo.quotations`/`quotation_revisions`/`quotation_items`, `inv` reference/locations/balances/reservations/opening/adjustments/issues/returns/damage/CSP/external-purchase) | SELECT, INSERT, UPDATE                                | SELECT             | —            |
| Append-only ledgers (`inv.stock_movements`, `quo.approval_decisions`, `quo.approval_evidence`, `quo.quotation_status_history`)                                                                                              | SELECT, INSERT                                        | SELECT             | —            |
| Restricted 1:1 cost (`inv.item_cost_details`, `inv.external_purchase_part_details`, `inv.stock_adjustment_details`)                                                                                                         | SELECT, INSERT, UPDATE (RLS-gated by `inv.cost.view`) | SELECT (RLS-gated) | —            |
| Dual-scope `inv.units_of_measure`                                                                                                                                                                                           | SELECT, INSERT, UPDATE (tenant rows only)             | SELECT             | —            |

**DELETE is granted to no application role on any P1-10 table.** Deletion is a
soft-delete UPDATE; the append-only ledgers have no soft-delete.

## Function grants

All 39 functions are `SECURITY INVOKER`, `SET search_path=''`, `REVOKE EXECUTE FROM
PUBLIC`. Guard/emitter/helper functions carry **no** grant (they run only as triggers
or as internal callees) — including the two constraint-layer guards
`inv.guard_part_return_ceiling` and `quo.guard_quotation_revision_freeze`. The following primitives carry an explicit `GRANT EXECUTE`:

| Function                                                                           | Granted to                    |
| ---------------------------------------------------------------------------------- | ----------------------------- |
| `svc.publish_service_version(uuid, uuid, date)`                                    | `app_runtime`                 |
| `svc.publish_price_list_version(uuid, uuid, date)`                                 | `app_runtime`                 |
| `svc.resolve_price(uuid, uuid, uuid, text, date)`                                  | `app_runtime`, `app_readonly` |
| `inv.post_stock_movement(uuid, uuid, text, text, numeric, text, uuid, uuid, text)` | `app_runtime`                 |
| `inv.reserve_stock(uuid, uuid, numeric, uuid, text, timestamptz, uuid)`            | `app_runtime`                 |
| `inv.release_reservation(uuid, text)`                                              | `app_runtime`                 |
| `inv.consume_reservation(uuid)`                                                    | `app_runtime`                 |
| `inv.expire_reservations(uuid, uuid)`                                              | `app_runtime`                 |
| `inv.issue_part(uuid, uuid, uuid, numeric, uuid, uuid, uuid)`                      | `app_runtime`                 |
| `inv.return_part(uuid, numeric, text, uuid)`                                       | `app_runtime`                 |
| `inv.record_damage(uuid, uuid, uuid, numeric, text, text, uuid, uuid, uuid)`       | `app_runtime`                 |
| `inv.approve_opening_batch(uuid)`                                                  | `app_runtime`                 |
| `inv.approve_adjustment(uuid)`                                                     | `app_runtime`                 |
| `quo.issue_revision(uuid, timestamptz)`                                            | `app_runtime`                 |
| `quo.record_item_decision(uuid, text, text, uuid)`                                 | `app_runtime`                 |

Internal helpers with **no** grant (called only by the granted primitives):
`inv.lock_stock_balance`, `inv.sync_reserved`, `inv.free_reservations_for_loss`, and
every `guard_*` / `emit_*` trigger function.

## Restricted gate

The three restricted cost tables gate every policy on
`iam.has_permission('inv.cost.view')`. The table GRANT alone is insufficient — a role
without `inv.cost.view` sees no rows and cannot write, even with SELECT/INSERT/UPDATE
granted.
