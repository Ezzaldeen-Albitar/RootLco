# Phase 1-10 — Migration Classification

Eight additive, forward-only migrations `20260723090000` … `20260723097000`; no merged
migration is edited. Each migration is classified by the change categories it
contributes: **schema** (new schema/table/column), **security** (RLS/policy/grant/
restricted gating), **function** (SECURITY INVOKER functions/triggers), **index**
(FK-cover + query/gist/partial), **reference** (FK to prior schemas / structural
reference).

| Migration                   |    schema     |         security          |                                 function                                 |                        index                         |                                                reference                                                 | Rollback class                              |
| --------------------------- | :-----------: | :-----------------------: | :----------------------------------------------------------------------: | :--------------------------------------------------: | :------------------------------------------------------------------------------------------------------: | ------------------------------------------- |
| `…090000_svcquoinv_schemas` | ✓ (3 schemas) |     ✓ (USAGE grants)      |                                    —                                     |                          —                           |                                                    —                                                     | Rollback-safe while unused (namespace only) |
| `…091000_svc_catalog`       | ✓ (5 tables)  |  ✓ (RLS/policies/grants)  |                 ✓ (5 guards + `publish_service_version`)                 |   ✓ (FK-cover, gist EXCLUDE, `NULLS NOT DISTINCT`)   |                                     ✓ (`org.tenants`/`org.branches`)                                     | Rollback-safe while unused                  |
| `…092000_svc_pricing`       | ✓ (6 tables)  |             ✓             |      ✓ (2 guards + `publish_price_list_version` + `resolve_price`)       |   ✓ (FK-cover, gist EXCLUDE, `NULLS NOT DISTINCT`)   |              ✓ (`svc.services`, `org.tax_classes`, `shared.currencies`, `iam.permissions`)               | Rollback-safe while unused                  |
| `…093000_inv_reference`     | ✓ (5 tables)  | ✓ (+`inv.cost.view` gate) |                               ✓ (4 guards)                               |    ✓ (FK-cover, trigram GIN, dual-scope uniques)     |                      ✓ (`org.branches`, `shared.currencies`, `iam.has_permission`)                       | Rollback-safe while unused                  |
| `…094000_inv_ledger`        | ✓ (3 tables)  | ✓ (append-only movements) | ✓ (2 guards + 7 primitives, incl. `reserve_stock`/`post_stock_movement`) | ✓ (single-use, partial-active, lifetime idempotency) |                      ✓ (`inv.item_master`, `inv.stock_locations`, `wo.work_orders`)                      | Roll-forward-only once movements exist      |
| `…095000_inv_operations`    | ✓ (7 tables)  | ✓ (+2 restricted details) |        ✓ (2 approval guards + provenance guard + 5 op functions)         |                     ✓ (FK-cover)                     |                                ✓ (`wo.work_orders`, `shared.currencies`)                                 | Roll-forward-only once operations exist     |
| `…096000_quo_quotations`    | ✓ (6 tables)  |  ✓ (append-only ledgers)  |    ✓ (3 guards/emitters + `issue_revision` + `record_item_decision`)     | ✓ (FK-cover, single-issued partial, decision unique) | ✓ (`wo.work_orders`, `svc.services`, `inv.item_master`, `shared.currencies`, `shared.document_versions`) | Roll-forward-only once quotations exist     |
| `…097000_wo_forward_fks`    |       —       |             —             |                                    —                                     |                ✓ (3 covering indexes)                |                            ✓ (resolves P1-09 opaque refs → `svc`/`inv`/`quo`)                            | Roll-forward-only                           |

## Notes

- **Additive-only.** Every migration only adds objects; there is no destructive step
  and no down script (forward-only, per `docs/database/migration-standard.md`).
- **`…097000` is reference-only.** It adds three `ALTER TABLE … ADD CONSTRAINT` FKs
  plus their covering indexes on existing P1-09 tables; `MATCH SIMPLE` keeps every
  P1-09 suite green (see
  [phase-1-10-p1-09-forward-fk-completion-report.md](phase-1-10-p1-09-forward-fk-completion-report.md)).
- **`main` untouched.** No migration edits a merged file; `origin/main` is unaffected.
